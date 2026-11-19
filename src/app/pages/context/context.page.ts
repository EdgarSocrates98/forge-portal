import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { PortalEvent, ResourceEntry, WorkspaceResources } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, stamp } from '../explorer/forges.data';
import { PortalEventReport } from '../../core/api/api.models';

/**
 * Context Observatory (cycle 16.1 §11.4) — what the workspace knows
 * about resources, rendered with a strict honesty contract:
 *
 *   discovered   GET /api/v1/resources — real catalog, counted by
 *                kind/forge; `unavailable` entries keep their declared
 *                unavailable_reason.
 *   selected /   no adapter surface records selection or retrieval —
 *   retrieved    the rows render UNVERIFIED with an explicit "not
 *                recorded" note, never a zero dressed up as data.
 *   cache        GET /api/v1/events — real `operation.start`
 *                (metadata.cache=hit) and `cache.store`
 *                (metadata.cache=miss|bypass) records, per op target.
 *   bytes        never recorded by the adapter → UNVERIFIED.
 *   tokens       never observable → UNVERIFIED ("estimate" only if a
 *                producer actually reports one — none does today).
 *   failures     real `operation.end` refused|timeout|failed +
 *                `request.rejected` records from the bounded window.
 *
 * A truncated window says so; an absent /events op degrades only the
 * event-derived rows, never the resource inventory.
 */
interface CacheRow {
  target: string;
  hit: number;
  miss: number;
  bypass: number;
}

