import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  ComponentId,
  FederationPlanResponse,
  FederationSelection,
  FederationSnapshot,
  ExecutionProfile,
  InstallationReceipt,
} from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { ErrorState } from '../../shared/error-state';
import { UiSkeleton } from '../../shared/skeleton';
import { UiIcon } from '../../shared/icon';

type Phase = 'idle' | 'loading' | 'planning' | 'review' | 'running' | 'done' | 'error';
type Scope = FederationSelection['scope'];
type HostChoice = FederationSelection['host'];
type InstallProfile = FederationSelection['profile'];
type GatewayProfile = NonNullable<FederationSelection['gateway_profile']>;

@Component({
  selector: 'page-federation',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, ErrorState, UiSkeleton, UiIcon],
  template: `
    <ui-page-header [title]="'federation.title' | t" [subtitle]="'federation.subtitle' | t">
      <button class="btn" [disabled]="busy()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (phase() === 'loading' && !snapshot()) {
      <section class="card loading" role="status" aria-live="polite">
        <ui-skeleton kind="text" [lines]="2" />
        <ui-skeleton kind="card" />
      </section>
    } @else if (snapshot(); as data) {
      <section class="stats" aria-label="{{ 'federation.summary' | t }}">
        <div class="stat" [style.--stat-rail]="'var(--accent)'">
          <span class="stat__value">{{ data.summary.catalog }}</span>
          <span class="stat__label">{{ 'federation.catalog' | t }}</span>
        </div>
        <div class="stat" [style.--stat-rail]="'var(--ok)'">
          <span class="stat__value">{{ data.summary.installed }}</span>
          <span class="stat__label">{{ 'federation.installed' | t }}</span>
        </div>
        <div class="stat" [style.--stat-rail]="'var(--info)'">
          <span class="stat__value">{{ data.summary.with_mcp }}</span>
          <span class="stat__label">{{ 'federation.mcp' | t }}</span>
        </div>
        <div class="stat" [style.--stat-rail]="'var(--fg-muted)'">
          <span class="stat__value">{{ data.summary.with_checkout }}</span>
          <span class="stat__label">{{ 'federation.checkouts' | t }}</span>
        </div>
      </section>

      <div class="layout">
        <section class="card setup-card">
          <div class="card__heading">
            <div>
              <h2>{{ 'federation.setup.title' | t }}</h2>
              <p class="muted">{{ 'federation.setup.hint' | t }}</p>
            </div>
            <span class="eyebrow">{{ 'federation.governed' | t }}</span>
          </div>

          <h3>{{ 'install.scope' | t }}</h3>
          <div class="choices" role="radiogroup" [attr.aria-label]="'install.scope' | t">
            @for (item of scopes; track item.id) {
              <label class="choice" [attr.data-active]="scope() === item.id || null">
                <input
                  type="radio"
                  name="federation-scope"
                  [value]="item.id"
                  [checked]="scope() === item.id"
                  (change)="scope.set(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>

          <h3>{{ 'federation.host' | t }}</h3>
          <div class="choices" role="radiogroup" [attr.aria-label]="'federation.host' | t">
            @for (item of hosts; track item.id) {
              <label class="choice" [attr.data-active]="host() === item.id || null">
                <input
                  type="radio"
                  name="federation-host"
                  [value]="item.id"
                  [checked]="host() === item.id"
                  (change)="host.set(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>

          <h3>{{ 'federation.profile' | t }}</h3>
          <div class="choices" role="radiogroup" [attr.aria-label]="'federation.profile' | t">
            @for (item of profiles; track item.id) {
              <label class="choice" [attr.data-active]="profile() === item.id || null">
                <input
                  type="radio"
                  name="federation-profile"
                  [value]="item.id"
                  [checked]="profile() === item.id"
                  (change)="profile.set(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>

          <h3>{{ 'federation.executionProfile' | t }}</h3>
          <div
            class="choices"
            role="radiogroup"
            [attr.aria-label]="'federation.executionProfile' | t"
          >
            @for (item of gatewayProfiles; track item.id) {
              <label class="choice" [attr.data-active]="gatewayProfile() === item.id || null">
                <input
                  type="radio"
                  name="federation-execution-profile"
                  [value]="item.id"
                  [checked]="gatewayProfile() === item.id"
                  (change)="gatewayProfile.set(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>

          <h3>{{ 'federation.components' | t }}</h3>
          <div class="component-grid">
            @for (item of componentOptions; track item.id) {
              <label class="component" [attr.data-active]="selected().has(item.id) || null">
                <input
                  type="checkbox"
                  [checked]="selected().has(item.id)"
                  (change)="toggle(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>
          <div class="actions-row">
            <button class="btn btn--primary" [disabled]="busy()" (click)="plan()">
              <ui-icon name="install" [size]="15" />
              {{ 'federation.plan' | t }}
            </button>
            <span class="muted">{{ 'federation.planHint' | t }}</span>
          </div>
        </section>

        <aside class="card specialist-card">
          <div class="card__heading">
            <div>
              <h2>{{ 'federation.specialists' | t }}</h2>
              <p class="muted">{{ 'federation.specialistsHint' | t }}</p>
            </div>
          </div>
          @if (data.specialists.length) {
            <ul class="specialists">
              @for (item of data.specialists; track item.provider) {
                <li class="specialist">
                  <div class="specialist__main">
                    <span class="specialist__mark" aria-hidden="true"
                      ><ui-icon name="check" [size]="13"
                    /></span>
                    <div>
                      <strong>{{ item.provider }}</strong
                      ><small>{{ item.cli || item.checkout || ('state.unknown' | t) }}</small>
                    </div>
                  </div>
                  <ui-state-badge [state]="item.state || item.status || 'unknown'" />
                  <div class="specialist__meta">
                    <span [attr.data-present]="item.mcp ? 'true' : null">{{
                      item.mcp ? ('federation.mcpReady' | t) : ('federation.mcpAbsent' | t)
                    }}</span>
                    @if (item.notes?.length) {
                      <small>{{ item.notes![0] }}</small>
                    }
                  </div>
                </li>
              }
            </ul>
          } @else {
            <p class="empty">{{ 'federation.empty' | t }}</p>
          }
          <p class="registry mono">{{ data.registry.path }}</p>
        </aside>
      </div>
    }

    @if (phase() === 'review' && planResult(); as planned) {
      <section class="card plan" data-lift>
        <div class="card__heading">
          <div>
            <h2>{{ 'federation.review' | t }}</h2>
            <p class="muted">{{ 'federation.reviewHint' | t }}</p>
          </div>
          <ui-state-badge [state]="planned.status" />
        </div>
        <dl class="review-grid">
          <div>
            <dt>{{ 'install.scope' | t }}</dt>
            <dd>{{ planned.plan['scope'] }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.host' | t }}</dt>
            <dd>{{ planned.plan['host'] }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.profile' | t }}</dt>
            <dd>{{ planned.plan['profile'] }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.executionProfile' | t }}</dt>
            <dd>{{ planned.plan['gateway_profile'] || ('state.unknown' | t) }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.actions' | t }}</dt>
            <dd>{{ planned.actions.length }}</dd>
          </div>
        </dl>
        @if (planned.actions.length) {
          <ul class="actions">
            @for (item of planned.actions; track $index) {
              <li>
                <code>{{ item.status }}</code
                ><span>{{ item.path }}</span>
              </li>
            }
          </ul>
        }
        <div class="actions-row">
          <button class="btn btn--primary" [disabled]="busy()" (click)="apply(planned)">
            <ui-icon name="check" [size]="15" />{{ 'federation.apply' | t }}
          </button>
          <button class="btn" [disabled]="busy()" (click)="reset()">
            {{ 'state.cancel' | t }}
          </button>
        </div>
      </section>
    }

    @if (phase() === 'running') {
      <section class="card running" role="status" aria-live="polite">
        <div class="running__spinner" aria-hidden="true"></div>
        {{ 'federation.running' | t }}
      </section>
    }
    @if (phase() === 'done' && result(); as receipt) {
      <section class="card receipt" data-lift>
        <h2>{{ 'federation.receipt' | t }}</h2>
        <p>
          <ui-state-badge [state]="receipt.status" />
          <span>{{ receipt.detail || ('federation.receiptHint' | t) }}</span>
        </p>
      </section>
    }
    @if (phase() === 'error') {
      <ui-error [error]="error()" (retry)="load()" />
    }
  `,
  styles: `
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-5);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.75fr);
      gap: var(--space-4);
      align-items: start;
    }
    .card {
      margin-bottom: var(--space-4);
    }
    .card__heading {
      display: flex;
      justify-content: space-between;
      gap: var(--space-4);
      align-items: flex-start;
    }
    .card h2 {
      margin: 0 0 var(--space-2);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .card h3 {
      margin: var(--space-5) 0 var(--space-2);
      font-size: var(--font-sm);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .card h3:first-of-type {
      margin-top: var(--space-4);
    }
    .muted {
      color: var(--fg-muted);
    }
    .eyebrow {
      color: var(--accent-ink);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 4px 9px;
      font-size: var(--font-xs);
      font-weight: 700;
      white-space: nowrap;
    }
    .choices {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: var(--space-2);
    }
    .choice,
    .component {
      display: flex;
      gap: var(--space-2);
      align-items: flex-start;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast);
    }
    .choice:hover,
    .component:hover,
    .choice[data-active],
    .component[data-active] {
      border-color: var(--accent-ink);
      background: var(--accent-bg);
    }
    .choice input,
    .component input {
      margin-top: 3px;
      accent-color: var(--accent-ink);
      flex: none;
    }
    .choice span,
    .component span {
      display: grid;
      gap: 3px;
    }
    .choice small,
    .component small {
      color: var(--fg-muted);
      line-height: 1.35;
    }
    .component-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: var(--space-2);
    }
    .actions-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      align-items: center;
      margin-top: var(--space-5);
    }
    .specialists {
      list-style: none;
      padding: 0;
      margin: var(--space-4) 0;
      display: grid;
      gap: var(--space-2);
    }
    .specialist {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 5px var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }
    .specialist__main {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      min-width: 0;
    }
    .specialist__main div {
      display: grid;
      min-width: 0;
    }
    .specialist__main small {
      color: var(--fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .specialist__mark {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      color: var(--ok);
      background: var(--ok-bg);
      flex: none;
    }
    .specialist__meta {
      grid-column: 1/-1;
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .specialist__meta [data-present] {
      color: var(--ok);
    }
    .specialist__meta small {
      width: 100%;
      overflow-wrap: anywhere;
    }
    .registry {
      border-top: 1px solid var(--border);
      padding-top: var(--space-3);
      color: var(--fg-muted);
      overflow-wrap: anywhere;
      font-size: var(--font-xs);
    }
    .review-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: var(--space-3);
      margin: var(--space-4) 0;
    }
    .review-grid div {
      display: grid;
      gap: 4px;
      padding: var(--space-3);
      background: var(--bg-sunken);
      border-radius: var(--radius-md);
    }
    .review-grid dt {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .review-grid dd {
      margin: 0;
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .actions {
      display: grid;
      gap: 6px;
      list-style: none;
      padding: 0;
      max-height: 240px;
      overflow: auto;
    }
    .actions li {
      display: flex;
      gap: var(--space-2);
      padding: 7px 0;
      border-bottom: 1px solid var(--border);
      overflow-wrap: anywhere;
    }
    .actions code {
      color: var(--accent-ink);
      flex: none;
    }
    .running,
    .loading {
      display: grid;
      gap: var(--space-3);
    }
    .running {
      place-items: center;
      min-height: 100px;
    }
    .receipt p {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .empty {
      color: var(--fg-muted);
      padding: var(--space-5) 0;
    }
    @media (max-width: 820px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 520px) {
      .choices,
      .component-grid {
        grid-template-columns: 1fr;
      }
      .card__heading {
        display: block;
      }
      .eyebrow {
        display: inline-block;
        margin-top: var(--space-3);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .choice,
      .component {
        transition: none;
      }
    }
  `,
})
export class FederationPage {
  private readonly api = inject(PortalApi);
  readonly store = inject(PortalStore);
  readonly snapshot = signal<FederationSnapshot | null>(null);
  readonly planResult = signal<FederationPlanResponse | null>(null);
  readonly result = signal<InstallationReceipt | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly phase = signal<Phase>('loading');
  readonly busy = signal(true);
  readonly scope = signal<Scope>('project');
  readonly host = signal<HostChoice>('all');
  readonly profile = signal<InstallProfile>('recommended');
  readonly gatewayProfile = signal<GatewayProfile>('balanced');
  readonly selected = signal<Set<ComponentId>>(
    new Set(['skills', 'agents', 'mcp', 'tui', 'graph-studio']),
  );

