import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { UiIcon } from '../../shared/icon';

@Component({
  selector: 'page-dashboard',
  standalone: true,
  imports: [RouterLink, TPipe, StateBadge, EmptyState, UiIcon],
  template: `
    @if (store.status() === 'booting') {
      <div class="hero hero--skeleton">
        <div class="skeleton skeleton--line" style="width: 40%"></div>
        <div class="skeleton skeleton--line" style="width: 60%"></div>
      </div>
      <div class="stats">
        @for (i of [1, 2, 3, 4]; track i) {
          <div class="skeleton skeleton--block"></div>
        }
      </div>
    } @else {
      <section class="hero">
        <div class="hero__text">
          <div class="hero__eyebrow">
            <span class="hero__forge">{{ store.forgeName() }}</span>
            @if (descriptor()?.forge_version) {
              <code class="hero__ver">v{{ descriptor()!.forge_version }}</code>
            }
            @if (store.federated()) {
              <span class="hero__fed">{{ 'settings.federated' | t }}</span>
            }
          </div>
          <h1 class="hero__title">{{ 'dashboard.title' | t }}</h1>
          <p class="hero__sub">{{ 'dashboard.subtitle' | t }}</p>
          <div class="hero__meta">
            @if (health(); as h) {
              <ui-state-badge [state]="h.state" />
            }
            @if (store.workspace()?.name; as ws) {
              <span class="hero__ws"><ui-icon name="folder" [size]="13" />{{ ws }}</span>
            }
          </div>
        </div>
        <button class="btn btn--ghost-inverse" (click)="store.refreshHealth()">
          <ui-icon name="refresh" [size]="14" />
          {{ 'state.refresh' | t }}
        </button>
      </section>

      <section class="stats stagger">
        <div class="stat" [style.--stat-rail]="'var(--accent)'">
          <span class="stat__value">
            @if (health(); as h) {
              <ui-state-badge [state]="h.state" />
            } @else {
              —
            }
          </span>
          <span class="stat__label">{{ 'dashboard.stat.state' | t }}</span>
        </div>
        <div class="stat" [style.--stat-rail]="'var(--ok)'">
          <span class="stat__value">{{ capsSupported() }}/{{ store.capabilities().length }}</span>
          <span class="stat__label">{{ 'dashboard.stat.capabilities' | t }}</span>
        </div>
        <div class="stat" [style.--stat-rail]="'var(--info)'">
          <span class="stat__value">{{ checksOk() }}/{{ health()?.checks?.length ?? 0 }}</span>
          <span class="stat__label">{{ 'dashboard.stat.checks' | t }}</span>
        </div>
        <div class="stat" [style.--stat-rail]="'var(--fg-muted)'">
          <span class="stat__value">{{ descriptor()?.portal_version ?? '—' }}</span>
          <span class="stat__label">{{ 'dashboard.stat.portal' | t }}</span>
        </div>
      </section>

      <section class="grid cards">
        <article class="card" data-lift>
          <h2>{{ 'dashboard.health' | t }}</h2>
          @if (health(); as h) {
            <dl class="kv">
              <div>
                <dt>{{ 'dashboard.workspace' | t }}</dt>
                <dd>{{ h.workspace ?? ('dashboard.noWorkspace' | t) }}</dd>
              </div>
              <div>
                <dt>{{ 'dashboard.profile' | t }}</dt>
                <dd>{{ h.profile ?? ('state.unknown' | t) }}</dd>
              </div>
            </dl>
            @if (h.checks.length) {
              <ul class="checks">
                @for (c of h.checks; track c.id) {
                  <li>
                    <ui-state-badge [state]="c.state" [labelOverride]="c.id" />
                    @if (c.detail) {
                      <small>{{ c.detail }}</small>
                    }
                  </li>
                }
              </ul>
            }
          } @else {
            <ui-empty [title]="'empty.noData' | t" [hint]="'empty.noData.hint' | t" />
          }
        </article>

        <article class="card" data-lift>
          <h2>{{ 'dashboard.quickStart' | t }}</h2>
          <p class="muted">{{ 'dashboard.quickStart.hint' | t }}</p>
          <ol class="steps">
            @for (step of steps(); track step.label) {
              <li [attr.data-done]="step.done || null">
                <span class="steps__mark" aria-hidden="true">
                  @if (step.done) {
                    <ui-icon name="check" [size]="12" />
                  } @else {
                    {{ $index + 1 }}
                  }
                </span>
                <a [routerLink]="step.route">{{ step.label | t }}</a>
              </li>
            }
          </ol>
        </article>
      </section>

      <section class="card" data-lift>
        <h2>{{ 'dashboard.capabilities' | t }}</h2>
        @if (store.capabilities().length) {
          <div class="caps">
            @for (cap of store.capabilities(); track cap.id) {
              <span class="cap" [attr.data-state]="cap.state" [title]="cap.state">
                <ui-icon [name]="capIcon(cap.id)" [size]="15" />
                <span class="cap__id">{{ cap.id }}</span>
                <i class="cap__dot" aria-hidden="true"></i>
              </span>
            }
          </div>
        } @else {
          <ui-empty icon="dashboard" [title]="'dashboard.none' | t" />
        }
      </section>
    }
  `,
  styles: `
    .hero {
      position: relative;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-4);
      padding: var(--space-6);
      border-radius: var(--radius-lg);
      background: var(--gradient);
      color: #fff;
      box-shadow: var(--elev-hover);
      overflow: hidden;
      margin-bottom: var(--space-5);
    }
    .hero::after {
      content: '';
      position: absolute;
      inset: 0;
      background:
        radial-gradient(400px 200px at 90% -40px, rgb(255 255 255 / 0.18), transparent 65%),
        radial-gradient(300px 180px at 10% 120%, rgb(0 0 0 / 0.12), transparent 70%);
      pointer-events: none;
    }
    .hero--skeleton {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      min-height: 148px;
      display: grid;
      align-content: center;
      gap: var(--space-2);
    }
    .hero__text {
      position: relative;
      z-index: 1;
    }
    .hero__eyebrow {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: 6px;
    }
    .hero__forge {
      font-size: var(--font-xs);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.85;
    }
    .hero__ver {
      font-size: var(--font-xs);
      font-weight: 600;
      background: rgb(255 255 255 / 0.18);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .hero__fed {
      font-size: var(--font-xs);
      font-weight: 700;
      background: rgb(0 0 0 / 0.22);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .hero__title {
      font-size: 1.625rem;
      font-weight: 750;
      letter-spacing: -0.02em;
    }
    .hero__sub {
      margin-top: 4px;
      opacity: 0.85;
      max-width: 56ch;
      font-size: var(--font-sm);
    }
    .hero__meta {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      margin-top: var(--space-4);
    }
    .hero__ws {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: var(--font-sm);
      font-weight: 600;
      opacity: 0.9;
    }
    .btn--ghost-inverse {
      position: relative;
      z-index: 1;
      background: rgb(255 255 255 / 0.14);
      border-color: rgb(255 255 255 / 0.35);
      color: #fff;
      backdrop-filter: blur(4px);
    }
    .btn--ghost-inverse:hover {
      background: rgb(255 255 255 / 0.24);
      border-color: rgb(255 255 255 / 0.6);
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-5);
    }

    .grid {
      display: grid;
      gap: var(--space-4);
    }
    .cards {
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      margin-bottom: var(--space-4);
    }
    .card h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .kv {
      display: grid;
      gap: 6px;
      margin: var(--space-3) 0;
    }
    .kv div {
      display: flex;
      gap: var(--space-2);
    }
    .kv dt {
      color: var(--fg-muted);
      min-width: 110px;
    }
    .kv dd {
      margin: 0;
    }
    .checks {
      list-style: none;
      padding: 0;
      margin: var(--space-3) 0 0;
      display: grid;
      gap: 6px;
    }
    .checks li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .checks small {
      color: var(--fg-muted);
    }
    .steps {
      list-style: none;
      margin: var(--space-3) 0 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    .steps li {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: 8px var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast);
    }
    .steps li:hover {
      border-color: var(--border-strong);
      background: var(--bg-hover);
    }
    .steps__mark {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent);
      background: var(--accent-bg);
      flex-shrink: 0;
    }
    .steps li[data-done] {
      border-color: color-mix(in srgb, var(--ok) 40%, transparent);
    }
    .steps li[data-done] .steps__mark {
      color: var(--ok);
      background: var(--ok-bg);
      animation: fg-pop var(--fg-motion-med) var(--fg-ease-out) both;
    }
    @media (prefers-reduced-motion: reduce) {
      .steps li[data-done] .steps__mark {
        animation: none;
      }
    }
    .steps a {
      color: var(--fg);
      font-weight: 550;
      text-decoration: none;
    }
    .steps a:hover {
      text-decoration: underline;
    }
    .caps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .muted {
      color: var(--fg-muted);
    }
  `,
})
export class DashboardPage {
  readonly store = inject(PortalStore);
  readonly health = computed(() => this.store.health());
  readonly descriptor = computed(() => this.store.descriptor());

