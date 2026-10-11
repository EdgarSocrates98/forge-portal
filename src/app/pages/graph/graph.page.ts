import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { GraphBundle } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';

@Component({
  selector: 'page-graph',
  standalone: true,
  imports: [TPipe, PageHeader, EmptyState, ErrorState, UiIcon],
  template: `
    <ui-page-header [title]="'graph.title' | t" [subtitle]="'graph.subtitle' | t">
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div class="skeleton skeleton--block"></div>
    }

    @if (bundle(); as b) {
      @if (b.availability.state === 'available') {
        <section class="card">
          @if (b.studio_url) {
            <a class="btn btn--primary" [href]="b.studio_url" target="_blank" rel="noopener">
              {{ 'graph.open' | t }}
              <ui-icon name="external" [size]="14" />
            </a>
          }
          <ul class="views">
            @for (v of b.views; track $index) {
              <li>
                <strong><ui-icon name="graph" [size]="14" />{{ viewName(v) }}</strong>
                <span class="muted">
                  {{ 'graph.nodes' | t: { count: viewNodes(v) } }} ·
                  {{ 'graph.edges' | t: { count: viewEdges(v) } }}
                </span>
              </li>
            }
          </ul>
        </section>
      } @else {
        <ui-empty
          [title]="'graph.unavailable' | t"
          [hint]="b.availability.unlock ?? ('graph.buildHint' | t)"
        />
      }
    }
  `,
  styles: `
    .views {
      list-style: none;
      padding: 0;
      margin: var(--space-4) 0 0;
      display: grid;
    }
    .views li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      transition: background var(--motion-fast);
    }
    .views li + li {
      border-top: 1px solid var(--border);
    }
    .views li:hover {
      background: var(--bg-hover);
    }
    .views strong {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      font-weight: 600;
    }
    .views strong ui-icon {
      color: var(--accent);
    }
    .muted {
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
  `,
})
export class GraphPage {
  private readonly api = inject(PortalApi);
  readonly bundle = signal<GraphBundle | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly loading = signal(true);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.bundle.set(await firstValueFrom(this.api.graphs()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  viewName(v: Record<string, unknown>): string {
    return String(v['view'] ?? v['name'] ?? 'view');
  }
  viewNodes(v: Record<string, unknown>): number {
    const n = v['nodes'];
    return Array.isArray(n) ? n.length : Number(v['node_count'] ?? 0);
  }
  viewEdges(v: Record<string, unknown>): number {
    const e = v['edges'];
    return Array.isArray(e) ? e.length : Number(v['edge_count'] ?? 0);
  }
}
