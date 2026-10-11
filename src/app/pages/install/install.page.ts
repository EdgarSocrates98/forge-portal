import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { HostDetection, InstallationReceipt } from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';

type Phase = 'idle' | 'planning' | 'review' | 'running' | 'done' | 'refused' | 'error';

/**
 * Instalação — o mesmo Plan → Review → Confirm → Execute → Receipt do
 * CLI. O plano vem do servidor; nada é executado sem revisão explícita.
 */
@Component({
  selector: 'page-install',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, ErrorState, UiIcon],
  template: `
    <ui-page-header [title]="'install.title' | t" [subtitle]="'install.subtitle' | t">
      <button class="btn" (click)="reload()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <section class="card status">
      <div class="status__row">
        <h2>{{ 'install.status' | t }}</h2>
        @if (store.health(); as h) {
          <ui-state-badge [state]="h.state" />
        }
      </div>
      <ol class="stepper" [attr.aria-label]="'install.title' | t">
        @for (s of stepKeys; track s; let i = $index) {
          <li
            class="stepper__step"
            [attr.data-state]="stepState(i)"
            [attr.aria-current]="i === stepIndex() ? 'step' : null"
          >
            <span class="stepper__dot" aria-hidden="true">
              @if (stepState(i) === 'done') {
                <ui-icon name="check" [size]="13" />
              } @else if (stepState(i) === 'warn') {
                <ui-icon name="alert" [size]="13" />
              } @else {
                {{ i + 1 }}
              }
            </span>
            <span class="stepper__label">{{ s | t }}</span>
          </li>
        }
      </ol>
    </section>

    <div class="config-grid">
      <section class="card">
        <h2>{{ 'install.scope' | t }}</h2>
        <div class="scopes" role="radiogroup" [attr.aria-label]="'install.scope' | t">
          @for (s of scopes; track s.id) {
            <label class="scope" [attr.data-active]="scope() === s.id || null">
              <input
                type="radio"
                name="scope"
                [value]="s.id"
                [checked]="scope() === s.id"
                (change)="scope.set(s.id)"
              />
              <span>
                <strong>{{ s.label | t }}</strong>
                <small>{{ s.hint | t }}</small>
              </span>
            </label>
          }
        </div>

        <h2>{{ 'install.hosts' | t }}</h2>
        <p class="muted">{{ 'install.hosts.hint' | t }}</p>
        <div class="scopes" role="radiogroup" [attr.aria-label]="'install.hosts' | t">
          @for (h of hostChoices; track h.id) {
            <label class="scope" [attr.data-active]="host() === h.id || null">
              <input
                type="radio"
                name="host"
                [value]="h.id"
                [checked]="host() === h.id"
                (change)="host.set(h.id)"
              />
              <span>
                <strong>{{ h.labelKey ? (h.labelKey | t) : h.label }}</strong>
                <small>{{ hostState(h.id) }}</small>
              </span>
            </label>
          }
        </div>

        <h2>{{ 'install.profile' | t }}</h2>
        <div class="scopes" role="radiogroup" [attr.aria-label]="'install.profile' | t">
          @for (p of profiles; track p.id) {
            <label class="scope" [attr.data-active]="profile() === p.id || null">
              <input
                type="radio"
                name="profile"
                [value]="p.id"
                [checked]="profile() === p.id"
                (change)="profile.set(p.id)"
              />
              <span>
                <strong>{{ p.label | t }}</strong>
                <small>{{ p.hint | t }}</small>
              </span>
            </label>
          }
        </div>

        <h2>{{ 'install.components' | t }}</h2>
        <div class="comps">
          @for (c of components; track c.id) {
            <label class="comp" [attr.data-active]="selected().has(c.id) || null">
              <input type="checkbox" [checked]="selected().has(c.id)" (change)="toggle(c.id)" />
              <span>{{ c.id }}</span>
            </label>
          }
        </div>
      </section>

      <aside class="card summary">
        <h2>{{ 'install.summary' | t }}</h2>
        <dl class="summary__kv">
          <div>
            <dt>{{ 'install.summary.scope' | t }}</dt>
            <dd>{{ scopeLabel() | t }}</dd>
          </div>
          <div>
            <dt>{{ 'install.summary.host' | t }}</dt>
            <dd>{{ hostLabel() }}</dd>
          </div>
          <div>
            <dt>{{ 'install.summary.profile' | t }}</dt>
            <dd>{{ profileLabel() | t }}</dd>
          </div>
          <div>
            <dt>{{ 'install.summary.components' | t }}</dt>
            <dd>
              @if (selected().size) {
                <span class="summary__comps">
                  @for (c of selected(); track c) {
                    <code class="summary__chip">{{ c }}</code>
                  }
                </span>
              } @else {
                <span class="muted">{{ 'install.summary.empty' | t }}</span>
              }
            </dd>
          </div>
        </dl>
        <div class="row">
          <button class="btn btn--primary" [disabled]="busy() || !selected().size" (click)="plan()">
            <ui-icon name="install" [size]="15" />
            {{ 'install.plan' | t }}
          </button>
          <button class="btn" [disabled]="busy()" (click)="repair()">
            <ui-icon name="refresh" [size]="15" />
            {{ 'install.repair' | t }}
          </button>
          <button
            class="btn btn--danger"
            [disabled]="busy()"
            [attr.data-armed]="uninstallArmed() || null"
            (click)="uninstall()"
          >
            <ui-icon name="alert" [size]="15" />
            {{ (uninstallArmed() ? 'install.uninstall.confirmBtn' : 'install.uninstall') | t }}
          </button>
        </div>
        @if (uninstallArmed()) {
          <p class="refusal" role="alert">{{ 'install.uninstall.confirm' | t }}</p>
        }
      </aside>
    </div>

    @if (phase() === 'review' && planReceipt(); as r) {
      <section class="card plan" data-lift>
        <h2>{{ 'install.plan.review' | t }}</h2>
        <p class="muted">
          {{ 'install.plan.changes' | t: { count: r.actions?.length ?? 0 } }}
        </p>
        @if (r.actions?.length) {
          <ul class="actions">
            @for (a of r.actions; track $index) {
              <li>
                <code>{{ a.kind }}</code> <span>{{ a.path }}</span>
              </li>
            }
          </ul>
        }
        <div class="row">
          <button class="btn btn--primary" (click)="apply(r.plan ?? {}, r.plan_token!)">
            <ui-icon name="check" [size]="15" />
            {{ 'install.apply' | t }}
          </button>
          <button class="btn" (click)="reset()">{{ 'state.cancel' | t }}</button>
        </div>
      </section>
    }

    @if (phase() === 'running') {
      <section class="card running" role="status">
        <div class="running__spinner" aria-hidden="true"></div>
        <p class="muted">{{ 'install.running' | t }}</p>
      </section>
    }

    @if ((phase() === 'done' || phase() === 'refused') && result(); as r) {
      <section class="card receipt" data-lift>
        <h2>{{ 'install.receipt' | t }}</h2>
        <p class="receipt__status">
          <ui-state-badge [state]="r.status" />
          @if (r.detail) {
            <span>{{ r.detail }}</span>
          }
        </p>
        @if (r.refusal) {
          <p class="refusal">
            <code>{{ r.refusal }}</code>
            @if (r.unlock) {
              — {{ r.unlock }}
            }
          </p>
        }
        @if (r.actions?.length) {
          <ul class="actions">
            @for (a of r.actions; track $index) {
              <li>
                <code>{{ a.status }}</code> <span>{{ a.path }}</span>
              </li>
            }
          </ul>
        }
      </section>
    }

    @if (phase() === 'error') {
      <ui-error [error]="error()" (retry)="reset()" />
    }
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    .card h2 {
      margin: var(--space-3) 0;
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .card h2:first-child {
      margin-top: 0;
    }
    .status__row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    .status__row h2 {
      margin: 0;
    }
    .config-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
      gap: var(--space-4);
      align-items: start;
    }
    .summary {
      position: sticky;
      top: calc(var(--topbar-h) + var(--space-4));
    }
    .summary__kv {
      display: grid;
      gap: var(--space-2);
      margin: 0 0 var(--space-4);
    }
    .summary__kv > div {
      display: flex;
      justify-content: space-between;
      gap: var(--space-3);
      padding-bottom: var(--space-2);
      border-bottom: 1px solid var(--border);
      font-size: var(--font-sm);
    }
    .summary__kv > div:last-child {
      border-bottom: 0;
      flex-direction: column;
    }
    .summary__kv dt {
      color: var(--fg-muted);
    }
    .summary__kv dd {
      margin: 0;
      font-weight: 600;
      text-align: right;
    }
    .summary__kv > div:last-child dd {
      text-align: left;
      margin-top: var(--space-1);
    }
    .summary__comps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
    }
    .summary__chip {
      padding: 2px var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--accent-bg);
      color: var(--accent-strong);
      font-family: var(--font-mono);
      font-size: var(--font-xs);
      font-weight: 600;
    }
    .running {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .running p {
      margin: 0;
    }
    .running__spinner {
      width: 18px;
      height: 18px;
      flex: none;
      border-radius: 50%;
      border: 2px solid var(--accent-bg);
      border-top-color: var(--accent);
      animation: fg-spin 0.8s linear infinite;
    }
    @keyframes fg-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .running__spinner {
        animation: none;
        border-top-color: var(--border-strong);
      }
    }
    .receipt__status {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    @media (max-width: 880px) {
      .config-grid {
        grid-template-columns: 1fr;
      }
      .summary {
        position: static;
      }
    }
    .scopes {
      display: grid;
      gap: var(--space-2);
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    }
    .scope {
      display: flex;
      gap: var(--space-2);
      align-items: flex-start;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      cursor: pointer;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast),
        box-shadow var(--motion-fast);
    }
    .scope:hover {
      border-color: var(--border-strong);
      background: var(--bg-hover);
    }
    .scope:focus-within {
      border-color: var(--fg-focus);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg-focus) 22%, transparent);
    }
    .scope[data-active] {
      border-color: color-mix(in srgb, var(--accent) 55%, transparent);
      background: var(--accent-bg);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
    }
    .scope small {
      display: block;
      color: var(--fg-muted);
    }
    .scope input[type='radio'] {
      accent-color: var(--accent);
      margin-top: 2px;
    }
    .comps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .comp {
      display: flex;
      gap: 6px;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      padding: 4px var(--space-3);
      font-size: var(--font-sm);
      cursor: pointer;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast);
    }
    .comp:hover {
      border-color: var(--border-strong);
      background: var(--bg-hover);
    }
    .comp:focus-within {
      border-color: var(--fg-focus);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg-focus) 22%, transparent);
    }
    .comp input[type='checkbox'] {
      accent-color: var(--accent);
    }
    .comp[data-active] {
      border-color: color-mix(in srgb, var(--accent) 55%, transparent);
      background: var(--accent-bg);
      font-weight: 600;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-4);
    }
    .actions {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
    }
    .actions li code {
      color: var(--accent);
    }
    .refusal {
      color: var(--warn);
    }
    .muted {
      color: var(--fg-muted);
    }
    .btn--danger[data-armed] {
      background: var(--error);
      border-color: var(--error);
      color: var(--accent-fg);
    }
  `,
})
export class InstallPage {
  private readonly api = inject(PortalApi);
  private readonly i18n = inject(I18nService);
  readonly store = inject(PortalStore);