  readonly scopes = [
    { id: 'project' as const, label: 'install.scope.project', hint: 'install.scope.project.hint' },
    {
      id: 'workspace' as const,
      label: 'install.scope.workspace',
      hint: 'install.scope.workspace.hint',
    },
    { id: 'user' as const, label: 'install.scope.user', hint: 'install.scope.user.hint' },
  ];
  readonly hosts: { id: HostChoice; label: string; hint: string }[] = [
    { id: 'all', label: 'federation.host.all', hint: 'federation.host.allHint' },
    { id: 'none', label: 'federation.host.none', hint: 'federation.host.noneHint' },
    { id: 'claude', label: 'federation.host.claude', hint: 'federation.host.detected' },
    { id: 'devin', label: 'federation.host.devin', hint: 'federation.host.detected' },
    { id: 'codex', label: 'federation.host.codex', hint: 'federation.host.detected' },
    { id: 'copilot', label: 'federation.host.copilot', hint: 'federation.host.detected' },
  ];
  readonly profiles = [
    {
      id: 'minimal' as const,
      label: 'federation.profile.minimal',
      hint: 'federation.profile.minimalHint',
    },
    {
      id: 'recommended' as const,
      label: 'federation.profile.recommended',
      hint: 'federation.profile.recommendedHint',
    },
    { id: 'full' as const, label: 'federation.profile.full', hint: 'federation.profile.fullHint' },
  ];
  readonly gatewayProfiles: { id: GatewayProfile; label: string; hint: string }[] = [
    {
      id: 'economy',
      label: 'federation.execution.economy',
      hint: 'federation.execution.economyHint',
    },
    {
      id: 'balanced',
      label: 'federation.execution.balanced',
      hint: 'federation.execution.balancedHint',
    },
    { id: 'deep', label: 'federation.execution.deep', hint: 'federation.execution.deepHint' },
  ];
  readonly componentOptions: { id: ComponentId; label: string; hint: string }[] = [
    { id: 'skills', label: 'federation.component.skills', hint: 'federation.component.skillsHint' },
    { id: 'agents', label: 'federation.component.agents', hint: 'federation.component.agentsHint' },
    { id: 'mcp', label: 'federation.component.mcp', hint: 'federation.component.mcpHint' },
    { id: 'tui', label: 'federation.component.tui', hint: 'federation.component.tuiHint' },
    {
      id: 'graph-studio',
      label: 'federation.component.graph',
      hint: 'federation.component.graphHint',
    },
  ];

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.phase.set('loading');
    this.busy.set(true);
    this.error.set(null);
    try {
      this.snapshot.set(await firstValueFrom(this.api.federation()));
      this.phase.set('idle');
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  toggle(id: ComponentId): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  async plan(): Promise<void> {
    this.phase.set('planning');
    this.busy.set(true);
    this.error.set(null);
    try {
      const input: FederationSelection = {
        scope: this.scope(),
        host: this.host(),
        profile: this.profile(),
        gateway_profile: this.gatewayProfile(),
        components: Object.fromEntries([...this.selected()].map((id) => [id, true])),
      };
      this.planResult.set(await firstValueFrom(this.api.federationPlan(input)));
      this.phase.set('review');
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  async apply(planned: FederationPlanResponse): Promise<void> {
    this.phase.set('running');
    this.busy.set(true);
    this.error.set(null);
    try {
      this.result.set(
        await firstValueFrom(this.api.federationInstallAuto(planned.plan, planned.plan_token)),
      );
      await Promise.all([this.load(), this.store.refreshHealth()]);
      this.phase.set('done');
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  reset(): void {
    this.phase.set('idle');
    this.planResult.set(null);
    this.result.set(null);
    this.error.set(null);
  }

  private fail(e: unknown): void {
    this.error.set(e instanceof ApiError ? e : new ApiError(0));
    this.phase.set('error');
  }
}
