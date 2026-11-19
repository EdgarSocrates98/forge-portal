import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { DelegationGraph, DelegationsReport } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, stamp } from '../explorer/forges.data';

/**
 * Delegations (theforge/PortalDelegations/v1 + PortalDelegationGraph/v1)
 * — persisted orchestration reports verbatim: `duration_ms` stays
 * `null` when the document does not persist it (honest gap, '—'),
 * edges carry `provenance` (declared vs observed) exactly as the
 * adapter projected them. Nothing is inferred from absence.
 */
@Component({
  selector: 'page-delegations',
  standalone: true,
  imports: [RouterLink, TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'deleg.title' | t" [subtitle]="'deleg.subtitle' | t">
      <button class="btn" [disabled]="src.loading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (src.error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }
    @if (src.loading() && !report()) {
      <section class="card" role="status"><ui-skeleton kind="row" [lines]="3" /></section>
    }
    @if (report(); as rep) {
      <section class="card" data-section="availability">
        <div class="avail">
          <ui-state-badge [state]="rep.availability.state" />
          @if (rep.availability.detail) {
            <span class="muted">{{ rep.availability.detail }}</span>
          }
        </div>
        <p class="src">
          <code>GET /api/v1/delegations · {{ rep.schema ?? 'theforge/PortalDelegations/v1' }}</code>
          @if (src.loadedAt(); as ts) {
            <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
          }
        </p>
        @if (rep.notes?.length) {
          <ul class="notes">
            @for (n of rep.notes; track n) {
              <li class="muted">{{ n }}</li>
            }
          </ul>
        }
      </section>

      @if (rep.runs.length) {
        @for (run of rep.runs; track run.file ?? run.correlation_id) {
          <section class="card run" [attr.data-correlation]="run.correlation_id">
            <div class="run__head">
              <h2 class="run__title">
                <code>{{ run.correlation_id ?? run.file ?? '—' }}</code>
              </h2>
              @if (run.plan_status) {
                <ui-state-badge [state]="run.plan_status" />
              }
              @if (run.prior_runs_same_intent) {
                <span class="muted small">{{
                  'deleg.priorRuns' | t: { count: run.prior_runs_same_intent }
                }}</span>
              }
            </div>
            <dl class="meta">
              <div>
                <dt>{{ 'deleg.intent' | t }}</dt>
                <dd>{{ run.intent ?? '—' }}</dd>
              </div>
              <div>
                <dt>{{ 'deleg.kind' | t }}</dt>
                <dd>{{ run.kind ?? '—' }}</dd>
              </div>
              <div>
                <dt>{{ 'deleg.generatedAt' | t }}</dt>
                <dd>
                  @if (run.generated_at; as g) {
                    <code>{{ stamp(g) }}</code>
                  } @else {
                    —
                  }
                </dd>
              </div>
              <div>
                <dt>{{ 'deleg.duration' | t }}</dt>
                <dd>
                  @if (run.duration_ms !== null && run.duration_ms !== undefined) {
                    {{ run.duration_ms }} ms
                  } @else {
                    <span class="muted" [attr.title]="'deleg.noDuration' | t">—</span>
                  }
                </dd>
              </div>
            </dl>
            @if (run.entries?.length) {
              <div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th scope="col">{{ 'deleg.col.specialist' | t }}</th>
                      <th scope="col">{{ 'deleg.col.capability' | t }}</th>
                      <th scope="col">{{ 'deleg.col.status' | t }}</th>
                      <th scope="col">{{ 'deleg.col.stage' | t }}</th>
                      <th scope="col">{{ 'deleg.col.handoff' | t }}</th>
                      <th scope="col">{{ 'deleg.col.cost' | t }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (e of run.entries; track $index) {
                      <tr>
                        <td>
                          <code>{{ e.specialist ?? '—' }}</code>
                        </td>
                        <td>{{ e.capability ?? '—' }}</td>
                        <td>
                          <ui-state-badge
                            [state]="e.status ?? 'UNVERIFIED'"
                            [labelOverride]="e.status ?? null"
                          />
                        </td>
                        <td>{{ e.delegation_stage || '—' }}</td>
                        <td>{{ e.handoff_status || '—' }}</td>
                        <td>
                          @if (e.cost_bearing) {
                            <ui-state-badge state="warn" [labelOverride]="'deleg.cost' | t" />
                          } @else {
                            —
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
            @if (run.findings?.length) {
              <p class="muted small">
                {{ 'deleg.findings' | t: { count: run.findings.length } }}
              </p>
            }
            @if (run.unresolved?.length) {
              <p class="muted small">
                {{ 'deleg.unresolved' | t: { count: run.unresolved.length } }}
              </p>
            }
            @if (run.limitations?.length) {
              <ul class="notes">
                @for (n of run.limitations; track n) {
                  <li class="muted">{{ n }}</li>
                }
              </ul>
            }
            @if (run.unknowns?.length) {
              <ul class="notes">
                @for (n of run.unknowns; track n) {
                  <li class="muted">{{ n }}</li>
                }
              </ul>
            }
          </section>
        }
      } @else {
        <ui-empty icon="inbox" [title]="'deleg.empty' | t" [hint]="'deleg.empty.hint' | t" />
      }
    }

    <!-- Delegation graph — declared + observed edges with provenance. -->
    <section class="card" data-section="graph">
      <div class="sec__head">
        <div>
          <h2>{{ 'deleg.graph' | t }}</h2>
          <p class="src"><code>GET /api/v1/delegations/graph</code></p>
        </div>
        <a class="linklike" routerLink="/graph">{{ 'state.viewDetails' | t }}</a>
      </div>
      @if (gSrc.unavailable()) {
        <p class="unv">
          <ui-state-badge state="UNVERIFIED" /><span class="muted">{{ 'deleg.graphUnv' | t }}</span>
        </p>
      }
      @if (graph(); as g) {
        <div class="avail">
          <ui-state-badge [state]="g.availability.state" />
          @if (g.availability.detail) {
            <span class="muted">{{ g.availability.detail }}</span>
          }
        </div>
        <dl class="meta">
          <div>
            <dt>{{ 'deleg.graph.declared' | t }}</dt>
            <dd>{{ g.availability.declared ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ 'deleg.graph.observed' | t }}</dt>
            <dd>{{ g.availability.observed_reports ?? '—' }}</dd>
          </div>
        </dl>
        @if (view(); as v) {
          @if (v.edges.length) {
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">{{ 'deleg.col.source' | t }}</th>
                    <th scope="col">{{ 'deleg.col.kind' | t }}</th>
                    <th scope="col">{{ 'deleg.col.target' | t }}</th>
                    <th scope="col">{{ 'deleg.col.provenance' | t }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of v.edges; track $index) {
                    <tr>
                      <td>
                        <code>{{ e.source }}</code>
                      </td>
                      <td>{{ e.kind }}</td>
                      <td>
                        <code>{{ e.target }}</code>
                      </td>
                      <td>
                        <code>{{ e.provenance }}</code>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="muted">{{ 'deleg.graph.empty' | t }}</p>
          }
          @if (g.notes?.length) {
            <ul class="notes">
              @for (n of g.notes; track n) {
                <li class="muted">{{ n }}</li>
              }
            </ul>
          }
        }
      }
    </section>
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    .avail {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .src {
      margin: 4px 0 var(--space-2);
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-5);
      margin: var(--space-2) 0;
    }
    .meta div {
      display: grid;
      gap: 2px;
    }
    .meta dt {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .meta dd {
      margin: 0;
      font-size: var(--font-sm);
    }
    .run__head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
    }
    .run__title {
      margin: 0;
      font-size: var(--font-base);
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
    .notes {
      margin: var(--space-2) 0 0;
      padding-left: var(--space-4);
      font-size: var(--font-xs);
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
    .table-wrap {
      overflow-x: auto;
      margin-top: var(--space-2);
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
  `,
})
export class DelegationsPage {
  private readonly api = inject(PortalApi);

  readonly src = new Source<DelegationsReport>();
  readonly gSrc = new Source<DelegationGraph>();

  readonly report = computed(() => this.src.data());
  readonly graph = computed(() => this.gSrc.data());
  readonly view = computed(() => this.graph()?.views?.[0] ?? null);

  readonly stamp = stamp;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    await Promise.all([
      this.src.load(() => this.api.delegations()),
      this.gSrc.load(() => this.api.delegationsGraph()),
    ]);
  }
}