  readonly phase = signal<Phase>('idle');
  readonly uninstallArmed = signal(false);
  readonly scope = signal<'project' | 'workspace' | 'user'>('project');
  readonly host = signal<string>('all');
  readonly profile = signal<'minimal' | 'recommended' | 'full'>('recommended');
  readonly hostDetections = signal<HostDetection[]>([]);
  readonly selected = signal<Set<string>>(new Set(['skills', 'agents', 'mcp']));
  readonly planReceipt = signal<InstallationReceipt | null>(null);
  readonly result = signal<InstallationReceipt | null>(null);
  readonly error = signal<ApiError | null>(null);

  readonly busy = () => ['planning', 'running'].includes(this.phase());

  readonly stepKeys = [
    'install.step.configure',
    'install.step.plan',
    'install.step.review',
    'install.step.done',
  ];

  stepIndex(): number {
    switch (this.phase()) {
      case 'planning':
        return 1;
      case 'review':
        return 2;
      case 'running':
        return 3;
      case 'done':
      case 'refused':
      case 'error':
        return 4;
      default:
        return 0;
    }
  }

  stepState(i: number): 'done' | 'active' | 'warn' | 'todo' {
    const idx = this.stepIndex();
    if (i < idx || idx === 4) {
      if (idx === 4 && i === 3 && this.phase() !== 'done') return 'warn';
      return 'done';
    }
    return i === idx ? 'active' : 'todo';
  }