@Component({
  selector: 'page-context',
  standalone: true,
  imports: [RouterLink, TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'ctx.title' | t" [subtitle]="'ctx.subtitle' | t">
      <button class="btn" [disabled]="resSrc.loading() || evSrc.loading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <p class="local" role="note">
      <ui-icon name="shield-check" [size]="15" />
      <span>{{ 'ctx.localOnly' | t }}</span>
    </p>

    <!-- ── Discovered resources ──────────────────────────────────── -->
    <section class="card" data-section="discovered">
      <div class="sec__head">
        <div>
          <h2>{{ 'ctx.discovered' | t }}</h2>
          <p class="src">
            <code>GET /api/v1/resources</code>
            @if (resSrc.loadedAt(); as ts) {
              <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
            }
          </p>
        </div>
        <a class="linklike" routerLink="/resources">{{ 'state.viewDetails' | t }}</a>
      </div>

      @if (resSrc.loading() && !resSrc.data()) {
        <div role="status"><ui-skeleton kind="row" [lines]="2" /></div>
      }
      @if (resSrc.error(); as e) {
        <ui-error [error]="e" (retry)="load()" />
      }
      @if (resSrc.unavailable()) {
        <p class="unv">
          <ui-state-badge state="UNVERIFIED" /><span class="muted">{{
            'ctx.resUnavailable' | t
          }}</span>
        </p>
      }
      @if (resSrc.data(); as ws) {
        <div class="stats">
          <div class="stat">
            <span class="stat__v">{{ ws.resources.length }}</span
            ><span class="stat__l">{{ 'ctx.stat.total' | t }}</span>
          </div>
          <div class="stat">
            <span class="stat__v">{{ availableCount(ws.resources) }}</span
            ><span class="stat__l">{{ 'ctx.stat.available' | t }}</span>
          </div>
          <div class="stat">
            <span class="stat__v">{{ unavailableCount(ws.resources) }}</span
            ><span class="stat__l">{{ 'ctx.stat.unavailable' | t }}</span>
          </div>
          <div class="stat">
            <span class="stat__v">{{ ws.forges.length }}</span
            ><span class="stat__l">{{ 'ctx.stat.forges' | t }}</span>
          </div>
        </div>
        @if (byKind(ws.resources).length) {
          <ul class="chips">
            @for (k of byKind(ws.resources); track k.kind) {
              <li class="chip">
                <code>{{ k.kind }}</code> ×{{ k.count }}
              </li>
            }
          </ul>
        }
        @if (unavailableEntries(ws.resources).length) {
          <h3 class="sub">{{ 'ctx.unavailableResources' | t }}</h3>
          <ul class="unv-list">
            @for (r of unavailableEntries(ws.resources); track r.forge_id + '/' + r.id) {
              <li>
                <code>{{ r.forge_id }}/{{ r.id }}</code>
                <span class="muted"> — {{ r.unavailable_reason ?? ('state.absent' | t) }}</span>
              </li>
            }
          </ul>
        }
        @if (!ws.resources.length) {
          <ui-empty icon="inbox" [title]="'ctx.noResources' | t" />
        }
      }
    </section>

    <!-- ── Selection / retrieval — not recorded by any surface ───── -->
    <section class="card" data-section="selection">
      <div class="sec__head">
        <div>
          <h2>{{ 'ctx.selected' | t }}</h2>
          <p class="src"><code>—</code></p>
        </div>
      </div>
      <dl class="grid">
        <div class="cell">
          <dt>{{ 'ctx.selected' | t }}</dt>
          <dd>
            <ui-state-badge state="UNVERIFIED" /><small class="muted">{{
              'ctx.notRecorded' | t
            }}</small>
          </dd>
        </div>
        <div class="cell">
          <dt>{{ 'ctx.retrieved' | t }}</dt>
          <dd>
            <ui-state-badge state="UNVERIFIED" /><small class="muted">{{
              'ctx.notRecorded' | t
            }}</small>
          </dd>
        </div>
        <div class="cell">
          <dt>{{ 'ctx.bytes' | t }}</dt>
          <dd>
            <ui-state-badge state="UNVERIFIED" /><small class="muted">{{
              'ctx.notRecorded' | t
            }}</small>
          </dd>
        </div>
        <div class="cell">
          <dt>{{ 'ctx.tokens' | t }}</dt>
          <dd>
            <ui-state-badge state="UNVERIFIED" /><small class="muted">{{
              'ctx.tokens.hint' | t
            }}</small>
          </dd>
        </div>
      </dl>
    </section>

    <!-- ── Cache + failures — real event records ─────────────────── -->
    <section class="card" data-section="cache">
      <div class="sec__head">
        <div>
          <h2>{{ 'ctx.cache' | t }}</h2>
          <p class="src">
            <code>GET /api/v1/events</code>
            @if (evSrc.loadedAt(); as ts) {
              <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
            }
          </p>
        </div>
      </div>

      @if (evSrc.loading() && !evSrc.data()) {
        <div role="status"><ui-skeleton kind="row" [lines]="2" /></div>
      }
      @if (evSrc.error(); as e) {
        <ui-error [error]="e" (retry)="load()" />
      }
      @if (evSrc.unavailable()) {
        <p class="unv">
          <ui-state-badge state="UNVERIFIED" /><span class="muted">{{
            'ctx.evUnavailable' | t
          }}</span>
        </p>
      }
      @if (evSrc.data(); as rep) {
        @if (rep.truncated) {
          <p class="truncated" role="note">
            <ui-icon name="alert" [size]="14" />
            <span>{{ 'ctx.truncated' | t: { capacity: rep.capacity, dropped: rep.dropped } }}</span>
          </p>
        }
        @if (cacheRows(rep.events).length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">{{ 'ctx.col.target' | t }}</th>
                  <th scope="col">{{ 'ctx.col.hit' | t }}</th>
                  <th scope="col">{{ 'ctx.col.miss' | t }}</th>
                  <th scope="col">{{ 'ctx.col.bypass' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of cacheRows(rep.events); track row.target) {
                  <tr>
                    <td>
                      <code>{{ row.target }}</code>
                    </td>
                    <td>{{ row.hit }}</td>
                    <td>{{ row.miss }}</td>
                    <td>{{ row.bypass }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="muted">{{ 'ctx.noCache' | t }}</p>
        }

        <h3 class="sub">{{ 'ctx.failures' | t }}</h3>
        @if (failures(rep.events).length) {
          <ul class="fail-list">
            @for (f of failures(rep.events); track $index) {
              <li>
                <ui-state-badge
                  [state]="f.status ?? 'UNVERIFIED'"
                  [labelOverride]="f.status ?? null"
                />
                <code>{{ f.event_type }}</code>
                @if (f.target) {
                  <span class="muted"> → {{ f.target }}</span>
                }
                @if (f.timestamp) {
                  <span class="muted"> · {{ stamp(f.timestamp) }}</span>
                }
                @if (f.duration_ms !== undefined) {
                  <span class="muted"> · {{ f.duration_ms }} ms</span>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="muted">{{ 'ctx.noFailures' | t }}</p>
        }
      }
    </section>
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
      padding: var(--space-3);
      border-radius: var(--radius-md);
      font-size: var(--font-sm);
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .stat {
      display: grid;
      gap: 2px;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }
    .stat__v {
      font-family: var(--font-mono);
      font-size: var(--font-2xl);
      font-weight: 650;
    }
    .stat__l {
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      list-style: none;
      padding: 0;
      margin: 0 0 var(--space-3);
    }
    .chip {
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      padding: 2px 10px;
      font-size: var(--font-xs);
    }
    .sub {
      font-size: var(--font-sm);
      font-weight: 650;
      margin: var(--space-3) 0 var(--space-2);
    }
    .unv-list,
    .fail-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 6px;
      font-size: var(--font-sm);
    }
    .fail-list li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--space-3);
      margin: 0;
    }
    .cell {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      display: grid;
      gap: 6px;
    }
    .cell dt {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .cell dd {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: var(--font-sm);
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
    .table-wrap {
      overflow-x: auto;
      margin-bottom: var(--space-3);
    }
  `,
})
export class ContextPage {
  private readonly api = inject(PortalApi);

  readonly resSrc = new Source<WorkspaceResources>();
  readonly evSrc = new Source<PortalEventReport>();

  readonly stamp = stamp;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    await Promise.all([
      this.resSrc.load(() => this.api.workspaceResources()),
      this.evSrc.load(() => this.api.events()),
    ]);
  }

  availableCount(rs: ResourceEntry[]): number {
    return rs.filter((r) => r.availability === 'available').length;
  }
  unavailableCount(rs: ResourceEntry[]): number {
    return rs.filter((r) => r.availability === 'unavailable').length;
  }
  unavailableEntries(rs: ResourceEntry[]): ResourceEntry[] {
    return rs.filter((r) => r.availability === 'unavailable');
  }
  byKind(rs: ResourceEntry[]): { kind: string; count: number }[] {
    const m = new Map<string, number>();
    for (const r of rs) {
      const k = r.kind ?? '—'; // kind absent stays an honest placeholder
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }

  /** Real cache evidence: `operation.start` metadata.cache='hit' and
   *  `cache.store` metadata.cache='miss'|'bypass' — grouped per target. */
  cacheRows(events: PortalEvent[]): CacheRow[] {
    const m = new Map<string, CacheRow>();
    const row = (t: string) => {
      let r = m.get(t);
      if (!r) {
        r = { target: t, hit: 0, miss: 0, bypass: 0 };
        m.set(t, r);
      }
      return r;
    };
    for (const e of events) {
      const meta = e.metadata ?? {};
      const target = typeof e.target === 'string' ? e.target : '—';
      if (e.event_type === 'operation.start' && meta['cache'] === 'hit') row(target).hit++;
      if (e.event_type === 'cache.store') {
        if (meta['cache'] === 'bypass') row(target).bypass++;
        else if (meta['cache'] === 'miss') row(target).miss++;
      }
    }
    return [...m.values()].sort((a, b) => a.target.localeCompare(b.target));
  }

  /** Real failure records only — refused/timeout/failed op ends and
   *  request rejections; nothing is inferred from silence. */
  failures(events: PortalEvent[]): PortalEvent[] {
    const BAD = new Set(['refused', 'timeout', 'failed', 'rejected', 'denied']);
    return events.filter(
      (e) =>
        (e.event_type === 'operation.end' || e.event_type === 'request.rejected') &&
        BAD.has((e.status ?? '').toLowerCase()),
    );
  }
}
