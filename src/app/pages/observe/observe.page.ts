import { Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { PortalApi } from '../../core/api/api.client';
import { MetricsEvent, MetricsReport } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { UiPager, pageSlice } from '../../shared/pager';
import { Source, stamp } from '../explorer/forges.data';

/** A table row with display strings resolved once per slice — the
 *  template interpolates, it never reformats per change-detection. */
interface ObserveRow {
  e: MetricsEvent;
  /** 1-based position in the filtered window — aria-rowindex. */
  position: number;
  at: string;
  tone: string;
  dur: string | null;
  cid: string | null;
  cidFull: string | null;
}

/**
 * Observability (spec §5.4) — local-only metrics exactly as the adapter
 * records them: a `counters` map and a bounded `events` window from
 * `GET /metrics`. There is zero remote telemetry — the page says so
 * explicitly, and nothing rendered here is inferred or synthesized.
 *
 * Honesty contract:
 * - 404 / PORTAL-NOT-FOUND → the whole capability renders UNVERIFIED,
 *   never an empty-looking success.
 * - `duration_ms`/`correlation_id`/`detail` nulls render '—', never a
 *   fabricated value.
 * - `truncated` is surfaced as a visible bounded-window note so the
 *   table is never mistaken for the full history.
 * - Filters are client-side over the reported window only; the sort is
 *   deterministic (`at` descending, stable for ties/unparsable).
 */
@Component({
  selector: 'page-observe',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton, UiPager],
  template: `
    <ui-page-header [title]="'observe.title' | t" [subtitle]="'observe.subtitle' | t">
      <button class="btn" [disabled]="src.loading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <!-- Scope note — local-only metrics, nothing leaves this machine. -->
    <p class="local" data-section="local-only" role="note">
      <ui-icon name="shield-check" [size]="15" />
      <span>{{ 'observe.localOnly' | t }}</span>
    </p>

    <!-- /metrics absent on this adapter → UNVERIFIED capability. -->
    @if (src.unavailable()) {
      <section class="card unv" data-section="unavailable" role="note">
        <ui-state-badge state="UNVERIFIED" />
        <span class="muted">{{ 'observe.unavailable' | t }}</span>
      </section>
    }

    @if (src.error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (src.loading() && !report()) {
      <section class="card" role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="row" [lines]="3" />
      </section>
    }

    @if (report(); as r) {
      <!-- Counters — every key the adapter reported, sorted by name. -->
      <section class="card" data-section="counters">
        <div class="sec__head">
          <div>
            <h2>{{ 'observe.counters' | t }}</h2>
            <p class="src">
              <code>GET /api/v1/metrics</code>
              @if (src.loadedAt(); as ts) {
                <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
              }
            </p>
          </div>
        </div>

        @if (counters().length) {
          <div class="counters">
            @for (c of counters(); track c.key) {
              <div class="counter" [attr.data-counter]="c.key">
                <span class="counter__value">{{ c.value }}</span>
                <span class="counter__key">{{ c.key }}</span>
              </div>
            }
          </div>
        } @else {
          <p class="muted" data-empty="counters">{{ 'state.none' | t }}</p>
        }
      </section>

      <!-- Events — the bounded window, newest first, filterable. -->
      <section class="card" data-section="events">
        <div class="sec__head">
          <div>
            <h2>{{ 'observe.events' | t }}</h2>
            <p class="src">
              <code>GET /api/v1/metrics</code>
              — {{ 'observe.generatedAt' | t: { time: fmt(r.generated_at) } }}
            </p>
          </div>
        </div>

        @if (r.truncated) {
          <p class="truncated" data-note="truncated" role="note">
            <ui-icon name="alert" [size]="14" />
            <span>{{ 'observe.truncated' | t }}</span>
          </p>
        }

        @if (r.events.length) {
          <div class="filters" data-section="filters">
            <label class="filter">
              <span class="filter__lbl">{{ 'observe.filter.kind' | t }}</span>
              <select class="select" data-filter="kind" (change)="setKind($event)">
                <option value="" [selected]="kindFilter() === null">
                  {{ 'state.all' | t }}
                </option>
                @for (k of kindOptions(); track k) {
                  <option [value]="k" [selected]="kindFilter() === k">{{ k }}</option>
                }
              </select>
            </label>
            <label class="filter">
              <span class="filter__lbl">{{ 'observe.filter.status' | t }}</span>
              <select class="select" data-filter="status" (change)="setStatus($event)">
                <option value="" [selected]="statusFilter() === null">
                  {{ 'state.all' | t }}
                </option>
                @for (s of statusOptions(); track s) {
                  <option [value]="s" [selected]="statusFilter() === s">{{ s }}</option>
                }
              </select>
            </label>
            <label class="filter">
              <span class="filter__lbl">{{ 'observe.filter.corr' | t }}</span>
              <input
                class="input"
                type="search"
                data-filter="correlation"
                [value]="corrFilter()"
                (input)="setCorr($event)"
                [attr.aria-label]="'observe.filter.corr' | t"
              />
            </label>
          </div>
        }

        @if (events().length) {
          <div class="table-wrap">
            <table class="table" [attr.aria-rowcount]="events().length + 1">
              <thead>
                <tr>
                  <th scope="col">{{ 'observe.col.kind' | t }}</th>
                  <th scope="col">{{ 'observe.col.at' | t }}</th>
                  <th scope="col">{{ 'observe.col.duration' | t }}</th>
                  <th scope="col">{{ 'observe.col.status' | t }}</th>
                  <th scope="col">{{ 'observe.col.origin' | t }}</th>
                  <th scope="col">{{ 'observe.col.correlation' | t }}</th>
                  <th scope="col">{{ 'observe.col.detail' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (r of pagedRows(); track r.position) {
                  <tr [attr.aria-rowindex]="r.position + 1">
                    <td>
                      <code>{{ r.e.kind }}</code>
                    </td>
                    <td class="nowrap">{{ r.at }}</td>
                    <td class="nowrap">
                      @if (r.dur) {
                        {{ r.dur }}
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td>
                      <ui-state-badge [state]="r.tone" [labelOverride]="r.e.status" />
                    </td>
                    <td>{{ r.e.origin }}</td>
                    <td>
                      @if (r.cidFull; as cid) {
                        <code class="corr" [attr.title]="cid">{{ r.cid }}</code>
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td>
                      @if (r.e.detail) {
                        {{ r.e.detail }}
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <ui-pager
            [total]="events().length"
            [pageSize]="EVENTS_PAGE"
            [page]="slice().page"
            [label]="'observe.events' | t"
            (pageChange)="eventsPage.set($event)"
          />
        } @else {
          <!-- Empty ≠ unverified: the endpoint answered, it just has
               no events (or the filters exclude all of them). -->
          @if (r.events.length) {
            <ui-empty icon="search" data-empty="no-matches" [title]="'observe.noMatches' | t" />
          } @else {
            <ui-empty
              icon="inbox"
              data-empty="events"
              [title]="'observe.empty' | t"
              [hint]="'observe.empty.hint' | t"
            />
          }
        }
      </section>
    }
  `,
  styles: `
    .local {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-4);
      padding: var(--space-3);
      border: 1px dashed var(--border);
      border-radius: var(--radius-md);
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
    .local ui-icon {
      flex: none;
    }
    .card {
      margin-bottom: var(--space-4);
    }
    .sec__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .sec__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .src {
      margin: 4px 0 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .muted {
      color: var(--fg-muted);
    }
    .unv {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      border: 1px dashed color-mix(in srgb, var(--warn) 55%, transparent);
      background: var(--warn-bg);
      font-size: var(--font-sm);
    }
    .counters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: var(--space-3);
    }
    .counter {
      display: grid;
      gap: 2px;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--bg-hover) 40%, transparent);
    }
    .counter__value {
      font-family: var(--font-mono);
      font-size: var(--font-2xl);
      font-weight: 650;
    }
    .counter__key {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      overflow-wrap: anywhere;
    }
    .truncated {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-3);
      padding: var(--space-2) var(--space-3);
      border: 1px dashed color-mix(in srgb, var(--warn) 55%, transparent);
      border-radius: var(--radius-md);
      background: var(--warn-bg);
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
    .truncated ui-icon {
      color: var(--warn);
      flex: none;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .filter {
      display: grid;
      gap: 4px;
      min-width: 160px;
    }
    .filter .input {
      min-width: 200px;
    }
    .filter__lbl {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .table-wrap {
      overflow-x: auto;
    }
    .table {
      min-width: 820px;
    }
    .nowrap {
      white-space: nowrap;
    }
    .corr {
      font-size: var(--font-xs);
    }
  `,
})
export class ObservePage implements OnInit {
  private readonly api = inject(PortalApi);

