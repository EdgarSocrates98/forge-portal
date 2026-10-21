import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  DelegationGraphEdge,
  DelegationGraphReport,
  DelegationRun,
  PortalDelegationsReport,
} from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';

interface EdgeGroup {
  kind: string;
  edges: DelegationGraphEdge[];
}

/**
 * Delegation Explorer + history (lf-0032) — GET /delegations projects the
 * chain Coordinator → Specialist → Capability → Execution → Evidence →
 * Handoff → Result per persisted orchestration report; GET /delegations/graph
 * projects the declared-vs-observed relation kinds. Every field echoes the
 * wire document: `duration_ms` arrives null (not persisted) and renders as
 * "unavailable", never a fabricated number; unreadable reports surface as
 * notes, not phantom runs.
 */
@Component({
  selector: 'page-delegations',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'delegations.title' | t" [subtitle]="'delegations.subtitle' | t">
      <button class="btn" (click)="load()"><ui-icon name="refresh" [size]="15" /> {{ 'state.refresh' | t }}</button>
    </ui-page-header>

    @if (loading()) {
      <section class="card" role="status"><ui-skeleton kind="text" [lines]="2" /><ui-skeleton kind="card" /></section>
    } @else if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    } @else {
      @if (report(); as r) {
        <section class="stats">
          <div class="stat"><span class="stat__value">{{ r.runs.length }}</span><span class="stat__label">{{ 'delegations.runs' | t }}</span></div>
          <div class="stat"><span class="stat__value">{{ totalFindings(r.runs) }}</span><span class="stat__label">{{ 'delegations.findings' | t }}</span></div>
          <div class="stat"><span class="stat__value">{{ totalUnresolved(r.runs) }}</span><span class="stat__label">{{ 'delegations.unresolved' | t }}</span></div>
          <div class="stat"><span class="stat__value">{{ totalRefused(r.runs) }}</span><span class="stat__label">{{ 'delegations.refused' | t }}</span></div>
        </section>
        @for (n of r.notes ?? []; track n) { <p class="note muted"><ui-icon name="alert" [size]="13" /> {{ n }}</p> }

        @if (r.runs.length) {
          <section class="runs">
            @for (run of r.runs; track run.correlation_id || run.file) {
              <article class="card run" [class.open]="open() === key(run)">
                <button type="button" class="run__head" (click)="toggle(key(run))" [attr.aria-expanded]="open() === key(run)">
                  <span class="run__intent">{{ run.intent || '—' }}</span>
                  <span class="chip">{{ run.kind || 'run' }}</span>
                  <span class="chip" [class.bad]="run.plan_status === 'refused'">{{ run.plan_status || '—' }}</span>
                  @if ((run.prior_runs_same_intent ?? 0) > 0) {
                    <span class="chip reval">{{ 'delegations.revalidation' | t }} #{{ run.prior_runs_same_intent }}</span>
                  }
                  <span class="muted">{{ run.generated_at || '—' }}</span>
                  <ui-icon name="chevron-right" [size]="14" />
                </button>
                @if (open() === key(run)) {
                  <div class="run__body">
                    <dl class="kv">
                      <dt>correlation_id</dt><dd><code>{{ run.correlation_id || '—' }}</code></dd>
                      <dt>{{ 'delegations.duration' | t }}</dt>
                      <dd>{{ run.duration_ms != null ? run.duration_ms + ' ms' : ('delegations.unavailable' | t) }}</dd>
                      <dt>{{ 'delegations.file' | t }}</dt><dd><code>{{ run.file || '—' }}</code></dd>
                    </dl>

                    <h4>{{ 'delegations.chain' | t }}</h4>
                    <ol class="chain">
                      @for (e of run.entries ?? []; track $index) {
                        <li class="chain__item">
                          <div class="chain__row"><b>{{ 'delegations.coordinator' | t }}</b><span>{{ e.coordinator || 'the-forge' }}</span></div>
                          <div class="chain__row"><b>{{ 'delegations.specialist' | t }}</b><span>{{ e.specialist || '—' }}</span></div>
                          <div class="chain__row"><b>{{ 'delegations.capability' | t }}</b><span><code>{{ e.capability || '—' }}</code></span></div>
                          <div class="chain__row"><b>{{ 'delegations.execution' | t }}</b><span>{{ e.delegation_stage || '—' }}
                            @if (e.command?.length) { <code class="cmd">{{ e.command!.join(' ') }}</code> }</span></div>
                          <div class="chain__row"><b>{{ 'delegations.evidence' | t }}</b><span>{{ e.handoff_status || '—' }}</span></div>
                          <div class="chain__row"><b>{{ 'delegations.result' | t }}</b>
                            <span><ui-state-badge [state]="e.status || 'unknown'" />
                              @for (rk of e.risks ?? []; track rk) { <span class="chip">{{ rk }}</span> }
                              @if (e.cost_bearing) { <span class="chip bad">cost</span> }
                            </span></div>
                          @if (e.notes?.length) { <p class="muted">{{ e.notes!.join(' · ') }}</p> }
                        </li>
                      }
                      @if (!(run.entries?.length)) { <li class="muted">{{ 'delegations.noEntries' | t }}</li> }
                    </ol>

                    @if (run.findings?.length) {
                      <h4>{{ 'delegations.findings' | t }}</h4>
                      <ul class="plain">
                        @for (f of run.findings; track f.id) {
                          <li><code>{{ f.id }}</code> — {{ f.summary || '—' }}
                            <span class="muted">({{ f.severity || '—' }}/{{ f.confidence || '—' }} · {{ f.finding_class || '—' }} · {{ joinList(f.providers) }})</span>
                            @if (f.correlated) { <span class="chip">correlated</span> }
                          </li>
                        }
                      </ul>
                    }
                    @if (run.unresolved?.length) {
                      <h4>{{ 'delegations.unresolved' | t }}</h4>
                      <ul class="plain">@for (u of run.unresolved; track $index) { <li><code>{{ u.code }}</code> — {{ u.detail || '—' }} @if (u.provider) { <span class="muted">({{ u.provider }})</span> }</li> }</ul>
                    }
                    @if (run.recommended?.length) {
                      <h4>{{ 'delegations.recommended' | t }}</h4>
                      <ul class="plain">@for (rec of run.recommended; track $index) { <li>{{ rec.action }} — {{ rec.why || '—' }} @if (rec.provider) { <span class="muted">({{ rec.provider }})</span> }</li> }</ul>
                    }
                    @if (run.limitations?.length || run.unknowns?.length) {
                      <h4>{{ 'delegations.limits' | t }}</h4>
                      <ul class="plain">
                        @for (l of run.limitations ?? []; track l) { <li>{{ l }}</li> }
                        @for (u of run.unknowns ?? []; track u) { <li>{{ u }}</li> }
                      </ul>
                    }
                  </div>
                }
              </article>
            }
          </section>
        } @else {
          <ui-empty icon="history" [title]="'delegations.empty' | t" [hint]="r.availability.detail || ('delegations.emptyDetail' | t)" />
        }
      }

      <section class="card rels">
        <div class="card__heading">
          <h2>{{ 'delegations.relations' | t }}</h2>
          @if (graph(); as g) {
            <span class="muted">{{ 'delegations.observedReports' | t }}: {{ g.availability.observed_reports ?? 0 }} · {{ 'delegations.declared' | t }}: {{ g.availability.declared || '—' }}</span>
          }
        </div>
        @if (graph(); as g) {
          @for (n of g.notes ?? []; track n) { <p class="note muted">{{ n }}</p> }
          @if (edgeGroups(g).length) {
            <p class="muted">{{ 'delegations.legend' | t }}</p>
            @for (grp of edgeGroups(g); track grp.kind) {
              <h4><code>{{ grp.kind }}</code> <span class="chip">{{ grp.edges.length }}</span></h4>
              <table class="tbl">
                <thead><tr><th scope="col">source</th><th scope="col">target</th><th scope="col">provenance</th><th scope="col">detail</th></tr></thead>
                <tbody>
                  @for (e of grp.edges; track e.source + '>' + e.target) {
                    <tr>
                      <td><code>{{ e.source }}</code></td><td><code>{{ e.target }}</code></td>
                      <td><span class="chip" [class.obs]="e.provenance === 'observed'">{{ e.provenance }}</span></td>
                      <td>{{ e.detail || '—' }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          } @else {
            <p class="muted">{{ 'delegations.noRelations' | t }}</p>
          }
        }
      </section>
    }
  `,
  styles: `
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.6rem;margin:.8rem 0}
    .stat{border:1px solid var(--line);border-radius:10px;padding:.55rem .7rem;display:flex;flex-direction:column;gap:.15rem}
    .stat__value{font-size:1.25rem;font-weight:700}.stat__label{font-size:.72rem;color:var(--fg-muted);text-transform:uppercase;letter-spacing:.04em}
    .runs{display:flex;flex-direction:column;gap:.5rem;margin-bottom:1rem}
    .run{padding:0}.run__head{width:100%;display:flex;align-items:center;gap:.6rem;padding:.65rem .9rem;background:none;border:0;cursor:pointer;text-align:left;font:inherit;color:inherit;flex-wrap:wrap}
    .run__intent{font-weight:600;flex:1;min-width:200px}
    .chip{font-size:.72rem;border:1px solid var(--line);border-radius:999px;padding:.1rem .5rem;color:var(--fg-muted);white-space:nowrap}
    .chip.bad{border-color:var(--danger,#c33);color:var(--danger,#c33)}
    .chip.reval{border-color:var(--info,#38c);color:var(--info,#38c)}
    .chip.obs{border-color:var(--ok,#3a3);color:var(--ok,#3a3)}
    .run__body{border-top:1px solid var(--line);padding:.7rem .9rem}
    .kv{display:grid;grid-template-columns:150px 1fr;gap:.2rem .8rem;margin:0 0 .5rem;font-size:.85rem}
    .kv dt{color:var(--fg-muted)}.kv dd{margin:0}
    h4{font-size:.8rem;margin:.7rem 0 .3rem;text-transform:uppercase;letter-spacing:.04em;color:var(--fg-muted)}
    .chain{margin:0;padding-left:1.2rem;display:flex;flex-direction:column;gap:.6rem}
    .chain__item{border-left:2px solid var(--accent,#58f);padding-left:.7rem}
    .chain__row{display:flex;gap:.6rem;font-size:.85rem;align-items:baseline}
    .chain__row b{min-width:110px;color:var(--fg-muted);font-weight:600}
    .cmd{font-size:.78rem;background:var(--bg-hover);border-radius:6px;padding:.1rem .4rem;margin-left:.4rem}
    .plain{margin:0;padding-left:1.1rem;font-size:.85rem}
    .tbl{width:100%;border-collapse:collapse;font-size:.82rem;margin-bottom:.6rem}
    .tbl th,.tbl td{border-bottom:1px solid var(--line);text-align:left;padding:.3rem .45rem}
    .tbl th{color:var(--fg-muted);font-weight:600}
    .note{display:flex;gap:.4rem;align-items:center;margin:.2rem 0}
    .rels{padding:.8rem 1rem}
    .muted{color:var(--fg-muted)}
  `,
})
export class DelegationsPage implements OnInit {
  private readonly api = inject(PortalApi);
  readonly loading = signal(true);
  readonly report = signal<PortalDelegationsReport | null>(null);
  readonly graph = signal<DelegationGraphReport | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly open = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [runs, graph] = await Promise.all([
        firstValueFrom(this.api.delegations()),
        firstValueFrom(this.api.delegationsGraph()).catch(() => null),
      ]);
      this.report.set(runs);
      this.graph.set(graph);
    } catch (e) {
      this.error.set(e as ApiError);
    } finally {
      this.loading.set(false);
    }
  }

  key(run: DelegationRun): string {
    return run.correlation_id || run.file || '?';
  }

  toggle(k: string): void {
    this.open.set(this.open() === k ? null : k);
  }

  totalFindings(runs: DelegationRun[]): number {
    return runs.reduce((n, r) => n + (r.findings?.length ?? 0), 0);
  }

  totalUnresolved(runs: DelegationRun[]): number {
    return runs.reduce((n, r) => n + (r.unresolved?.length ?? 0), 0);
  }

  totalRefused(runs: DelegationRun[]): number {
    return runs.reduce(
      (n, r) => n + (r.entries ?? []).filter((e) => e.status === 'refused' || e.status === 'blocked').length,
      0,
    );
  }

  edgeGroups(g: DelegationGraphReport): EdgeGroup[] {
    const groups = new Map<string, DelegationGraphEdge[]>();
    for (const e of g.views?.[0]?.edges ?? []) {
      const list = groups.get(e.kind) ?? [];
      list.push(e);
      groups.set(e.kind, list);
    }
    return [...groups.entries()]
      .map(([kind, edges]) => ({ kind, edges }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
  }

  joinList(list?: string[]): string {
    return list?.length ? list.join(', ') : '—';
  }
}
