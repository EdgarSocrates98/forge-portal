import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { AgentDescriptor } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';

@Component({
  selector: 'page-agents',
  standalone: true,
  imports: [FormsModule, TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon],
  template: `
    <ui-page-header [title]="'agents.title' | t" [subtitle]="'agents.subtitle' | t" />

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <section class="grid">
        @for (i of [1, 2, 3]; track i) {
          <div class="skeleton skeleton--block"></div>
        }
      </section>
    }

    @if (agents().length) {
      <div class="search-field">
        <ui-icon name="search" [size]="15" />
        <input
          class="input"
          type="search"
          [placeholder]="'agents.search' | t"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
          [attr.aria-label]="'agents.search' | t"
        />
      </div>
      <section class="grid">
        @for (a of filtered(); track a.id) {
          <article class="card" data-lift>
            <header class="head">
              <h2><ui-icon name="agents" [size]="15" />{{ a.id }}</h2>
              <ui-state-badge
                [state]="a.state === 'available' ? 'supported' : 'unverified'"
                [labelOverride]="a.state"
              />
            </header>
            <p class="role">{{ a.role }}</p>
            <p class="muted">{{ a.description }}</p>
            @if (a.domains.length) {
              <p class="tags">
                <span>{{ 'agents.domains' | t }}:</span> {{ a.domains.join(', ') }}
              </p>
            }
            @if (a.skills.length) {
              <p class="tags">
                <span>{{ 'agents.skills' | t }}:</span> {{ a.skills.join(', ') }}
              </p>
            }
            @if (a.authority) {
              <p class="tags">
                <span>{{ 'agents.authority' | t }}:</span> {{ a.authority }}
              </p>
            }
          </article>
        } @empty {
          @if (!loading()) {
            <ui-empty icon="agents" [title]="'agents.empty' | t" />
          }
        }
      </section>
    } @else if (!error() && !loading()) {
      <ui-empty icon="agents" [title]="'agents.none' | t" />
    }
  `,
  styles: `
    .grid {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
    }
    h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    h2 ui-icon {
      color: var(--accent);
    }
    .role {
      color: var(--accent);
      font-size: var(--font-sm);
      margin: 4px 0;
    }
    .muted {
      color: var(--fg-muted);
      margin: 0;
    }
    .tags {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      margin: 4px 0 0;
    }
    .tags span {
      font-weight: 600;
    }
  `,
})
export class AgentsPage {
  private readonly api = inject(PortalApi);
  readonly agents = signal<AgentDescriptor[]>([]);
  readonly error = signal<ApiError | null>(null);
  readonly query = signal('');
  readonly loading = signal(true);

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.agents();
    return this.agents().filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.role.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.domains.some((d) => d.toLowerCase().includes(q)),
    );
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.agents.set(await firstValueFrom(this.api.agents()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }
}
