import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { ApiError } from '../../core/api/api.error';
import { ErrorState } from '../../shared/error-state';
import { EmptyState } from '../../shared/empty-state';
import { UiSkeleton } from '../../shared/skeleton';
import { StateBadge } from '../../shared/state-badge';
import { UiIcon } from '../../shared/icon';
import { SentinelApi } from '../../sentinel/sentinel-api.service';
import {
  SentinelIncidentDetailResponse,
  SentinelIncidentListResponse,
  SentinelInvestigationResponse,
  SentinelTimelineResponse,
} from '../../sentinel/sentinel.models';
import {
  confidenceRank,
  isAuthFailure,
  sentinelKind,
} from '../../sentinel/sentinel-states';

interface TimelineItem {
  at: string;
  kind: string;
  actor: string;
  title: string;
  detail: string;
  confidence?: string;
}

interface IncidentBundle {
  detail: SentinelIncidentDetailResponse;
  timeline: SentinelTimelineResponse | null;
  timelineError: ApiError | null;
}

const LADDER = ['OBSERVED', 'CORRELATED', 'HYPOTHESIZED', 'VERIFIED'] as const;

/**
 * Sentinel incident inventory + detail: hypotheses ladder
 * (OBSERVED→CORRELATED→HYPOTHESIZED→VERIFIED), journal timeline merged
 * with change events + dependency observations, evidence refs, unknowns,
 * and the authorized "run investigation" action.
 */