  /** Route `?cid=` deep-link (withComponentInputBinding) — the task
   *  detail's "correlated events" link lands here. Seeds the visible
   *  correlation filter; clearing it edits the field, never hidden state. */
  readonly cid = input('');

  /** Single source — 404/PORTAL-NOT-FOUND → UNVERIFIED capability. */
  readonly src = new Source<MetricsReport>();
  readonly report = computed(() => this.src.data());

  readonly kindFilter = signal<string | null>(null);
  readonly statusFilter = signal<string | null>(null);
  readonly corrFilter = signal('');

  /** Cycle 4 §7 — the events table renders a page-size slice so the DOM
   *  stays bounded at any buffer depth; the range text keeps the slice
   *  honest (never mistaken for the whole window). */
  readonly eventsPage = signal(0);
  readonly EVENTS_PAGE = 100;

  /** Counter entries sorted by key — the map order is never trusted. */
  readonly counters = computed(() =>
    Object.entries(this.report()?.counters ?? {})
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  );

  /** Filter options come from observed values only — never a fixed list. */
  readonly kindOptions = computed(() =>
    [...new Set((this.report()?.events ?? []).map((e) => e.kind))].sort((a, b) =>
      a.localeCompare(b),
    ),
  );
  readonly statusOptions = computed(() =>
    [...new Set((this.report()?.events ?? []).map((e) => e.status))].sort((a, b) =>
      a.localeCompare(b),
    ),
  );

