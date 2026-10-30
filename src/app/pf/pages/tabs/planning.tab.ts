import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PfApi } from '../../pf-api.service';
import { ApiError } from '../../../core/api/api.error';
import {
  PfDecision,
  PfInitiative,
  PfPrd,
  PfPrioritizeResult,
  PfRoadmap,
} from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { StateBadge } from '../../../shared/state-badge';
import { UiIcon } from '../../../shared/icon';
import { UiSkeleton } from '../../../shared/skeleton';
import { ToastService } from '../../../shared/toast';

const LANE_ORDER = ['now', 'next', 'later', 'done'] as const;
const LANE_LABEL: Record<string, string> = {
  now: 'Now — in progress',
  next: 'Next — prioritized',
  later: 'Later — proposed',
  done: 'Done',
};

/**
 * Planning tab — initiatives, decisions, the RICE/WSJF prioritizer, the
 * generated roadmap lanes and per-initiative PRDs. Score inputs go to the
 * engine verbatim; the markdown the engine emits renders as-is.
 */
@Component({
  selector: 'pf-planning-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, StateBadge, UiIcon, UiSkeleton],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" aria-label="loading planning"><ui-skeleton kind="card" [lines]="3" /></div>
    } @else {
      <section class="card">
        <h2>Initiatives</h2>
        <form class="iform" (submit)="createInitiative($event)">
          <input
            class="input"
            [value]="iTitle()"
            (input)="iTitle.set($any($event.target).value)"
            placeholder="Initiative title"
            required
            aria-label="Initiative title"
          />
          <input
            class="input"
            [value]="iHypothesis()"
            (input)="iHypothesis.set($any($event.target).value)"
            placeholder="Hypothesis (optional)"
            aria-label="Hypothesis"
          />
          <button class="btn btn--primary" type="submit" [disabled]="busy() || !iTitle().trim()">
            Add initiative
          </button>
        </form>

        @if (initiatives().length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">Initiative</th>
                <th scope="col">Status</th>
                <th scope="col">Priority</th>
                <th scope="col"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              @for (i of initiatives(); track i.id) {
                <tr>
                  <td>
                    <strong>{{ i.title }}</strong>
                    @if (i.hypothesis) {
                      <p class="muted small">{{ i.hypothesis }}</p>
                    }
                    <code class="muted small">{{ i.id }}</code>
                  </td>
                  <td>
                    <ui-state-badge
                      [state]="statusBadge(i.status)"
                      [labelOverride]="i.status ?? 'proposed'"
                    />
                  </td>
                  <td>{{ i.priority_score ?? 0 }}</td>
                  <td class="acts">
                    <button class="btn btn--mini" (click)="toggleScore(i.id)">
                      {{ scoreFor() === i.id ? 'Close' : 'Prioritize' }}
                    </button>
                    <button
                      class="btn btn--mini"
                      [disabled]="prdBusy() === i.id"
                      (click)="genPrd(i)"
                    >
                      {{ prdBusy() === i.id ? 'Generating…' : 'PRD' }}
                    </button>
                  </td>
                </tr>
                @if (scoreFor() === i.id) {
                  <tr>
                    <td colspan="4">
                      <form class="rice fg-enter" (submit)="prioritize(i, $event)">
                        <span class="muted small rice__label">RICE factors</span>
                        @for (f of riceFields; track f.key) {
                          <label class="rice__f">
                            <span>{{ f.label }}</span>
                            <input
                              class="input"
                              type="number"
                              [value]="rice()[f.key]"
                              (input)="setRice(f.key, $any($event.target).valueAsNumber)"
                            />
                          </label>
                        }
                        <button class="btn btn--primary btn--mini" type="submit">Score</button>
                        @if (scoreResults()[i.id]; as r) {
                          <span class="fg-pill" data-tone="info">score {{ r.score }}</span>
                          @for (m of methodsOf(r); track m.name) {
                            <span class="muted small">{{ m.name }}: {{ m.score }}</span>
                          }
                        }
                      </form>
                    </td>
                  </tr>
                }
                @if (prds()[i.id]; as prd) {
                  <tr>
                    <td colspan="4">
                      <div class="prd fg-enter">
                        <header class="fg-row fg-spread">
                          <strong>PRD — {{ prd.title ?? i.title }}</strong>
                          <button class="icon-btn" (click)="closePrd(i.id)" aria-label="Close PRD">
                            <ui-icon name="close" [size]="13" />
                          </button>
                        </header>
                        <pre class="prd__md">{{ prd.markdown }}</pre>
                        <p class="muted small">
                          {{ prd.evidence?.length ?? 0 }} evidence citation(s) ·
                          {{ prd.related_entities ?? 0 }} related entit(ies)
                        </p>
                      </div>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        } @else {
          <ui-empty icon="tasks" title="No initiatives" hint="Add the first initiative above." />
        }
      </section>

      <section class="card">
        <h2>Roadmap</h2>
        @if (roadmap()?.lanes; as lanes) {
          <div class="lanes">
            @for (lane of laneOrder; track lane) {
              <div class="lane">
                <h3>{{ laneLabel(lane) }} <span class="muted">({{ lanes[lane]?.length ?? 0 }})</span></h3>
                @for (item of lanes[lane] ?? []; track item.id) {
                  <div class="litem">
                    <strong>{{ item.title ?? item.id }}</strong>
                    <span class="muted small">score {{ item.priority_score ?? 0 }} ·
                      {{ item.evidence_count ?? 0 }} evidence</span>
                  </div>
                } @empty {
                  <p class="muted small">—</p>
                }
              </div>
            }
          </div>
          @if (roadmap()?.stats) {
            <p class="muted small">
              {{ roadmap()!.stats!.initiatives }} initiatives ·
              {{ roadmap()!.stats!.rejected }} rejected · generated
              {{ roadmap()!.generated_at ?? '—' }}
            </p>
          }
          <button class="btn btn--mini" (click)="load()">Regenerate</button>
        } @else {
          <ui-empty icon="graph" title="No roadmap data" />
        }
      </section>

      <section class="card">
        <h2>Decisions</h2>
        <form class="iform" (submit)="createDecision($event)">
          <input
            class="input"
            [value]="dTitle()"
            (input)="dTitle.set($any($event.target).value)"
            placeholder="Decision title"
            required
            aria-label="Decision title"
          />
          <input
            class="input"
            [value]="dDecision()"
            (input)="dDecision.set($any($event.target).value)"
            placeholder="The decision taken"
            aria-label="Decision"
          />
          <input
            class="input"
            [value]="dContext()"
            (input)="dContext.set($any($event.target).value)"
            placeholder="Context (optional)"
            aria-label="Context"
          />
          <button class="btn" type="submit" [disabled]="busy() || !dTitle().trim()">
            Record decision
          </button>
        </form>
        @if (decisions().length) {
          <ul class="dlist">
            @for (d of decisions(); track d.id) {
              <li>
                <strong>{{ d.title }}</strong>
                @if (d.decision) {
                  <p>{{ d.decision }}</p>
                }
                @if (d.context) {
                  <p class="muted small">{{ d.context }}</p>
                }
                @if (d.alternatives?.length) {
                  <p class="muted small">alternatives: {{ d.alternatives!.join(' · ') }}</p>
                }
              </li>
            }
          </ul>
        } @else {
          <ui-empty icon="inbox" title="No decisions recorded" />
        }
      </section>
    }
  `,
  styles: `
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
    }
    .card {
      margin-bottom: var(--space-4);
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    h3 {
      margin: 0 0 var(--space-2);
      font-size: var(--font-sm);
      font-weight: 650;
    }
    .iform {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin-bottom: var(--space-4);
    }
    .iform .input {
      flex: 1;
      min-width: 12rem;
    }
    .acts {
      white-space: nowrap;
    }
    .acts .btn + .btn {
      margin-left: var(--space-1);
    }
    .rice {
      display: flex;
      align-items: end;
      gap: var(--space-2);
      flex-wrap: wrap;
      padding: var(--space-2) 0;
    }
    .rice__label {
      width: 100%;
    }
    .rice__f {
      display: grid;
      gap: 2px;
      font-size: var(--font-xs);
      color: var(--fg-muted);
      width: 7rem;
    }
    .lanes {
      display: grid;
      gap: var(--space-3);
      grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
      margin-bottom: var(--space-3);
    }
    .lane {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-hover);
      padding: var(--space-3);
      display: grid;
      gap: var(--space-2);
      align-content: start;
    }
    .litem {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-elevated);
      padding: var(--space-2) var(--space-3);
      display: grid;
      gap: 2px;
    }
    .prd {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-hover);
      padding: var(--space-3);
      display: grid;
      gap: var(--space-2);
    }
    .prd__md {
      margin: 0;
      white-space: pre-wrap;
      font-family: var(--font-mono);
      font-size: var(--font-xs);
      max-height: 26rem;
      overflow: auto;
    }
    .dlist {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-3);
    }
    .dlist li {
      border-left: 3px solid var(--accent);
      padding: var(--space-2) var(--space-3);
      background: var(--bg-hover);
      border-radius: 0 var(--radius-md) var(--radius-md) 0;
    }
    .dlist p {
      margin: 2px 0 0;
      font-size: var(--font-sm);
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
  `,
})
export class PfPlanningTab implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly pid = input.required<string>();

  readonly initiatives = signal<PfInitiative[]>([]);
  readonly decisions = signal<PfDecision[]>([]);
  readonly roadmap = signal<PfRoadmap | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);

  readonly iTitle = signal('');
  readonly iHypothesis = signal('');
  readonly dTitle = signal('');
  readonly dDecision = signal('');
  readonly dContext = signal('');

  readonly scoreFor = signal<string | null>(null);
  readonly scoreResults = signal<Record<string, PfPrioritizeResult>>({});
  readonly prdBusy = signal<string | null>(null);
  readonly prds = signal<Record<string, PfPrd | null>>({});

  readonly riceFields = [
    { key: 'reach', label: 'Reach' },
    { key: 'impact', label: 'Impact' },
    { key: 'confidence', label: 'Confidence %' },
    { key: 'effort', label: 'Effort' },
  ] as const;
  readonly rice = signal<Record<string, number>>({
    reach: 100,
    impact: 1,
    confidence: 50,
    effort: 1,
  });

  readonly laneOrder = LANE_ORDER;

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const [ini, dec, rm] = await Promise.all([
        firstValueFrom(this.api.initiatives(this.pid())),
        firstValueFrom(this.api.decisions(this.pid())),
        firstValueFrom(this.api.roadmap(this.pid())),
      ]);
      this.initiatives.set(ini.items ?? []);
      this.decisions.set(dec.items ?? []);
      this.roadmap.set(rm);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  statusBadge(s: string | undefined): string {
    switch (s) {
      case 'in_progress':
        return 'info';
      case 'prioritized':
        return 'ok';
      case 'done':
        return 'ok';
      case 'rejected':
        return 'error';
      default:
        return 'unverified';
    }
  }

  laneLabel(lane: string): string {
    return LANE_LABEL[lane] ?? lane;
  }

  methodsOf(r: PfPrioritizeResult): { name: string; score: number }[] {
    return Object.entries(r.methods ?? {}).map(([name, m]) => ({ name, score: m.score }));
  }

  toggleScore(id: string): void {
    this.scoreFor.set(this.scoreFor() === id ? null : id);
  }

  setRice(key: string, v: number): void {
    this.rice.update((m) => ({ ...m, [key]: Number.isFinite(v) ? v : 0 }));
  }

  closePrd(id: string): void {
    this.prds.update((m) => ({ ...m, [id]: null }));
  }

  async createInitiative(ev: Event): Promise<void> {
    ev.preventDefault();
    const title = this.iTitle().trim();
    if (!title || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.createInitiative(this.pid(), {
          title,
          hypothesis: this.iHypothesis().trim(),
        }),
      );
      this.iTitle.set('');
      this.iHypothesis.set('');
      this.toast.show('Initiative added', 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async createDecision(ev: Event): Promise<void> {
    ev.preventDefault();
    const title = this.dTitle().trim();
    if (!title || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.createDecision(this.pid(), {
          title,
          decision: this.dDecision().trim(),
          context: this.dContext().trim(),
        }),
      );
      this.dTitle.set('');
      this.dDecision.set('');
      this.dContext.set('');
      this.toast.show('Decision recorded', 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async prioritize(i: PfInitiative, ev: Event): Promise<void> {
    ev.preventDefault();
    try {
      const r = await firstValueFrom(
        this.api.prioritizeInitiative(this.pid(), i.id, { rice: this.rice() }),
      );
      this.scoreResults.update((m) => ({ ...m, [i.id]: r }));
      this.toast.show(`Priority score ${r.score}`, 'info');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  async genPrd(i: PfInitiative): Promise<void> {
    if (this.prdBusy()) return;
    this.prdBusy.set(i.id);
    try {
      const prd = await firstValueFrom(this.api.generatePrd(this.pid(), i.id));
      this.prds.update((m) => ({ ...m, [i.id]: prd }));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.prdBusy.set(null);
    }
  }
}