@Component({
  selector: 'sentinel-incidents',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TPipe, ErrorState, EmptyState, UiSkeleton, StateBadge, UiIcon, DatePipe],
  template: `
    @if (loading()) {
      <ui-skeleton kind="card" /><ui-skeleton kind="text" [lines]="4" />
    } @else if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    } @else if (!selectedId()) {
      <div class="filter" role="group" [attr.aria-label]="'sentinel.inc.filter' | t">
        <button class="btn" type="button" [attr.data-active]="statusFilter() === 'open' || null" (click)="setFilter('open')">
          {{ 'sentinel.inc.open' | t }}
        </button>
        <button class="btn" type="button" [attr.data-active]="statusFilter() === 'all' || null" (click)="setFilter('all')">
          {{ 'sentinel.inc.all' | t }}
        </button>
      </div>
      @if (incidents().length === 0) {
        <ui-empty icon="inbox" [title]="'sentinel.inc.empty' | t" [hint]="'sentinel.inc.emptyDesc' | t" />
      } @else {
        <div class="table-wrap card">
          <table>
            <thead>
              <tr>
                <th scope="col">{{ 'sentinel.col.incident' | t }}</th>
                <th scope="col">{{ 'sentinel.col.severity' | t }}</th>
                <th scope="col">{{ 'sentinel.col.status' | t }}</th>
                <th scope="col">{{ 'sentinel.col.service' | t }}</th>
                <th scope="col">{{ 'sentinel.col.detected' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (i of incidents(); track i.incident_id) {
                <tr class="row" tabindex="0" (click)="select(i.incident_id)" (keydown.enter)="select(i.incident_id)">
                  <td>
                    <strong>{{ i.title }}</strong>
                    <div class="sub mono">{{ i.incident_id }}</div>
                  </td>
                  <td><ui-state-badge [state]="i.severity" [kindOverride]="kind(i.severity)" [labelOverride]="stateLabel(i.severity)" /></td>
                  <td><ui-state-badge [state]="i.status" [kindOverride]="kind(i.status)" [labelOverride]="stateLabel(i.status)" /></td>
                  <td class="mono">{{ i.service_id }}</td>
                  <td class="num">{{ i.detected_at | date:'short' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    } @else {
      <button class="btn back" type="button" (click)="select(null)">
        <ui-icon name="chevron-left" [size]="14" /> {{ 'sentinel.backToIncidents' | t }}
      </button>
      @if (detailLoading()) {
        <ui-skeleton kind="card" /><ui-skeleton kind="text" [lines]="4" />
      } @else if (detailError(); as de) {
        <ui-error [error]="de" (retry)="loadDetail(selectedId()!)" />
      } @else if (bundle(); as b) {
        <section class="card hero">
          <div class="hero__head">
            <div>
              <h2>{{ b.detail.detail.incident.title }}</h2>
              <div class="sub mono">{{ b.detail.detail.incident.incident_id }} · {{ b.detail.detail.incident.service_id }}</div>
            </div>
            <div class="chips">
              <ui-state-badge [state]="b.detail.detail.incident.severity" [kindOverride]="kind(b.detail.detail.incident.severity)" [labelOverride]="stateLabel(b.detail.detail.incident.severity)" />
              <ui-state-badge [state]="b.detail.detail.incident.status" [kindOverride]="kind(b.detail.detail.incident.status)" [labelOverride]="stateLabel(b.detail.detail.incident.status)" />
            </div>
          </div>
          <p class="muted">
            {{ 'sentinel.inc.firstObserved' | t }} {{ b.detail.detail.incident.first_observed_at | date:'medium' }}
            · {{ 'sentinel.col.detected' | t }} {{ b.detail.detail.incident.detected_at | date:'medium' }}
            @if (b.detail.detail.incident.resolved_at) {
              · {{ 'sentinel.inc.resolved' | t }} {{ b.detail.detail.incident.resolved_at | date:'medium' }}
            }
            · {{ 'sentinel.inc.revision' | t }} {{ b.detail.detail.incident.revision }}
          </p>
          @if (b.detail.detail.incident.rule_refs.length) {
            <p class="muted mono small">
              @for (r of b.detail.detail.incident.rule_refs; track r.rule_id) {
                <span class="rule">{{ r.detector_id }}@{{ r.detector_version }} · {{ r.rule_id }}@{{ r.rule_revision }}</span>
              }
            </p>
          }
          @if (b.detail.detail.incident.limitations.length) {
            <p class="unknowns">{{ 'sentinel.limitations' | t }}: {{ b.detail.detail.incident.limitations.join(' · ') }}</p>
          }
        </section>

        <!-- hypothesis ladder -->
        <section class="card">
          <h3>{{ 'sentinel.inc.hypotheses' | t }}</h3>
          @if (b.detail.detail.incident.hypotheses.length === 0) {
            <p class="muted">{{ 'sentinel.inc.noHypotheses' | t }}</p>
          } @else {
            @for (h of b.detail.detail.incident.hypotheses; track h.hypothesis_id) {
              <div class="hyp card-inset">
                <div class="ladder" role="list" [attr.aria-label]="'sentinel.inc.ladder' | t">
                  @for (rung of ladder; track rung) {
                    <span class="rung" role="listitem"
                      [attr.data-active]="confidenceRank(h.confidence) >= confidenceRank(rung) || null"
                      [attr.data-current]="h.confidence === rung || null">
                      {{ stateLabel(rung) }}
                    </span>
                  }
                  @if (h.confidence === 'REFUTED') {
                    <span class="rung rung--refuted">{{ stateLabel('REFUTED') }}</span>
                  }
                </div>
                <p class="hyp__text">{{ h.text }}</p>
                <p class="muted small">
                  {{ 'sentinel.inc.evidenceFor' | t }} {{ h.evidence_for.length }}
                  · {{ 'sentinel.inc.evidenceAgainst' | t }} {{ h.evidence_against.length }}
                  · {{ h.updated_at | date:'short' }}
                  @if (h.note) { · {{ h.note }} }
                </p>
                @if (h.unknowns.length) {
                  <p class="unknowns">{{ 'sentinel.unknowns' | t }}: {{ h.unknowns.join(' · ') }}</p>
                }
              </div>
            }
          }
          @if (b.detail.detail.incident.verifications.length) {
            <h4>{{ 'sentinel.inc.verifications' | t }}</h4>
            @for (v of b.detail.detail.incident.verifications; track v.verification_id) {
              <p class="ver">
                <ui-state-badge [state]="v.verdict" [kindOverride]="kind(v.verdict)" [labelOverride]="stateLabel(v.verdict)" />
                <span class="mono">{{ v.verification_id }}</span> — {{ v.executor }} · {{ v.executed_at | date:'short' }}
                <span class="muted">{{ v.detail }}</span>
              </p>
            }
          }
        </section>

        <!-- anomalies -->
        @if (b.detail.detail.anomalies.length) {
          <section class="card">
            <h3>{{ 'sentinel.inc.anomalies' | t }}</h3>
            @for (a of b.detail.detail.anomalies; track a.anomaly_id) {
              <div class="card-inset">
                <p>
                  <ui-state-badge [state]="a.severity" [kindOverride]="kind(a.severity)" [labelOverride]="stateLabel(a.severity)" />
                  <ui-state-badge [state]="a.status" [kindOverride]="kind(a.status)" [labelOverride]="stateLabel(a.status)" />
                  <span class="mono">{{ a.anomaly_id }}</span>
                  <span class="muted">{{ a.window_start | date:'shortTime' }}–{{ a.window_end | date:'shortTime' }}</span>
                </p>
                <p>{{ a.explanation.summary }}</p>
                @if (a.explanation.math) {
                  <pre class="math mono">{{ a.explanation.math }}</pre>
                }
                @if (a.unknowns.length) {
                  <p class="unknowns">{{ 'sentinel.unknowns' | t }}: {{ a.unknowns.join(' · ') }}</p>
                }
              </div>
            }
          </section>
        }

        <!-- evidence -->
        <section class="card">
          <h3>{{ 'sentinel.inc.evidence' | t }}</h3>
          @if (b.detail.detail.evidence.length === 0 && b.detail.detail.evidence_unresolved.length === 0) {
            <p class="muted">{{ 'sentinel.inc.noEvidence' | t }}</p>
          }
          @for (ev of b.detail.detail.evidence; track ev.evidence_id) {
            <p class="mono small">
              {{ ev.evidence_id }} · {{ ev.kind }} · {{ ev.size_bytes }}B · {{ ev.hash.slice(0, 23) }}…
              @if (ev.truncated) { <span class="muted">({{ 'sentinel.inc.truncated' | t }})</span> }
            </p>
          }
          @if (b.detail.detail.evidence_unresolved.length) {
            <p class="unknowns">
              {{ 'sentinel.inc.unresolvedEvidence' | t }}:
              <code>{{ b.detail.detail.evidence_unresolved.join(', ') }}</code>
            </p>
          }
        </section>

        <!-- timeline -->
        <section class="card">
          <h3>{{ 'sentinel.inc.timeline' | t }}</h3>
          @if (b.timelineError; as te) {
            <ui-error [error]="te" />
          } @else if (b.timeline) {
            @if (timelineItems(b.timeline).length === 0) {
              <p class="muted">{{ 'sentinel.inc.timelineEmpty' | t }}</p>
            }
            <ol class="timeline">
              @for (item of timelineItems(b.timeline); track $index) {
                <li class="tl">
                  <span class="tl__at mono">{{ item.at | date:'short' }}</span>
                  <div>
                    <ui-state-badge [state]="item.kind" kind="muted" [labelOverride]="item.kind" />
                    @if (item.confidence) {
                      <ui-state-badge [state]="item.confidence" [kindOverride]="kind(item.confidence)" [labelOverride]="stateLabel(item.confidence)" />
                    }
                    <strong>{{ item.title }}</strong>
                    @if (item.detail) { <div class="muted small">{{ item.detail }}</div> }
                    <div class="muted small">{{ item.actor }}</div>
                  </div>
                </li>
              }
            </ol>
            @if (b.timeline.timeline.truncated) {
              <p class="unknowns">{{ 'sentinel.inc.timelineTruncated' | t }}</p>
            }
            @if (b.timeline.timeline.unknowns.length) {
              <p class="unknowns">{{ 'sentinel.unknowns' | t }}: {{ b.timeline.timeline.unknowns.join(' · ') }}</p>
            }
          }
        </section>

        <!-- investigations -->
        <section class="card">
          <div class="inv__head">
            <h3>{{ 'sentinel.inv.title' | t }}</h3>
            <button class="btn btn--primary" type="button" [disabled]="running()" (click)="runInvestigation()">
              {{ running() ? ('sentinel.inv.running' | t) : ('sentinel.inv.run' | t) }}
            </button>
          </div>
          <div aria-live="polite">
            @if (invError(); as ie) {
              @if (isAuth(ie)) {
                <p class="unknowns" role="alert">{{ 'sentinel.inv.blocked' | t }} <code>{{ ie.body.code }}</code></p>
              } @else {
                <ui-error [error]="ie" />
              }
            }
            @if (investigation(); as inv) {
              <p>
                <ui-state-badge [state]="inv.investigation.status" [kindOverride]="kind(inv.investigation.status)" [labelOverride]="stateLabel(inv.investigation.status)" />
                <code class="mono">{{ inv.investigation.investigation_id }}</code>
                @if (inv.replayed) { <span class="muted">({{ 'sentinel.inv.replayed' | t }})</span> }
              </p>
              @if (investigationSummary(); as s) {
                <dl class="pack">
                  <dt>{{ 'sentinel.inv.verdict' | t }}</dt><dd>{{ s.verdict || '—' }}</dd>
                  <dt>{{ 'sentinel.inv.suspectedOrigin' | t }}</dt><dd class="mono">{{ s.suspected || '—' }}</dd>
                  <dt>{{ 'sentinel.inv.unknowns' | t }}</dt><dd>{{ s.unknowns || '—' }}</dd>
                  <dt>{{ 'sentinel.inv.structural' | t }}</dt><dd class="mono">{{ s.structural || '—' }}</dd>
                </dl>
              }
            }
          </div>
          @if (b.timeline?.timeline.investigations?.length) {
            <h4>{{ 'sentinel.inv.prior' | t }}</h4>
            @for (pi of b.timeline!.timeline.investigations; track pi.investigation_id) {
              <p class="mono small">
                {{ pi.investigation_id }} ·
                <ui-state-badge [state]="pi.status" [kindOverride]="kind(pi.status)" [labelOverride]="stateLabel(pi.status)" />
                · {{ pi.created_at | date:'short' }}
              </p>
            }
          }
        </section>
      }
    }
  `,
  styles: `
    .filter {
      display: flex;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .filter .btn[data-active] {
      border-color: var(--accent);
      color: var(--accent-ink);
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--font-sm);
    }
    th {
      text-align: left;
      padding: var(--space-3);
      color: var(--fg-muted);
      font-size: var(--font-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    td {
      padding: var(--space-3);
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .row {
      cursor: pointer;
    }
    .row:hover td,
    .row:focus-visible td {
      background: var(--bg-elevated);
    }
    .num {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .mono {
      font-family: var(--font-mono);
      font-size: var(--font-xs);
    }
    .sub {
      color: var(--fg-muted);
      margin-top: 2px;
    }
    .small {
      font-size: var(--font-xs);
    }
    .muted {
      color: var(--fg-muted);
    }
    .back {
      margin-bottom: var(--space-4);
    }
    section.card {
      margin-bottom: var(--space-4);
      padding: var(--space-5);
    }
    section.card h3 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-base);
    }
    section.card h4 {
      margin: var(--space-4) 0 var(--space-2);
      font-size: var(--font-sm);
    }
    .hero__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .hero__head h2 {
      margin: 0;
    }
    .chips {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .rule {
      margin-right: var(--space-3);
      display: inline-block;
    }
    .card-inset {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .ladder {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      margin-bottom: var(--space-2);
    }
    .rung {
      font-size: var(--font-xs);
      font-weight: 650;
      padding: 2px 10px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--border);
      color: var(--fg-muted);
      background: var(--bg);
    }
    .rung[data-active] {
      border-color: var(--accent);
      color: var(--accent-ink);
    }
    .rung[data-current] {
      background: var(--accent);
      color: var(--accent-ink, #fff);
    }
    .rung--refuted {
      border-color: var(--error);
      color: var(--error);
    }
    .hyp__text {
      margin: 0 0 6px;
      font-size: var(--font-sm);
    }
    .math {
      font-size: var(--font-xs);
      overflow-x: auto;
      background: var(--bg);
      padding: var(--space-2);
      border-radius: var(--radius-sm);
      max-height: 120px;
      overflow-y: auto;
    }
    .unknowns {
      color: var(--warn);
      font-size: var(--font-xs);
      margin: var(--space-2) 0 0;
    }
    .ver {
      font-size: var(--font-sm);
      margin: var(--space-2) 0;
    }
    .timeline {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .tl {
      display: grid;
      grid-template-columns: 150px 1fr;
      gap: var(--space-3);
      padding: var(--space-3) 0;
      border-bottom: 1px solid var(--border);
    }
    .tl__at {
      color: var(--fg-muted);
      white-space: nowrap;
    }
    .inv__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .inv__head h3 {
      margin: 0;
    }
    .pack {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 4px var(--space-3);
      font-size: var(--font-sm);
      margin: var(--space-3) 0;
    }
    .pack dt {
      color: var(--fg-muted);
    }
    .pack dd {
      margin: 0;
    }
  `,
})
export class SentinelIncidents {
  private readonly api = inject(SentinelApi);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly selectedId = input<string | null>(null);

  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly incidents = signal<NonNullable<SentinelIncidentListResponse['incidents']>>([]);
  readonly statusFilter = signal<'open' | 'all'>('open');
  readonly detailLoading = signal(false);
  readonly detailError = signal<ApiError | null>(null);
  readonly bundle = signal<IncidentBundle | null>(null);
  readonly running = signal(false);
  readonly investigation = signal<SentinelInvestigationResponse | null>(null);
  readonly invError = signal<ApiError | null>(null);

