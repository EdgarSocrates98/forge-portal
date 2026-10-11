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

    <section class="card">
      <h2>{{ 'install.status' | t }}</h2>
      @if (store.health(); as h) {
        <ui-state-badge [state]="h.state" />
      }
    </section>

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
          <label class="comp">
            <input type="checkbox" [checked]="selected().has(c.id)" (change)="toggle(c.id)" />
            <span>{{ c.id }}</span>
          </label>
        }
      </div>

      <div class="row">
        <button class="btn btn--primary" [disabled]="busy()" (click)="plan()">
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
    </section>

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
      <section class="card running">
        <div class="skeleton skeleton--line"></div>
        <p class="muted">{{ 'install.running' | t }}</p>
      </section>
    }

    @if ((phase() === 'done' || phase() === 'refused') && result(); as r) {
      <section class="card" data-lift>
        <h2>{{ 'install.receipt' | t }}</h2>
        <p>
          <strong>{{ r.status }}</strong>
          @if (r.detail) {
            — {{ r.detail }}
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
