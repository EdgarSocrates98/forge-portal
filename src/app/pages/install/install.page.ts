import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { HostDetection, InstallationReceipt } from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { ErrorState } from '../../shared/error-state';

type Phase = 'idle' | 'planning' | 'review' | 'running' | 'done' | 'refused' | 'error';

/**
 * Instalação — o mesmo Plan → Review → Confirm → Execute → Receipt do
 * CLI. O plano vem do servidor; nada é executado sem revisão explícita.
 */
@Component({
  selector: 'page-install',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, ErrorState],
  template: `
    <ui-page-header [title]="'install.title' | t" [subtitle]="'install.subtitle' | t">
      <button class="btn" (click)="reload()">{{ 'state.refresh' | t }}</button>
    </ui-page-header>

    <section class="card">
      <h2>{{ 'install.status' | t }}</h2>
      @if (store.health(); as h) {
        <ui-state-badge [state]="h.state" />
      }
    </section>

    <section class="card">
      <h2>{{ 'install.scope' | t }}</h2>
      <div class="scopes" role="radiogroup">
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
      <div class="scopes" role="radiogroup">
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
              <strong>{{ h.label }}</strong>
              <small>{{ hostState(h.id) }}</small>
            </span>
          </label>
        }
      </div>

      <h2>{{ 'install.profile' | t }}</h2>
      <div class="scopes" role="radiogroup">
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
          {{ 'install.plan' | t }}
        </button>
        <button class="btn" [disabled]="busy()" (click)="repair()">
          {{ 'install.repair' | t }}
        </button>
        <button class="btn btn--danger" [disabled]="busy()" (click)="uninstall()">
          {{ 'install.uninstall' | t }}
        </button>
      </div>
    </section>

    @if (phase() === 'review' && planReceipt(); as r) {
      <section class="card plan">
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
            {{ 'install.apply' | t }}
          </button>
          <button class="btn" (click)="reset()">{{ 'state.cancel' | t }}</button>
        </div>
      </section>
    }

    @if (phase() === 'running') {
      <p class="muted">{{ 'install.running' | t }}</p>
    }

    @if ((phase() === 'done' || phase() === 'refused') && result(); as r) {
      <section class="card">
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
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      padding: var(--space-5);
      margin-bottom: var(--space-4);
    }
    .card h2 {
      margin: var(--space-3) 0;
      font-size: var(--font-lg);
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
    }
    .scope[data-active] {
      border-color: var(--accent);
      background: var(--accent-bg);
    }
    .scope small {
      display: block;
      color: var(--fg-muted);
    }
    .comps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    .comp {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .row {
      display: flex;
      gap: var(--space-2);
      margin-top: var(--space-4);
    }
    .actions {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
    }
    .refusal {
      color: var(--warn);
    }
    .muted {
      color: var(--fg-muted);
    }
    .btn--primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-fg);
    }
    .btn--danger {
      border-color: var(--error);
      color: var(--error);
    }
  `,
})
export class InstallPage {
  private readonly api = inject(PortalApi);
  readonly store = inject(PortalStore);

  readonly phase = signal<Phase>('idle');
  readonly scope = signal<'project' | 'workspace' | 'user'>('project');
  readonly host = signal<string>('all');
  readonly profile = signal<'minimal' | 'recommended' | 'full'>('recommended');
  readonly hostDetections = signal<HostDetection[]>([]);
  readonly selected = signal<Set<string>>(new Set(['skills', 'agents', 'mcp']));
  readonly planReceipt = signal<InstallationReceipt | null>(null);
  readonly result = signal<InstallationReceipt | null>(null);
  readonly error = signal<ApiError | null>(null);

  readonly busy = () => ['planning', 'running'].includes(this.phase());

  readonly hostChoices = [
    { id: 'all', label: 'all' },
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
    return d.detected ? d.integration : 'not detected';
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
    this.planReceipt.set(null);
    this.result.set(null);
    this.error.set(null);
  }

  private fail(e: unknown): void {
    this.error.set(e instanceof ApiError ? e : new ApiError(0));
    this.phase.set('error');
  }
}
