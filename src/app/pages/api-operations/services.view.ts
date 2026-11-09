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
  SentinelServiceDetailResponse,
  SentinelServiceListResponse,
  SentinelMetricsResponse,
  SentinelOperationsResponse,
  SentinelSloPanelResponse,
  SentinelWindowAggregate,
} from '../../sentinel/sentinel.models';
import { fmtMs, fmtRate, fmtRatio, sentinelKind } from '../../sentinel/sentinel-states';

interface DetailBundle {
  detail: SentinelServiceDetailResponse;
  operations: SentinelOperationsResponse | null;
  metrics: SentinelMetricsResponse | null;
  slos: SentinelSloPanelResponse | null;
  /** per-surface errors — one unavailable panel never blanks the page */
  errors: Record<'operations' | 'metrics' | 'slos', ApiError | null>;
}

/**
 * Sentinel service inventory + service detail. All data comes from the
 * real `/v1/services*` surface; absent indicators render as `—` plus the
 * returned `absent_indicators`/`limitations` — never a fabricated zero.
 */
@Component({
  selector: 'sentinel-services',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TPipe, ErrorState, EmptyState, UiSkeleton, StateBadge, UiIcon, DatePipe],
  template: `
    @if (loading()) {
      <div class="srow">
        @for (n of [1, 2, 3]; track n) {
          <ui-skeleton kind="card" />
        }
      </div>
    } @else if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    } @else if (list(); as l) {
      @if (!selectedId()) {
        <!-- overview strip -->
        <div class="kpis">
          <div class="kpi card">
            <strong>{{ l.services.length }}</strong>
            <span>{{ 'sentinel.overview.services' | t }}</span>
          </div>
          <div class="kpi card">
            <strong>{{ countBy(l, 'AVAILABLE') }}</strong>
            <span>{{ 'sentinel.state.AVAILABLE' | t }}</span>
          </div>
          <div class="kpi card">
            <strong>{{ openIncidents(l) }}</strong>
            <span>{{ 'sentinel.overview.openIncidents' | t }}</span>
          </div>
          <div class="kpi card">
            <strong>{{ sloDefs(l) }}</strong>
            <span>{{ 'sentinel.overview.sloDefs' | t }}</span>
          </div>
        </div>

        @if (l.services.length === 0) {
          <ui-empty
            icon="inbox"
            [title]="'sentinel.services.empty' | t"
            [hint]="'sentinel.services.emptyDesc' | t"
          />
        } @else {
          <div
            class="table-wrap card"
            role="region"
            [attr.aria-label]="'sentinel.services.title' | t"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ 'sentinel.col.service' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.health' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.condition' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.window' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.errRatio' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.p95' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.incidents' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.slos' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (s of l.services; track s.service.service_id) {
                  <tr
                    class="row"
                    tabindex="0"
                    (click)="select(s.service.service_id)"
                    (keydown.enter)="select(s.service.service_id)"
                  >
                    <td>
                      <strong>{{ s.service.display_name || s.service.service_name }}</strong>
                      <div class="sub mono">
                        {{ s.service.service_id }} · {{ s.service.environment_id }}
                      </div>
                    </td>
                    <td>
                      <ui-state-badge
                        [state]="s.health.state"
                        [kindOverride]="kind(s.health.state)"
                        [labelOverride]="stateLabel(s.health.state)"
                      />
                    </td>
                    <td>
                      <span class="cond">{{ s.health.condition }}</span>
                    </td>
                    <td class="num">
                      {{
                        s.health.latest_window_end
                          ? (s.health.latest_window_end | date: 'HH:mm:ss')
                          : '—'
                      }}
                    </td>
                    <td class="num">{{ fmtRatio(s.health.latest_indicators?.error_ratio) }}</td>
                    <td class="num">{{ fmtMs(s.health.latest_indicators?.latency_p95_ms) }}</td>
                    <td class="num">{{ s.open_incidents }}</td>
                    <td class="num">{{ s.slo_definitions }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
        @if (l.unknowns.length) {
          <p class="unknowns">{{ 'sentinel.unknowns' | t }}: {{ l.unknowns.join(' · ') }}</p>
        }
      } @else {
        <!-- ============ service detail ============ -->
        <button class="btn back" type="button" (click)="select(null)">
          <ui-icon name="chevron-left" [size]="14" /> {{ 'sentinel.backToServices' | t }}
        </button>

        @if (detailLoading()) {
          <ui-skeleton kind="card" /><ui-skeleton kind="text" [lines]="4" />
        } @else if (detailError(); as de) {
          <ui-error [error]="de" (retry)="loadDetail(selectedId()!)" />
        } @else if (bundle(); as b) {
          <section class="card hero">
            <div class="hero__head">
              <div>
                <h2>
                  {{ b.detail.detail.service.display_name || b.detail.detail.service.service_name }}
                </h2>
                <div class="sub mono">
                  {{ b.detail.detail.service.service_id }} · env
                  {{ b.detail.detail.service.environment_id }}
                  @if (b.detail.detail.service.namespace) {
                    · ns {{ b.detail.detail.service.namespace }}
                  }
                </div>
              </div>
              <div class="chips">
                <ui-state-badge
                  [state]="b.detail.detail.health.state"
                  [kindOverride]="kind(b.detail.detail.health.state)"
                  [labelOverride]="stateLabel(b.detail.detail.health.state)"
                />
                <ui-state-badge
                  [state]="b.detail.detail.health.condition"
                  [kindOverride]="kind(b.detail.detail.health.condition)"
                  [labelOverride]="stateLabel(b.detail.detail.health.condition)"
                />
              </div>
            </div>
            <p class="muted">
              {{ 'sentinel.detail.evaluatedAt' | t }}
              {{ b.detail.detail.health.evaluated_at | date: 'medium' }} ·
              {{ 'sentinel.col.window' | t }}
              {{ b.detail.detail.health.latest_window_start | date: 'HH:mm' }}–{{
                b.detail.detail.health.latest_window_end | date: 'HH:mm'
              }}
            </p>

            <!-- latest indicators, explicit units + absent honesty -->
            <div class="mgrid">
              <div class="m">
                <span>{{ 'sentinel.metric.reqRate' | t }}</span
                ><strong>{{
                  fmtRate(b.detail.detail.health.latest_indicators?.request_rate)
                }}</strong>
              </div>
              <div class="m">
                <span>{{ 'sentinel.metric.errRatio' | t }}</span
                ><strong>{{
                  fmtRatio(b.detail.detail.health.latest_indicators?.error_ratio)
                }}</strong>
              </div>
              <div class="m">
                <span>{{ 'sentinel.metric.p50' | t }}</span
                ><strong>{{
                  fmtMs(b.detail.detail.health.latest_indicators?.latency_p50_ms)
                }}</strong>
              </div>
              <div class="m">
                <span>{{ 'sentinel.metric.p95' | t }}</span
                ><strong>{{
                  fmtMs(b.detail.detail.health.latest_indicators?.latency_p95_ms)
                }}</strong>
              </div>
              <div class="m">
                <span>{{ 'sentinel.metric.p99' | t }}</span
                ><strong>{{
                  fmtMs(b.detail.detail.health.latest_indicators?.latency_p99_ms)
                }}</strong>
              </div>
              <div class="m">
                <span>{{ 'sentinel.metric.quality' | t }}</span
                ><strong>{{ b.detail.detail.health.quality }}</strong>
              </div>
            </div>
            @if (b.detail.detail.health.absent_indicators.length) {
              <p class="unknowns">
                {{ 'sentinel.absentIndicators' | t }}:
                {{ b.detail.detail.health.absent_indicators.join(', ') }}
              </p>
            }
            @if (b.detail.detail.health.limitations.length) {
              <p class="unknowns">
                {{ 'sentinel.limitations' | t }}:
                {{ b.detail.detail.health.limitations.join(' · ') }}
              </p>
            }
          </section>

          <!-- PF correspondence — separate provenance, never inferred -->
          <section class="card">
            <h3>{{ 'sentinel.detail.correspondence' | t }}</h3>
            <p>
              <ui-state-badge
                [state]="b.detail.links.correspondence.state"
                [kindOverride]="kind(b.detail.links.correspondence.state)"
                [labelOverride]="stateLabel(b.detail.links.correspondence.state)"
              />
              {{ b.detail.links.correspondence.reason }}
            </p>
            @if (b.detail.links.links.length) {
              <ul class="refs">
                @for (r of b.detail.links.links; track r.kind + r.ref) {
                  <li>
                    <code>{{ r.kind }}:{{ r.ref }}</code>
                    <span class="muted">({{ r.provenance }})</span>
                  </li>
                }
              </ul>
            }
            <p class="muted small">{{ 'sentinel.detail.correspondenceNote' | t }}</p>
          </section>

          <!-- operations -->
          <section class="card">
            <h3>{{ 'sentinel.ops.title' | t }}</h3>
            @if (b.errors.operations; as oe) {
              <ui-error [error]="oe" />
            } @else if (b.operations) {
              @if (b.operations.operations.length === 0) {
                <p class="muted">{{ 'sentinel.ops.empty' | t }}</p>
              } @else {
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{{ 'sentinel.col.operation' | t }}</th>
                        <th scope="col">{{ 'sentinel.col.provenance' | t }}</th>
                        <th scope="col">{{ 'sentinel.col.observations' | t }}</th>
                        <th scope="col">{{ 'sentinel.col.sources' | t }}</th>
                        <th scope="col">{{ 'sentinel.col.window' | t }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (o of b.operations.operations; track o.operation_ref || o.operation_id) {
                        <tr>
                          <td class="mono">{{ o.operation_ref || o.operation_id }}</td>
                          <td>{{ o.provenance }}</td>
                          <td class="num">{{ o.observations }}</td>
                          <td class="mono">{{ o.sources.join(', ') }}</td>
                          <td class="num">
                            {{
                              o.latest_window_end ? (o.latest_window_end | date: 'HH:mm:ss') : '—'
                            }}
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              @if (b.operations.unknowns.length) {
                <p class="unknowns">
                  {{ 'sentinel.unknowns' | t }}: {{ b.operations.unknowns.join(' · ') }}
                </p>
              }
            }
          </section>

          <!-- metrics windows -->
          <section class="card">
            <h3>{{ 'sentinel.metrics.title' | t }}</h3>
            @if (b.errors.metrics; as me) {
              <ui-error [error]="me" />
            } @else if (b.metrics; as m) {
              <p class="muted">
                {{ m.metrics.observations }} {{ 'sentinel.metrics.observations' | t }} ·
                {{ 'sentinel.metrics.units' | t }}:
                @for (u of unitPairs(m); track u[0]) {
                  <code>{{ u[0] }}={{ u[1] }}</code>
                }
              </p>
              @if (m.metrics.windows.length === 0) {
                <p class="muted">{{ 'sentinel.metrics.empty' | t }}</p>
              } @else {
                <div class="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">{{ 'sentinel.col.window' | t }}</th>
                        <th scope="col">{{ 'sentinel.col.operation' | t }}</th>
                        <th scope="col">{{ 'sentinel.col.eligible' | t }}</th>
                        <th scope="col">{{ 'sentinel.col.errRatio' | t }}</th>
                        <th scope="col">{{ 'sentinel.col.p95' | t }}</th>
                        <th scope="col">{{ 'sentinel.metric.quality' | t }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of metricRows(m); track row.key) {
                        <tr>
                          <td class="num">{{ row.end | date: 'HH:mm:ss' }}</td>
                          <td class="mono">{{ row.op || '—' }}</td>
                          <td class="num">{{ row.eligible }}</td>
                          <td class="num">{{ fmtRatio(row.err) }}</td>
                          <td class="num">{{ fmtMs(row.p95) }}</td>
                          <td>
                            <ui-state-badge
                              [state]="row.quality"
                              [kindOverride]="kind(row.quality)"
                              [labelOverride]="stateLabel(row.quality)"
                            />
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
              @if (m.metrics.gaps.length) {
                <p class="unknowns">
                  {{ 'sentinel.metrics.gaps' | t }}: {{ m.metrics.gaps.length }}
                </p>
              }
              @if (m.metrics.limitations.length) {
                <p class="unknowns">
                  {{ 'sentinel.limitations' | t }}: {{ m.metrics.limitations.join(' · ') }}
                </p>
              }
            }
          </section>

          <!-- SLO panel -->
          <section class="card">
            <h3>{{ 'sentinel.slos.title' | t }}</h3>
            @if (b.errors.slos; as se) {
              <ui-error [error]="se" />
            } @else if (b.slos) {
              @if (b.slos.panel.slos.length === 0) {
                <p class="muted">{{ 'sentinel.slos.empty' | t }}</p>
              } @else {
                <div class="slo-grid">
                  @for (s of b.slos.panel.slos; track s.definition.slo_id) {
                    <div class="slo card-inset">
                      <div class="slo__head">
                        <code>{{ s.definition.slo_id }}</code>
                        @if (s.latest_assessment; as a) {
                          <ui-state-badge
                            [state]="a.state"
                            [kindOverride]="kind(a.state)"
                            [labelOverride]="stateLabel(a.state)"
                          />
                        } @else {
                          <ui-state-badge
                            state="NOT_RUN"
                            [kindOverride]="'unv'"
                            [labelOverride]="'sentinel.state.NOT_RUN' | t"
                          />
                        }
                      </div>
                      <p class="slo__line">
                        {{ s.definition.sli_kind }} · target {{ s.definition.target }} ·
                        {{ 'sentinel.slos.window' | t }} {{ s.definition.window_seconds / 60 }}m
                      </p>
                      @if (s.latest_assessment; as a) {
                        <p class="slo__line">
                          SLI {{ fmtRatio(a.sli) }} · {{ 'sentinel.slos.budgetLeft' | t }}
                          {{ fmtRatio(a.budget_remaining) }} · {{ 'sentinel.metric.quality' | t }}
                          {{ a.quality }} · {{ a.eligible }} {{ 'sentinel.col.eligible' | t }}
                        </p>
                        @if (a.limitations.length) {
                          <p class="unknowns">{{ a.limitations.join(' · ') }}</p>
                        }
                      }
                    </div>
                  }
                </div>
              }
            }
          </section>

          <!-- sources -->
          <section class="card">
            <h3>{{ 'sentinel.sources.title' | t }}</h3>
            @if (b.detail.detail.sources.length === 0) {
              <p class="muted">{{ 'sentinel.sources.empty' | t }}</p>
            } @else {
              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{{ 'sentinel.col.source' | t }}</th>
                      <th scope="col">{{ 'sentinel.col.kind' | t }}</th>
                      <th scope="col">{{ 'sentinel.col.registered' | t }}</th>
                      <th scope="col">{{ 'sentinel.col.observations' | t }}</th>
                      <th scope="col">{{ 'sentinel.col.window' | t }}</th>
                      <th scope="col">{{ 'sentinel.col.stale' | t }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (src of b.detail.detail.sources; track src.source_id) {
                      <tr>
                        <td class="mono">{{ src.source_id }}</td>
                        <td>{{ src.kind }}</td>
                        <td>{{ sourceHealth(src.source_id)?.registered ?? '—' }}</td>
                        <td class="num">{{ sourceHealth(src.source_id)?.observations ?? '—' }}</td>
                        <td class="num">
                          {{
                            sourceHealth(src.source_id)?.latest_window_end
                              ? (sourceHealth(src.source_id)!.latest_window_end! | date: 'HH:mm:ss')
                              : '—'
                          }}
                        </td>
                        <td>
                          <ui-state-badge
                            [state]="sourceHealth(src.source_id)?.stale ? 'stale' : 'fresh'"
                            [kindOverride]="
                              kind(sourceHealth(src.source_id)?.stale ? 'stale' : 'fresh')
                            "
                            [labelOverride]="
                              stateLabel(sourceHealth(src.source_id)?.stale ? 'stale' : 'fresh')
                            "
                          />
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </section>
        }
      }
    }
  `,
  styles: `
    .srow {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--space-4);
    }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-4);
    }
    .kpi {
      padding: var(--space-4);
      display: grid;
      gap: 4px;
    }
    .kpi strong {
      font-size: var(--font-2xl);
    }
    .kpi span {
      color: var(--fg-muted);
      font-size: var(--font-xs);
      text-transform: uppercase;
      letter-spacing: 0.06em;
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
    .cond {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .back {
      margin-bottom: var(--space-4);
    }
    .hero {
      margin-bottom: var(--space-4);
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
    }
    .mgrid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: var(--space-3);
      margin-top: var(--space-3);
    }
    .m {
      display: grid;
      gap: 2px;
    }
    .m span {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .m strong {
      font-variant-numeric: tabular-nums;
    }
    section.card {
      margin-bottom: var(--space-4);
      padding: var(--space-5);
    }
    section.card h3 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-base);
    }
    .refs {
      margin: var(--space-2) 0;
      padding-left: var(--space-5);
    }
    .unknowns {
      color: var(--warn);
      font-size: var(--font-xs);
      margin: var(--space-3) 0 0;
    }
    .muted {
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
    .small {
      font-size: var(--font-xs);
    }
    .slo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: var(--space-3);
    }
    .card-inset {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
    }
    .slo__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
    }
    .slo__line {
      margin: 6px 0 0;
      font-size: var(--font-sm);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class SentinelServices {
  private readonly api = inject(SentinelApi);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);

  readonly selectedId = input<string | null>(null);

  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly list = signal<SentinelServiceListResponse | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal<ApiError | null>(null);
  readonly bundle = signal<DetailBundle | null>(null);

  readonly fmtRatio = fmtRatio;
  readonly fmtMs = fmtMs;
  readonly fmtRate = fmtRate;
  readonly kind = sentinelKind;

  constructor() {
    effect(() => {
      const id = this.selectedId();
      if (id) void this.loadDetail(id);
      else this.bundle.set(null);
    });
    void this.load();
  }

  select(id: string | null): void {
    void this.router.navigate([], {
      queryParams: { service: id },
      queryParamsHandling: 'merge',
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.list.set(await firstValueFrom(this.api.services()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  async loadDetail(serviceId: string): Promise<void> {
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.bundle.set(null);
    const errors: DetailBundle['errors'] = { operations: null, metrics: null, slos: null };
    try {
      const detail = await firstValueFrom(this.api.service(serviceId));
      const [operations, metrics, slos] = await Promise.all([
        firstValueFrom(this.api.serviceOperations(serviceId)).catch((e) => {
          errors.operations = e instanceof ApiError ? e : new ApiError(0);
          return null;
        }),
        firstValueFrom(this.api.serviceMetrics(serviceId)).catch((e) => {
          errors.metrics = e instanceof ApiError ? e : new ApiError(0);
          return null;
        }),
        firstValueFrom(this.api.serviceSlos(serviceId)).catch((e) => {
          errors.slos = e instanceof ApiError ? e : new ApiError(0);
          return null;
        }),
      ]);
      this.bundle.set({ detail, operations, metrics, slos, errors });
    } catch (e) {
      this.detailError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.detailLoading.set(false);
    }
  }

  sourceHealth(sourceId: string) {
    return (
      this.bundle()?.detail.detail.health.sources.find((s) => s.source_id === sourceId) ?? null
    );
  }

  countBy(l: SentinelServiceListResponse, state: string): number {
    return l.services.filter((s) => s.health.state === state).length;
  }

  openIncidents(l: SentinelServiceListResponse): number {
    return l.services.reduce((n, s) => n + s.open_incidents, 0);
  }

  sloDefs(l: SentinelServiceListResponse): number {
    return l.services.reduce((n, s) => n + s.slo_definitions, 0);
  }

  unitPairs(m: SentinelMetricsResponse): [string, string][] {
    return Object.entries(m.metrics.units ?? {});
  }

  metricRows(m: SentinelMetricsResponse): {
    key: string;
    end: string;
    op: string | null;
    eligible: number;
    err: number | null;
    p95: number | null;
    quality: string;
  }[] {
    const rows: {
      key: string;
      end: string;
      op: string | null;
      eligible: number;
      err: number | null;
      p95: number | null;
      quality: string;
    }[] = [];
    for (const w of m.metrics.windows.slice(-12)) {
      for (const a of w.aggregates as SentinelWindowAggregate[]) {
        rows.push({
          key: `${w.window_end}|${a.source_id}|${a.operation_id}`,
          end: w.window_end,
          op: a.operation_id,
          eligible: a.eligible_requests,
          err: a.error_ratio,
          p95: a.latency_p95_ms,
          quality: a.quality,
        });
      }
    }
    return rows;
  }

  stateLabel(state: string | null | undefined): string {
    const key = `sentinel.state.${state}`;
    const v = this.i18n.t(key);
    return v.startsWith('⟪') ? String(state ?? '—') : v;
  }
}