  /**
   * Client-side filter + deterministic sort: `at` descending; unparsable
   * timestamps sink to the end; ties keep the backend's own order
   * (Array.prototype.sort is stable).
   */
  readonly events = computed(() => {
    const kind = this.kindFilter();
    const status = this.statusFilter();
    const corr = this.corrFilter().trim();
    return (this.report()?.events ?? [])
      .filter(
        (e) =>
          (kind === null || e.kind === kind) &&
          (status === null || e.status === status) &&
          (corr === '' || (e.correlation_id ?? '').includes(corr)),
      )
      .slice()
      .sort((a, b) => this.timeOf(b.at) - this.timeOf(a.at));
  });

  /** Page slice + view-model rows — formatting resolved once per
   *  rendered row, not per change-detection pass. */
  readonly slice = computed(() =>
    pageSlice(this.events().length, this.EVENTS_PAGE, this.eventsPage()),
  );
  readonly pagedRows = computed<ObserveRow[]>(() =>
    this.events()
      .slice(this.slice().start, this.slice().end)
      .map((e, i) => ({
        e,
        position: this.slice().start + i + 1,
        at: this.fmt(e.at),
        tone: this.statusKind(e.status),
        dur: e.duration_ms !== null ? `${e.duration_ms} ms` : null,
        cid: e.correlation_id ? this.short(e.correlation_id) : null,
        cidFull: e.correlation_id,
      })),
  );

  readonly stamp = stamp;

  constructor() {
    // Data/filter changes re-slice the window — back to page 1 so a
    // stale offset can never render an empty view.
    effect(() => {
      this.events();
      this.eventsPage.set(0);
    });
    void this.load();
  }

  ngOnInit(): void {
    const seed = this.cid();
    if (seed) this.corrFilter.set(seed);
  }

  async load(): Promise<void> {
    await this.src.load(() => this.api.metrics());
  }

  setKind(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.kindFilter.set(v === '' ? null : v);
  }

  setStatus(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.statusFilter.set(v === '' ? null : v);
  }

  setCorr(e: Event): void {
    this.corrFilter.set((e.target as HTMLInputElement).value);
  }

  /** Badge tone for a free-form adapter status — label stays verbatim. */
  statusKind(status: string): string {
    const s = (status || '').toLowerCase();
    if (['ok', 'done', 'completed', 'success', 'succeeded', 'pass', 'passed'].includes(s))
      return 'supported';
    if (['failed', 'fail', 'error', 'refused', 'denied'].includes(s)) return 'error';
    if (['skipped', 'cancelled', 'canceled', 'partial', 'degraded'].includes(s)) return 'warn';
    if (['running', 'pending', 'started', 'in_progress', 'planning', 'verifying'].includes(s))
      return 'info';
    return 'muted';
  }

  /** Milliseconds before epoch; unparsable sorts last in a desc list. */
  private timeOf(at: string): number {
    const t = Date.parse(at);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  }

  /** Localized date+time; falls back to the raw value — still real data. */
  fmt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  /** Correlation ids get truncated for display; `title` keeps the full id. */
  short(id: string): string {
    return id.length > 10 ? `${id.slice(0, 8)}…` : id;
  }
}
