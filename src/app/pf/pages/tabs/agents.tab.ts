import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PfApi } from '../../pf-api.service';
import { ApiError } from '../../../core/api/api.error';
import { PfAgent, PfAgentRun, PfAgentTemplate, PfEvalReport } from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { StateBadge } from '../../../shared/state-badge';
import { UiIcon } from '../../../shared/icon';
import { UiSkeleton } from '../../../shared/skeleton';
import { ToastService } from '../../../shared/toast';

/**
 * Agents tab — template roster, agent definitions and the real
 * run → eval → publish pipeline. The publish gate mirrors the engine
 * exactly: disabled until `tools_allowed` is non-empty AND the last eval
 * score is ≥ 0.5 — the server enforces the same rule, so a bypass is
 * impossible, the disabled state is just honest UX.
 */
@Component({
  selector: 'pf-agents-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, StateBadge, UiIcon, UiSkeleton],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" aria-label="loading agents"><ui-skeleton kind="card" [lines]="3" /></div>
    } @else {
      <section class="card">
        <h2>New agent from template</h2>
        @if (templates().length) {
          <div class="tpls">
            @for (t of templates(); track t.name) {
              <button
                type="button"
                class="tpl"
                [attr.data-active]="formTemplate() === t.name || null"
                (click)="pickTemplate(t)"
              >
                <strong>{{ t.name }}</strong>
                <span class="muted small">{{ t.mission }}</span>
                <span class="muted small">
                  {{ t.eval_cases ?? 0 }} eval case(s) ·
                  {{ (t.tools ?? []).join(', ') || 'no tools' }}
                </span>
              </button>
            }
          </div>
        } @else {
          <ui-empty icon="agents" title="No templates reported by the engine" />
        }
        <form class="create" (submit)="createAgent($event)">
          <input
            class="input"
            [value]="formName()"
            (input)="formName.set($any($event.target).value)"
            placeholder="Agent name"
            required
            aria-label="Agent name"
          />
          <input
            class="input"
            [value]="formMission()"
            (input)="formMission.set($any($event.target).value)"
            placeholder="Mission (optional — template default applies)"
            aria-label="Mission"
          />
          <input
            class="input"
            [value]="formTools()"
            (input)="formTools.set($any($event.target).value)"
            placeholder="tools_allowed, comma-separated (e.g. knowledge_query,data_sources)"
            aria-label="Allowed tools"
          />
          <button class="btn btn--primary" type="submit" [disabled]="busy() || !formName().trim()">
            Create agent
          </button>
        </form>
      </section>

      @if (agents().length) {
        <div class="alist">
          @for (a of agents(); track a.id) {
            <article class="card agent" [attr.data-open]="openId() === a.id || null">
              <header class="agent__head">
                <div class="agent__id">
                  <strong>{{ a.name }}</strong>
                  <code class="muted small">{{ a.id }}</code>
                </div>
                <div class="agent__badges">
                  <ui-state-badge
                    [state]="agentBadge(a.status)"
                    [labelOverride]="a.status ?? 'draft'"
                  />
                  @if (a.eval_summary?.score !== undefined) {
                    <span
                      class="fg-pill"
                      [attr.data-tone]="a.eval_summary!.score >= 0.5 ? 'success' : 'warning'"
                      >eval {{ score(a) }}</span
                    >
                  }
                  <span class="muted small">v{{ a.version ?? 1 }}</span>
                </div>
                <button
                  class="icon-btn"
                  (click)="toggle(a.id)"
                  [attr.aria-label]="'Toggle details'"
                >
                  <ui-icon
                    [name]="openId() === a.id ? 'chevron-left' : 'chevron-right'"
                    [size]="15"
                  />
                </button>
              </header>
              @if (a.mission) {
                <p class="muted small agent__mission">{{ a.mission }}</p>
              }

              @if (openId() === a.id) {
                <div class="agent__body fg-enter">
                  <dl class="kv">
                    <div>
                      <dt>Template</dt>
                      <dd>
                        <code>{{ a.template ?? 'custom' }}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Tools allowed</dt>
                      <dd>
                        @if (a.tools_allowed?.length) {
                          {{ a.tools_allowed!.join(', ') }}
                        } @else {
                          <ui-state-badge state="warn" labelOverride="none — publish blocked" />
                        }
                      </dd>
                    </div>
                    <div>
                      <dt>Knowledge scope</dt>
                      <dd>{{ (a.knowledge_scope ?? []).join(', ') || '—' }}</dd>
                    </div>
                    @if (a.eval_summary) {
                      <div>
                        <dt>Last eval</dt>
                        <dd>
                          {{ a.eval_summary!.passed ?? '—' }}/{{
                            a.eval_summary!.total ?? '—'
                          }}
                          passed · score {{ score(a) }}
                          @if (a.eval_summary!.at) {
                            <span class="muted small"> · {{ a.eval_summary!.at }}</span>
                          }
                        </dd>
                      </div>
                    }
                  </dl>

                  <form class="runrow" (submit)="runAgent(a, $event)">
                    <input
                      class="input"
                      [value]="runInput()[a.id] ?? ''"
                      (input)="setRunInput(a.id, $any($event.target).value)"
                      placeholder="Run input — e.g. summarize churn evidence"
                      aria-label="Run input"
                      required
                    />
                    <button
                      class="btn"
                      type="submit"
                      [disabled]="runningId() === a.id || !(runInput()[a.id] ?? '').trim()"
                    >
                      {{ runningId() === a.id ? 'Running…' : 'Run' }}
                    </button>
                    <button
                      class="btn"
                      type="button"
                      [disabled]="evalingId() === a.id"
                      (click)="evalAgent(a)"
                    >
                      {{ evalingId() === a.id ? 'Evaluating…' : 'Run eval' }}
                    </button>
                    <button
                      class="btn btn--primary"
                      type="button"
                      [disabled]="!canPublish(a) || publishingId() === a.id"
                      [title]="publishHint(a)"
                      (click)="publishAgent(a)"
                    >
                      {{ publishingId() === a.id ? 'Publishing…' : 'Publish' }}
                    </button>
                  </form>

                  @if (evalReports()[a.id]; as rep) {
                    <div class="panel">
                      <div class="fg-row">
                        <ui-state-badge
                          [state]="rep.score >= 0.5 ? 'ok' : 'warn'"
                          [labelOverride]="'eval score ' + rep.score"
                        />
                        <span class="muted small"
                          >{{ rep.passed }}/{{ rep.total }} cases passed</span
                        >
                      </div>
                      @if (rep.results?.length) {
                        <ul class="cases">
                          @for (r of rep.results; track r.case) {
                            <li [attr.data-pass]="r.passed || null">
                              <ui-icon [name]="r.passed ? 'check' : 'alert'" [size]="13" />
                              {{ r.case }}
                            </li>
                          }
                        </ul>
                      }
                    </div>
                  }

                  @if (lastRuns()[a.id]; as run) {
                    <div class="panel">
                      <div class="fg-row">
                        <ui-state-badge
                          [state]="runBadge(run.status)"
                          [labelOverride]="run.status"
                        />
                        <code class="muted small">{{ run.id }}</code>
                        @if (run.created_at) {
                          <span class="muted small">{{ run.created_at }}</span>
                        }
                      </div>
                      @if (run.output?.refusal) {
                        <p class="refusal">{{ run.output!.refusal }}</p>
                      }
                      @if (run.output?.summary) {
                        <p class="summary">{{ run.output!.summary }}</p>
                      }
                      @if (run.steps?.length) {
                        <ul class="steps">
                          @for (s of run.steps; track $index) {
                            <li>
                              <code>{{ s.step }}</code>
                              <span [attr.data-tone]="s.status === 'ok' ? 'ok' : 'warn'">{{
                                s.status
                              }}</span>
                              @if (s.duration_ms !== undefined) {
                                <span class="muted small">{{ s.duration_ms }}ms</span>
                              }
                            </li>
                          }
                        </ul>
                      }
                      @if (run.output?.citations?.length) {
                        <p class="muted small">
                          {{ run.output!.citations!.length }} citation(s) · grounded:
                          {{ run.output!.grounded ? 'yes' : 'no' }}
                        </p>
                      }
                      @if (run.output?.note) {
                        <p class="muted small">{{ run.output!.note }}</p>
                      }
                    </div>
                  }
                </div>
              }
            </article>
          }
        </div>
      } @else if (!error()) {
        <ui-empty
          icon="agents"
          title="No agents defined"
          hint="Create one from a template above."
        />
      }
    }
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .tpls {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    .tpl {
      display: grid;
      gap: 4px;
      text-align: left;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-elevated);
      color: var(--fg);
      cursor: pointer;
      font: inherit;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast);
    }
    .tpl:hover {
      border-color: var(--border-strong);
      background: var(--bg-hover);
    }
    .tpl[data-active] {
      border-color: var(--accent);
      background: var(--accent-bg);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent);
    }
    .create {
      display: grid;
      gap: var(--space-2);
      grid-template-columns: 1fr 1fr;
    }
    .create .input:nth-child(3) {
      grid-column: 1 / -1;
    }
    .create .btn {
      grid-column: 1 / -1;
      justify-self: start;
    }
    .alist {
      display: grid;
      gap: var(--space-3);
    }
    .agent {
      margin-bottom: 0;
    }
    .agent__head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .agent__id {
      display: grid;
      min-width: 0;
      flex: 1;
    }
    .agent__badges {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .agent__mission {
      margin: var(--space-2) 0 0;
    }
    .agent__body {
      margin-top: var(--space-4);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
      display: grid;
      gap: var(--space-3);
    }
    .kv {
      display: grid;
      gap: var(--space-2);
      margin: 0;
    }
    .kv div {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
    }
    .kv dt {
      min-width: 8rem;
      color: var(--fg-muted);
      font-size: var(--font-sm);
      flex: none;
    }
    .kv dd {
      margin: 0;
    }
    .runrow {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .runrow .input {
      flex: 1;
      min-width: 14rem;
    }
    .panel {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-hover);
      padding: var(--space-3);
      display: grid;
      gap: var(--space-2);
    }
    .cases,
    .steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 4px;
      font-size: var(--font-sm);
    }
    .cases li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--fg-muted);
    }
    .cases li[data-pass] {
      color: var(--ok);
    }
    .steps li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .steps [data-tone='ok'] {
      color: var(--ok);
    }
    .steps [data-tone='warn'] {
      color: var(--warn);
    }
    .refusal {
      margin: 0;
      color: var(--warn);
      font-size: var(--font-sm);
    }
    .summary {
      margin: 0;
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
export class PfAgentsTab implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly pid = input.required<string>();

  readonly templates = signal<PfAgentTemplate[]>([]);
  readonly agents = signal<PfAgent[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);

  readonly openId = signal<string | null>(null);
  readonly runningId = signal<string | null>(null);
  readonly evalingId = signal<string | null>(null);
  readonly publishingId = signal<string | null>(null);

  readonly formName = signal('');
  readonly formMission = signal('');
  readonly formTools = signal('');
  readonly formTemplate = signal('custom');

  readonly runInput = signal<Record<string, string>>({});
  readonly lastRuns = signal<Record<string, PfAgentRun>>({});
  readonly evalReports = signal<Record<string, PfEvalReport>>({});

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const [tpl, ag] = await Promise.all([
        firstValueFrom(this.api.agentTemplates()),
        firstValueFrom(this.api.agents(this.pid())),
      ]);
      this.templates.set(tpl.items ?? []);
      this.agents.set(ag.items ?? []);
      if (!this.formTemplate() && tpl.items?.length) this.formTemplate.set(tpl.items[0].name);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  pickTemplate(t: PfAgentTemplate): void {
    this.formTemplate.set(t.name);
    if (!this.formMission().trim() && t.mission) this.formMission.set(t.mission);
    if (!this.formTools().trim() && t.tools?.length) this.formTools.set(t.tools.join(','));
  }

  toggle(id: string): void {
    this.openId.set(this.openId() === id ? null : id);
  }

  setRunInput(id: string, v: string): void {
    this.runInput.update((m) => ({ ...m, [id]: v }));
  }

  agentBadge(status: string | undefined): string {
    switch (status) {
      case 'published':
        return 'ok';
      case 'archived':
        return 'muted';
      case 'testing':
        return 'info';
      default:
        return 'unverified';
    }
  }

  runBadge(status: string): string {
    if (status === 'completed') return 'ok';
    if (status === 'blocked' || status === 'failed' || status === 'cancelled') return 'error';
    if (status === 'partial' || status === 'interrupted') return 'warn';
    return 'info';
  }

  score(a: PfAgent): string {
    const s = a.eval_summary?.score;
    return s === undefined ? '—' : String(s);
  }

  /** Mirrors the engine gate: tools_allowed non-empty + eval ≥ 0.5. */
  canPublish(a: PfAgent): boolean {
    return (a.tools_allowed?.length ?? 0) > 0 && (a.eval_summary?.score ?? 0) >= 0.5;
  }

  publishHint(a: PfAgent): string {
    if (!(a.tools_allowed?.length ?? 0)) return 'Set tools_allowed before publishing';
    if ((a.eval_summary?.score ?? 0) < 0.5) return 'Run eval — publish gate is score ≥ 0.5';
    return 'Publish this agent';
  }

  async createAgent(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.formName().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    try {
      const tools = this.formTools()
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await firstValueFrom(
        this.api.createAgent(this.pid(), {
          name,
          mission: this.formMission().trim(),
          template: this.formTemplate() || 'custom',
          tools_allowed: tools,
        }),
      );
      this.formName.set('');
      this.formMission.set('');
      this.formTools.set('');
      this.toast.show(`Agent "${name}" created`, 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async runAgent(a: PfAgent, ev: Event): Promise<void> {
    ev.preventDefault();
    const input = (this.runInput()[a.id] ?? '').trim();
    if (!input || this.runningId()) return;
    this.runningId.set(a.id);
    try {
      const run = await firstValueFrom(this.api.runAgent(this.pid(), a.id, input));
      this.lastRuns.update((m) => ({ ...m, [a.id]: run }));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.runningId.set(null);
    }
  }

  async evalAgent(a: PfAgent): Promise<void> {
    if (this.evalingId()) return;
    this.evalingId.set(a.id);
    try {
      const rep = await firstValueFrom(this.api.evalAgent(this.pid(), a.id));
      this.evalReports.update((m) => ({ ...m, [a.id]: rep }));
      await this.load(); // eval_summary persists server-side — refresh
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.evalingId.set(null);
    }
  }

  async publishAgent(a: PfAgent): Promise<void> {
    if (!this.canPublish(a) || this.publishingId()) return;
    this.publishingId.set(a.id);
    try {
      await firstValueFrom(this.api.publishAgent(this.pid(), a.id));
      this.toast.show(`Agent "${a.name}" published`, 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.publishingId.set(null);
    }
  }
}