  scopeLabel(): string {
    return this.scopes.find((s) => s.id === this.scope())?.label ?? this.scope();
  }

  hostLabel(): string {
    const c = this.hostChoices.find((h) => h.id === this.host());
    return c?.labelKey ? this.i18n.t(c.labelKey) : (c?.label ?? this.host());
  }

  profileLabel(): string {
    return this.profiles.find((p) => p.id === this.profile())?.label ?? this.profile();
  }

  readonly hostChoices: { id: string; label?: string; labelKey?: string }[] = [
    { id: 'all', labelKey: 'install.host.all' },
    { id: 'claude', label: 'Claude' },
    { id: 'devin', label: 'Devin' },
    { id: 'codex', label: 'Codex' },
    { id: 'copilot', label: 'Copilot' },
  ];

  readonly profiles = [
    { id: 'minimal' as const, label: 'profiles.economy', hint: 'profiles.economy.desc' },
    { id: 'recommended' as const, label: 'profiles.balanced', hint: 'profiles.balanced.desc' },
    { id: 'full' as const, label: 'profiles.full', hint: 'profiles.full.desc' },
  ];

  constructor() {
    firstValueFrom(this.api.hosts())
      .then((hs) => this.hostDetections.set(hs))
      .catch(() => this.hostDetections.set([]));
  }