  readonly kind = sentinelKind;
  readonly confidenceRank = confidenceRank;
  readonly isAuth = isAuthFailure;
  readonly ladder = LADDER;

  constructor() {
    effect(() => {
      const id = this.selectedId();
      if (id) void this.loadDetail(id);
      else {
        this.bundle.set(null);
        this.investigation.set(null);
        this.invError.set(null);
      }
    });
    void this.load();
  }

  select(id: string | null): void {
    void this.router.navigate([], {
      queryParams: { incident: id },
      queryParamsHandling: 'merge',
    });
  }

  setFilter(f: 'open' | 'all'): void {
    this.statusFilter.set(f);
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await firstValueFrom(
        this.statusFilter() === 'open'
          ? this.api.incidents({ status: 'open' })
          : this.api.incidents(),
      );
      this.incidents.set(res.incidents);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  async loadDetail(id: string): Promise<void> {
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.bundle.set(null);
    this.investigation.set(null);
    this.invError.set(null);
    try {
      const detail = await firstValueFrom(this.api.incident(id));
      let timeline: SentinelTimelineResponse | null = null;
      let timelineError: ApiError | null = null;
      try {
        timeline = await firstValueFrom(this.api.incidentTimeline(id));
      } catch (e) {
        timelineError = e instanceof ApiError ? e : new ApiError(0);
      }
      this.bundle.set({ detail, timeline, timelineError });
    } catch (e) {
      this.detailError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.detailLoading.set(false);
    }
  }

  async runInvestigation(): Promise<void> {
    const id = this.selectedId();
    if (!id) return;
    this.running.set(true);
    this.invError.set(null);
    try {
      this.investigation.set(
        await firstValueFrom(this.api.startInvestigation(id)),
      );
    } catch (e) {
      this.invError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.running.set(false);
    }
  }

  investigationSummary() {
    const r = this.investigation()?.investigation.result;
    if (!r || typeof r !== 'object') return null;
    return {
      verdict: String(r['verdict'] ?? ''),
      suspected: typeof r['suspected_origin'] === 'string' ? r['suspected_origin'] : JSON.stringify(r['suspected_origin'] ?? ''),
      unknowns: Array.isArray(r['unknowns']) ? (r['unknowns'] as unknown[]).join(' · ') : '',
      structural:
        (r['context_pack'] as Record<string, unknown> | undefined)?.['structural_context'] != null
          ? JSON.stringify(
              (r['context_pack'] as Record<string, unknown>)['structural_context'],
            ).slice(0, 400)
          : '',
    };
  }

  timelineItems(t: SentinelTimelineResponse): TimelineItem[] {
    const items: TimelineItem[] = [];
    for (const e of t.timeline.events) {
      items.push({
        at: e.at,
        kind: e.kind,
        actor: e.actor,
        title: e.note || e.to_status || e.kind,
        detail: Object.entries(e.details ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(' · '),
      });
    }
    for (const c of t.timeline.change_events) {
      items.push({
        at: c.at,
        kind: `change:${c.kind}`,
        actor: c.source,
        title: c.ref || c.change_id,
        detail: Object.entries(c.details ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(' · '),
      });
    }
    for (const d of t.timeline.dependency_observations) {
      items.push({
        at: d.window_end,
        kind: `dep:${d.target_kind}`,
        actor: d.provenance,
        title: `${d.service_id} → ${d.target}`,
        detail: `calls=${d.calls} errors=${d.errors} timeouts=${d.timeouts}`,
      });
    }
    for (const h of t.timeline.hypotheses) {
      items.push({
        at: h.created_at,
        kind: 'hypothesis',
        actor: '',
        title: h.text,
        detail: '',
        confidence: h.confidence,
      });
    }
    for (const v of t.timeline.verifications) {
      items.push({
        at: v.executed_at,
        kind: `verdict:${v.verdict}`,
        actor: v.executor,
        title: v.detail || v.verification_id,
        detail: '',
      });
    }
    items.sort((a, b) => a.at.localeCompare(b.at));
    return items.slice(-80);
  }

  stateLabel(state: string | null | undefined): string {
    const key = `sentinel.state.${state}`;
    const v = this.i18n.t(key);
    return v.startsWith('⟪') ? String(state ?? '—') : v;
  }
}
