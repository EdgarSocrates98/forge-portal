import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';

@Component({
  selector: 'page-dashboard',
  standalone: true,
  imports: [RouterLink, TPipe, PageHeader, StateBadge, EmptyState],
  template: `
    <ui-page-header [title]="'dashboard.title' | t" [subtitle]="'dashboard.subtitle' | t">
      <button class="btn" (click)="store.refreshHealth()">
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (store.status() === 'booting') {
      <p class="muted">{{ 'state.loading' | t }}</p>
    } @else {
      <section class="grid cards">
        <article class="card">
          <h2>{{ 'dashboard.health' | t }}</h2>
          @if (health(); as h) {
            <ui-state-badge [state]="h.state" />
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

        <article class="card">
          <h2>{{ 'dashboard.quickStart' | t }}</h2>
          <p class="muted">{{ 'dashboard.quickStart.hint' | t }}</p>
          <ol class="steps">
            @for (step of steps(); track step.label) {
              <li [attr.data-done]="step.done || null">
                <a [routerLink]="step.route">{{ step.label | t }}</a>
              </li>
            }
          </ol>
        </article>
      </section>

      <section class="card">
        <h2>{{ 'dashboard.capabilities' | t }}</h2>
        @if (store.capabilities().length) {
          <div class="caps">
            @for (cap of store.capabilities(); track cap.id) {
              <span class="cap">
                <ui-state-badge [state]="cap.state" [labelOverride]="cap.id" />
              </span>
            }
          </div>
        } @else {
          <ui-empty [title]="'dashboard.none' | t" />
        }
      </section>
    }
  `,
  styles: `
    .grid {
      display: grid;
      gap: var(--space-4);
    }
    .cards {
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      margin-bottom: var(--space-4);
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      padding: var(--space-5);
    }
    .card h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
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
      margin: 0;
      padding-left: 20px;
      display: grid;
      gap: 8px;
    }
    .steps a {
      color: var(--fg);
    }
    .steps li[data-done] a {
      color: var(--ok);
      text-decoration: line-through;
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