  hostState(id: string): string {
    if (id === 'all') return '—';
    const d = this.hostDetections().find((h) => h.host === id);
    if (!d) return '…';
    return d.detected ? d.integration : this.i18n.t('install.host.notDetected');
  }

  readonly scopes = [
    { id: 'project' as const, label: 'install.scope.project', hint: 'install.scope.project.hint' },
    {
      id: 'workspace' as const,
      label: 'install.scope.workspace',
      hint: 'install.scope.workspace.hint',
    },
    { id: 'user' as const, label: 'install.scope.user', hint: 'install.scope.user.hint' },
  ];

  readonly components = [{ id: 'skills' }, { id: 'agents' }, { id: 'mcp' }, { id: 'docs' }];

  toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  async plan(): Promise<void> {
    this.phase.set('planning');
    this.error.set(null);
    try {
      const r = await firstValueFrom(
        this.api.installationPlan({
          scope: this.scope(),
          host: this.host(),
          profile: this.profile(),
          components: Object.fromEntries([...this.selected()].map((c) => [c, true])),
        }),
      );
      if (r.refusal) {
        this.result.set(r);
        this.phase.set('refused');
        return;
      }
      this.planReceipt.set(r);
      this.phase.set('review');
    } catch (e) {
      this.fail(e);
    }
  }

  async apply(plan: Record<string, unknown>, planToken: string): Promise<void> {
    this.phase.set('running');
    try {
      const r = await firstValueFrom(this.api.installationApply(plan, planToken));
      this.result.set(r);
      this.phase.set(r.refusal ? 'refused' : 'done');
      await this.store.refreshHealth();
    } catch (e) {
      this.fail(e);
    }
  }

  async repair(): Promise<void> {
    this.phase.set('running');
    try {
      const r = await firstValueFrom(this.api.installationRepair());
      this.result.set(r);
      this.phase.set(r.refusal ? 'refused' : 'done');
      await this.store.refreshHealth();
    } catch (e) {
      this.fail(e);
    }
  }

  async uninstall(): Promise<void> {
    // destructive — exige um segundo clique explícito (a própria ética
    // plan→confirm→apply do portal, aplicada à UI)
    if (!this.uninstallArmed()) {
      this.uninstallArmed.set(true);
      setTimeout(() => this.uninstallArmed.set(false), 8000);
      return;
    }
    this.uninstallArmed.set(false);
    this.phase.set('running');
    try {
      const r = await firstValueFrom(this.api.installationUninstall());
      this.result.set(r);
      this.phase.set(r.refusal ? 'refused' : 'done');
      await this.store.refreshHealth();
    } catch (e) {
      this.fail(e);
    }
  }

  async reload(): Promise<void> {
    await this.store.refreshHealth();
  }

  reset(): void {
    this.phase.set('idle');
    this.uninstallArmed.set(false);
    this.planReceipt.set(null);
    this.result.set(null);
    this.error.set(null);
  }

  private fail(e: unknown): void {
    this.error.set(e instanceof ApiError ? e : new ApiError(0));
    this.phase.set('error');
  }
}