  readonly capsSupported = computed(
    () => this.store.capabilities().filter((c) => c.state === 'supported').length,
  );
  readonly checksOk = computed(
    () => (this.store.health()?.checks ?? []).filter((c) => c.state === 'PASS').length,
  );

  private readonly capIcons: Record<string, string> = {
    tasks: 'tasks',
    graph: 'graph',
    mcp: 'mcp',
    skills: 'skills',
    agents: 'agents',
    knowledge: 'knowledge',
    hosts: 'hosts',
    install: 'install',
    profiles: 'profiles',
    scan: 'search',
    analyze: 'search',
    docs: 'knowledge',
  };

  capIcon(id: string): string {
    return this.capIcons[id] ?? 'check';
  }

  readonly steps = computed(() => {
    const state = this.store.health()?.state ?? 'NOT_INSTALLED';
    const installed = !['NOT_INSTALLED', 'FAILED'].includes(state);
    const verified = ['VERIFIED', 'ACTIVE'].includes(state);
    return [
      { label: 'dashboard.step.install', route: '/install', done: installed },
      { label: 'dashboard.step.host', route: '/hosts', done: installed },
      { label: 'dashboard.step.mcp', route: '/mcp', done: verified },
      { label: 'dashboard.step.task', route: '/tasks', done: verified },
    ];
  });
}
