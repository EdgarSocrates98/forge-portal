import { TPipe } from '../../core/i18n/i18n.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { PfApi } from '../pf-api.service';
import { ApiError } from '../../core/api/api.error';
import {
  PfAgentTemplate,
  PfContextPackage,
  PfDocument,
  PfHealth,
  PfProduct,
  PfWorkspace,
} from '../pf.models';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { ToastService } from '../../shared/toast';

type StepId =
  | 'profile'
  | 'workspace'
  | 'product'
  | 'goal'
  | 'sources'
  | 'import'
  | 'context'
  | 'review'
  | 'agent'
  | 'home';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'product', label: 'Product' },
  { id: 'goal', label: 'Goal' },
  { id: 'sources', label: 'Sources' },
  { id: 'import', label: 'Import' },
  { id: 'context', label: 'Context' },
  { id: 'review', label: 'Review' },
  { id: 'agent', label: 'Agent' },
  { id: 'home', label: 'Done' },
];

/**
 * Onboarding wizard — ten steps that bootstrap a real product:
 * engine profile → workspace → product → goal → knowledge sources →
 * first document import → context package → review → initial agent →
 * done. Every advancement performs the real call; failures hold the
 * step and show the engine's error — nothing is skipped silently.
 */
@Component({
  selector: 'page-pf-onboarding',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [RouterLink, PageHeader, StateBadge, UiIcon, UiSkeleton, TPipe],
  template: `
    <ui-page-header
      title="Onboarding"
      subtitle="Bootstrap a product in the engine — every step is a real call."
    />

    <ol class="stepper" aria-label="Onboarding steps">
      @for (s of steps; track s.id; let i = $index) {
        <li
          class="stepper__step"
          [attr.data-state]="i < stepIndex() ? 'done' : i === stepIndex() ? 'active' : null"
          [attr.aria-current]="i === stepIndex() ? 'step' : null"
        >
          <span class="stepper__dot">{{ i < stepIndex() ? '✓' : i + 1 }}</span>
          <span class="stepper__label">{{ s.label }}</span>
        </li>
      }
    </ol>

    @if (stepError(); as e) {
      <div class="serr" role="alert">
        <ui-state-badge state="error" [labelOverride]="e.body.code" />
        <p>{{ e.body.message }}</p>
      </div>
    }

    @if (busy()) {
      <div role="status" aria-label="working" class="card">
        <ui-skeleton kind="text" [lines]="2" />
      </div>
    } @else {
      @switch (step().id) {
        <!-- 1 · engine profile ------------------------------------------------- -->
        @case ('profile') {
          <section class="card">
            <h2>{{ 'pf.onboarding.1EngineProfile' | t }}</h2>
            <p class="muted">
              The Studio talks to a Product Forge engine at
              <code>{{ api.baseUrl() }}</code> — check it is reachable before going on.
            </p>
            @if (health(); as h) {
              <p class="ok">
                <ui-state-badge state="ok" [labelOverride]="h.status" />
                {{ h.forge_id }} v{{ h.version }}
              </p>
            } @else if (healthErr()) {
              <p class="bad">
                Engine unreachable — configure it in
                <a routerLink="/pf/settings">{{ 'pf.onboarding.engineSettings' | t }}</a> first.
              </p>
            }
            @if (!api.token()) {
              <p class="warn">
                No API token configured — private routes will return 401. Set it in
                <a routerLink="/pf/settings">{{ 'pf.onboarding.engineSettings' | t }}</a
                >.
              </p>
            }
            <div class="actions">
              <button class="btn" (click)="checkHealth()">
                {{ 'pf.onboarding.checkConnection' | t }}
              </button>
              <button class="btn btn--primary" [disabled]="!health()" (click)="next()">
                Continue
              </button>
            </div>
          </section>
        }

        <!-- 2 · workspace ------------------------------------------------------- -->
        @case ('workspace') {
          <section class="card">
            <h2>{{ 'pf.onboarding.2Workspace' | t }}</h2>
            @if (workspaces().length) {
              <div class="pick" role="radiogroup" aria-label="Pick a workspace">
                @for (w of workspaces(); track w.id) {
                  <label class="opt" [attr.data-active]="wsId() === w.id || null">
                    <input
                      type="radio"
                      name="pf-ws"
                      [checked]="wsId() === w.id"
                      (change)="wsId.set(w.id)"
                    />
                    <span>{{ w.name }}</span>
                  </label>
                }
              </div>
            } @else {
              <p class="muted">{{ 'pf.onboarding.noWorkspacesYetCreateOne' | t }}</p>
            }
            <form class="inline" (submit)="createWorkspace($event)">
              <input
                class="input"
                [value]="wsName()"
                (input)="wsName.set($any($event.target).value)"
                placeholder="New workspace name"
                aria-label="New workspace name"
              />
              <button class="btn" type="submit" [disabled]="!wsName().trim()">
                Create workspace
              </button>
            </form>
            <div class="actions">
              <button class="btn" (click)="back()">{{ 'pf.onboarding.back' | t }}</button>
              <button class="btn btn--primary" [disabled]="!wsId()" (click)="next()">
                Continue
              </button>
            </div>
          </section>
        }

        <!-- 3 · product --------------------------------------------------------- -->
        @case ('product') {
          <section class="card">
            <h2>{{ 'pf.onboarding.3Product' | t }}</h2>
            <form class="stack" (submit)="createProduct($event)">
              <label class="field">
                <span>{{ 'pf.onboarding.name' | t }}</span>
                <input
                  class="input"
                  [value]="pName()"
                  (input)="pName.set($any($event.target).value)"
                  placeholder="e.g. Billing Analytics"
                  required
                />
              </label>
              <label class="field">
                <span>{{ 'pf.onboarding.domain' | t }}</span>
                <input
                  class="input"
                  [value]="pDomain()"
                  (input)="pDomain.set($any($event.target).value)"
                  placeholder="e.g. fintech (optional)"
                />
              </label>
              <label class="field">
                <span>{{ 'pf.onboarding.description' | t }}</span>
                <input
                  class="input"
                  [value]="pDesc()"
                  (input)="pDesc.set($any($event.target).value)"
                  placeholder="One line (optional)"
                />
              </label>
              <div class="actions">
                <button class="btn" type="button" (click)="back()">
                  {{ 'pf.onboarding.back' | t }}
                </button>
                <button class="btn btn--primary" type="submit" [disabled]="!pName().trim()">
                  Create product
                </button>
              </div>
            </form>
          </section>
        }

        <!-- 4 · goal -------------------------------------------------------------- -->
        @case ('goal') {
          <section class="card">
            <h2>{{ 'pf.onboarding.4ProductGoal' | t }}</h2>
            <p class="muted">
              A short statement of what this product must learn or decide. It is saved as your first
              knowledge document in the Import step — the engine has no separate goal field, so
              nothing here is pretend-persisted.
            </p>
            <textarea
              class="textarea"
              rows="5"
              [value]="goal()"
              (input)="goal.set($any($event.target).value)"
              placeholder="e.g. Understand which billing events predict churn and rank the top retention initiatives."
            ></textarea>
            <div class="actions">
              <button class="btn" (click)="back()">{{ 'pf.onboarding.back' | t }}</button>
              <button class="btn" (click)="goal.set(''); next()">
                {{ 'pf.onboarding.skip' | t }}
              </button>
              <button class="btn btn--primary" [disabled]="!goal().trim()" (click)="next()">
                Continue
              </button>
            </div>
          </section>
        }

        <!-- 5 · sources ------------------------------------------------------------ -->
        @case ('sources') {
          <section class="card">
            <h2>{{ 'pf.onboarding.5KnowledgeSources' | t }}</h2>
            <p class="muted">
              Register where product knowledge lives — a doc directory, a repo, a wiki. The locator
              is a path/URI; credentials never go here.
            </p>
            <form class="stack" (submit)="registerSource($event)">
              <label class="field">
                <span>{{ 'pf.onboarding.name' | t }}</span>
                <input
                  class="input"
                  [value]="srcName()"
                  (input)="srcName.set($any($event.target).value)"
                  placeholder="e.g. Product wiki export"
                />
              </label>
              <div class="fg-row" data-wrap>
                <select
                  class="select type"
                  [value]="srcType()"
                  (change)="srcType.set($any($event.target).value)"
                  aria-label="Source type"
                >
                  @for (t of sourceTypes; track t) {
                    <option [value]="t">{{ t }}</option>
                  }
                </select>
                <input
                  class="input grow"
                  [value]="srcLocator()"
                  (input)="srcLocator.set($any($event.target).value)"
                  placeholder="Locator — path or URI (optional)"
                  aria-label="Locator"
                />
              </div>
              <div class="actions">
                <button class="btn" type="button" (click)="back()">
                  {{ 'pf.onboarding.back' | t }}
                </button>
                <button class="btn" type="button" (click)="next()">
                  {{ 'pf.onboarding.skip' | t }}
                </button>
                <button class="btn btn--primary" type="submit" [disabled]="!srcName().trim()">
                  Register source
                </button>
              </div>
            </form>
            @if (sourceRegistered()) {
              <p class="ok">{{ 'pf.onboarding.sourceRegisteredContinueWhenReady' | t }}</p>
              <button class="btn btn--primary" (click)="next()">
                {{ 'pf.onboarding.continue' | t }}
              </button>
            }
          </section>
        }

        <!-- 6 · import ------------------------------------------------------------- -->
        @case ('import') {
          <section class="card">
            <h2>{{ 'pf.onboarding.6FirstDocument' | t }}</h2>
            <form class="stack" (submit)="importDoc($event)">
              <label class="field">
                <span>{{ 'pf.onboarding.title' | t }}</span>
                <input
                  class="input"
                  [value]="docTitle()"
                  (input)="docTitle.set($any($event.target).value)"
                  placeholder="e.g. Product goal"
                />
              </label>
              <label class="field">
                <span>{{ 'pf.onboarding.content' | t }}</span>
                <textarea
                  class="textarea"
                  rows="7"
                  [value]="docContent()"
                  (input)="docContent.set($any($event.target).value)"
                  placeholder="Paste the first document — goal notes, a PRD draft, discovery findings."
                ></textarea>
              </label>
              <div class="actions">
                <button class="btn" type="button" (click)="back()">
                  {{ 'pf.onboarding.back' | t }}
                </button>
                <button class="btn" type="button" (click)="next()">
                  {{ 'pf.onboarding.skip' | t }}
                </button>
                <button
                  class="btn btn--primary"
                  type="submit"
                  [disabled]="!docTitle().trim() || !docContent().trim()"
                >
                  Import document
                </button>
              </div>
            </form>
            @if (doc(); as d) {
              <p class="ok">Imported "{{ d.title }}" — {{ d.chunk_count ?? 0 }} chunks indexed.</p>
              <button class="btn btn--primary" (click)="next()">
                {{ 'pf.onboarding.continue' | t }}
              </button>
            }
          </section>
        }

        <!-- 7 · context -------------------------------------------------------------- -->
        @case ('context') {
          <section class="card">
            <h2>{{ 'pf.onboarding.7ContextPackage' | t }}</h2>
            @if (ctx(); as c) {
              <div class="stats">
                <div class="stat">
                  <span class="stat__value">{{ c.sources?.length ?? 0 }}</span>
                  <span class="stat__label">{{ 'pf.onboarding.sources' | t }}</span>
                </div>
                <div class="stat">
                  <span class="stat__value">{{ c.entities?.length ?? 0 }}</span>
                  <span class="stat__label">{{ 'pf.onboarding.entities' | t }}</span>
                </div>
                <div class="stat">
                  <span class="stat__value">{{ c.data_sources?.length ?? 0 }}</span>
                  <span class="stat__label">{{ 'pf.onboarding.dataSources' | t }}</span>
                </div>
              </div>
              <p class="muted">
                This is the live <code>productforge/ProductContextPackage/v1</code> the engine
                assembled for
                <strong>{{ c.product.name }}</strong>
                — generated {{ c.generated_at ?? '—' }}.
              </p>
            } @else {
              <button class="btn" (click)="loadContext()">
                {{ 'pf.onboarding.loadContextPackage' | t }}
              </button>
            }
            <div class="actions">
              <button class="btn" (click)="back()">{{ 'pf.onboarding.back' | t }}</button>
              <button class="btn btn--primary" [disabled]="!ctx()" (click)="next()">
                Continue
              </button>
            </div>
          </section>
        }

        <!-- 8 · review ----------------------------------------------------------------- -->
        @case ('review') {
          <section class="card">
            <h2>{{ 'pf.onboarding.8Review' | t }}</h2>
            <dl class="kv">
              <div>
                <dt>{{ 'pf.onboarding.workspace' | t }}</dt>
                <dd>
                  {{ wsNameOf(wsId()) }} <code class="muted small">{{ wsId() }}</code>
                </dd>
              </div>
              <div>
                <dt>{{ 'pf.onboarding.product' | t }}</dt>
                <dd>
                  {{ product()?.name ?? '—' }}
                  <code class="muted small">{{ product()?.id }}</code>
                </dd>
              </div>
              <div>
                <dt>{{ 'pf.onboarding.goal' | t }}</dt>
                <dd>{{ goal() || '—' }}</dd>
              </div>
              <div>
                <dt>{{ 'pf.onboarding.source' | t }}</dt>
                <dd>{{ srcName() || '— skipped' }}</dd>
              </div>
              <div>
                <dt>{{ 'pf.onboarding.document' | t }}</dt>
                <dd>{{ doc()?.title ?? '— skipped' }}</dd>
              </div>
            </dl>
            <div class="actions">
              <button class="btn" (click)="back()">{{ 'pf.onboarding.back' | t }}</button>
              <button class="btn btn--primary" (click)="next()">
                {{ 'pf.onboarding.continue' | t }}
              </button>
            </div>
          </section>
        }

        <!-- 9 · initial agent ------------------------------------------------------------ -->
        @case ('agent') {
          <section class="card">
            <h2>{{ 'pf.onboarding.9InitialAgent' | t }}</h2>
            @if (templates().length) {
              <div class="pick" role="radiogroup" aria-label="Pick a template">
                @for (t of templates(); track t.name) {
                  <label class="opt" [attr.data-active]="tpl() === t.name || null">
                    <input
                      type="radio"
                      name="pf-tpl"
                      [checked]="tpl() === t.name"
                      (change)="tpl.set(t.name)"
                    />
                    <span>
                      <strong>{{ t.name }}</strong>
                      <small class="muted"> {{ t.mission }}</small>
                    </span>
                  </label>
                }
              </div>
              <form class="inline" (submit)="createAgent($event)">
                <input
                  class="input"
                  [value]="agentName()"
                  (input)="agentName.set($any($event.target).value)"
                  placeholder="Agent name"
                  aria-label="Agent name"
                />
                <button class="btn btn--primary" type="submit" [disabled]="!agentName().trim()">
                  Create agent
                </button>
              </form>
            } @else {
              <p class="muted">{{ 'pf.onboarding.theEngineReportedNoTemplates' | t }}</p>
            }
            @if (agentCreated()) {
              <p class="ok">{{ 'pf.onboarding.agentCreatedEvalItAnd' | t }}</p>
            }
            <div class="actions">
              <button class="btn" (click)="back()">{{ 'pf.onboarding.back' | t }}</button>
              <button class="btn btn--primary" (click)="next()">
                {{ agentCreated() ? 'Finish' : 'Skip & finish' }}
              </button>
            </div>
          </section>
        }

        <!-- 10 · done ------------------------------------------------------------------------ -->
        @case ('home') {
          <section class="card done">
            <h2>{{ 'pf.onboarding.productForgeIsSetUp' | t }}</h2>
            <p class="muted">
              <strong>{{ product()?.name }}</strong> is live in the engine with
              {{ ctx()?.entities?.length ?? 0 }} entities and
              {{ ctx()?.sources?.length ?? 0 }} knowledge source(s).
            </p>
            <div class="actions">
              @if (product(); as p) {
                <a class="btn btn--primary" [routerLink]="['/pf/products', p.id]">
                  Open product workspace
                  <ui-icon name="chevron-right" [size]="14" />
                </a>
              }
              <a class="btn" routerLink="/pf">{{ 'pf.onboarding.studioHome' | t }}</a>
            </div>
          </section>
        }
      }
    }
  `,
  styles: `
    .stepper {
      margin-bottom: var(--space-5);
    }
    .card {
      max-width: 46rem;
      margin-bottom: var(--space-4);
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .muted {
      color: var(--fg-muted);
      margin: 0 0 var(--space-3);
    }
    .small {
      font-size: var(--font-xs);
    }
    .stack {
      display: grid;
      gap: var(--space-3);
    }
    .field {
      display: grid;
      gap: 4px;
      font-size: var(--font-sm);
      font-weight: 550;
    }
    .inline {
      display: flex;
      gap: var(--space-2);
      margin: var(--space-3) 0;
      flex-wrap: wrap;
    }
    .inline .input {
      flex: 1;
      min-width: 12rem;
    }
    .grow {
      flex: 1;
      min-width: 12rem;
    }
    .type {
      max-width: 10rem;
    }
    .pick {
      display: grid;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .opt {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-2) var(--space-3);
      cursor: pointer;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast);
    }
    .opt[data-active] {
      border-color: var(--accent);
      background: var(--accent-bg);
    }
    .opt input {
      accent-color: var(--accent-ink);
    }
    .actions {
      display: flex;
      gap: var(--space-2);
      margin-top: var(--space-4);
      flex-wrap: wrap;
    }
    .ok {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--ok);
      margin: var(--space-3) 0;
    }
    .warn {
      color: var(--warn);
      margin: var(--space-3) 0;
    }
    .bad {
      color: var(--error);
      margin: var(--space-3) 0;
    }
    .serr {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      border: 1px solid color-mix(in srgb, var(--error) 55%, transparent);
      border-left-width: 3px;
      border-radius: var(--radius-md);
      background: var(--error-bg);
      padding: var(--space-3);
      margin-bottom: var(--space-4);
      max-width: 46rem;
    }
    .serr p {
      margin: 0;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .kv {
      display: grid;
      gap: var(--space-2);
      margin: 0;
    }
    .kv div {
      display: flex;
      gap: var(--space-3);
      align-items: baseline;
    }
    .kv dt {
      min-width: 7rem;
      color: var(--fg-muted);
      font-size: var(--font-sm);
      flex: none;
    }
    .kv dd {
      margin: 0;
    }
    .done {
      border-left: 3px solid var(--ok);
    }
    .done .actions {
      margin-top: var(--space-4);
    }
    .done .actions a {
      text-decoration: none;
    }
  `,
})
export class PfOnboardingPage implements OnInit {
  readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);

  readonly steps = STEPS;
  readonly stepIndex = signal(0);
  readonly step = computed(() => STEPS[this.stepIndex()]);
  readonly busy = signal(false);
  readonly stepError = signal<ApiError | null>(null);

  readonly sourceTypes = ['markdown', 'text', 'url', 'repo', 'pdf', 'docx', 'meeting', 'ticket'];

  // collected state across steps
  readonly health = signal<PfHealth | null>(null);
  readonly healthErr = signal(false);
  readonly workspaces = signal<PfWorkspace[]>([]);
  readonly wsId = signal('');
  readonly wsName = signal('');
  readonly product = signal<PfProduct | null>(null);
  readonly pName = signal('');
  readonly pDomain = signal('');
  readonly pDesc = signal('');
  readonly goal = signal('');
  readonly srcName = signal('');
  readonly srcType = signal('markdown');
  readonly srcLocator = signal('');
  readonly sourceRegistered = signal(false);
  readonly docTitle = signal('Product goal');
  readonly docContent = signal('');
  readonly doc = signal<PfDocument | null>(null);
  readonly ctx = signal<PfContextPackage | null>(null);
  readonly templates = signal<PfAgentTemplate[]>([]);
  readonly tpl = signal('custom');
  readonly agentName = signal('');
  readonly agentCreated = signal(false);

  ngOnInit(): void {
    void this.checkHealth();
    void this.loadWorkspaces();
  }

  next(): void {
    this.stepError.set(null);
    this.stepIndex.update((i) => Math.min(i + 1, STEPS.length - 1));
    const s = this.step().id;
    if (s === 'context') void this.loadContext();
    if (s === 'agent' && !this.templates().length) void this.loadTemplates();
    if (s === 'import' && !this.docContent() && this.goal().trim()) {
      this.docContent.set(`# Product goal\n\n${this.goal()}`);
    }
  }

  back(): void {
    this.stepError.set(null);
    this.stepIndex.update((i) => Math.max(i - 1, 0));
  }

  async checkHealth(): Promise<void> {
    this.busy.set(true);
    try {
      this.health.set(await firstValueFrom(this.api.health()));
      this.healthErr.set(false);
    } catch {
      this.health.set(null);
      this.healthErr.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  async loadWorkspaces(): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.workspaces());
      this.workspaces.set(r.items ?? []);
      if (!this.wsId() && r.items?.length) this.wsId.set(r.items[0].id);
    } catch (e) {
      this.stepError.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  async createWorkspace(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.wsName().trim();
    if (!name) return;
    this.busy.set(true);
    this.stepError.set(null);
    try {
      const w = await firstValueFrom(this.api.createWorkspace({ name }));
      this.wsName.set('');
      this.wsId.set(w.id);
      this.toast.show(`Workspace "${name}" created`, 'success');
      await this.loadWorkspaces();
      this.wsId.set(w.id);
    } catch (e) {
      this.stepError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async createProduct(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.pName().trim();
    if (!name || !this.wsId()) return;
    this.busy.set(true);
    this.stepError.set(null);
    try {
      this.product.set(await firstValueFrom(this.api.createProduct(this.pidBody(name))));
      this.toast.show(`Product "${name}" created`, 'success');
      this.next();
    } catch (e) {
      this.stepError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  private pidBody(name: string) {
    return {
      workspace_id: this.wsId(),
      name,
      description: this.pDesc().trim(),
      domain: this.pDomain().trim(),
    };
  }

  async registerSource(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.srcName().trim();
    if (!name || !this.product()) return;
    this.busy.set(true);
    this.stepError.set(null);
    try {
      await firstValueFrom(
        this.api.createKnowledgeSource(this.product()!.id, {
          name,
          type: this.srcType(),
          locator: this.srcLocator().trim(),
        }),
      );
      this.sourceRegistered.set(true);
      this.toast.show('Knowledge source registered', 'success');
    } catch (e) {
      this.stepError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async importDoc(ev: Event): Promise<void> {
    ev.preventDefault();
    const title = this.docTitle().trim();
    const content = this.docContent();
    if (!title || !content.trim() || !this.product()) return;
    this.busy.set(true);
    this.stepError.set(null);
    try {
      this.doc.set(
        await firstValueFrom(this.api.importDocument(this.product()!.id, { title, content })),
      );
      this.toast.show('Document imported', 'success');
    } catch (e) {
      this.stepError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async loadContext(): Promise<void> {
    if (!this.product()) return;
    this.busy.set(true);
    this.stepError.set(null);
    try {
      this.ctx.set(await firstValueFrom(this.api.productContext(this.product()!.id)));
    } catch (e) {
      this.stepError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async loadTemplates(): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.agentTemplates());
      this.templates.set(r.items ?? []);
      if (r.items?.length) this.tpl.set(r.items[0].name);
    } catch (e) {
      this.stepError.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  async createAgent(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.agentName().trim();
    if (!name || !this.product()) return;
    this.busy.set(true);
    this.stepError.set(null);
    try {
      const t = this.templates().find((x) => x.name === this.tpl());
      await firstValueFrom(
        this.api.createAgent(this.product()!.id, {
          name,
          template: this.tpl() || 'custom',
          mission: t?.mission ?? '',
          tools_allowed: t?.tools ?? [],
        }),
      );
      this.agentCreated.set(true);
      this.toast.show('Agent created', 'success');
    } catch (e) {
      this.stepError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  wsNameOf(id: string): string {
    return this.workspaces().find((w) => w.id === id)?.name ?? id;
  }
}
