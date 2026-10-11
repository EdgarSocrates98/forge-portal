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

@Component({
  selector: 'page-agents',
  standalone: true,
  imports: [FormsModule, TPipe, PageHeader, StateBadge, EmptyState, ErrorState],
  template: `
    <ui-page-header [title]="'agents.title' | t" [subtitle]="'agents.subtitle' | t" />

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (agents().length) {
      <input
        class="input search"
        type="search"
        [placeholder]="'agents.search' | t"
        [ngModel]="query()"
        (ngModelChange)="query.set($event)"
        aria-label="search agents"
      />
      <section class="grid">
        @for (a of filtered(); track a.id) {
          <article class="card">
            <header class="head">
              <h2>{{ a.id }}</h2>
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
          <ui-empty [title]="'agents.empty' | t" />
        }
      </section>
    } @else if (!error()) {
      <ui-empty [title]="'agents.none' | t" />
    }
  `,
  styles: `
    .search {
      max-width: 360px;
      margin-bottom: var(--space-4);
    }
    .grid {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      padding: var(--space-5);
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
    try {
      this.agents.set(await firstValueFrom(this.api.agents()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }
}
