import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { DocHit } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';

@Component({
  selector: 'page-knowledge',
  standalone: true,
  imports: [FormsModule, TPipe, PageHeader, EmptyState, ErrorState, UiIcon],
  template: `
    <ui-page-header [title]="'knowledge.title' | t" [subtitle]="'knowledge.subtitle' | t" />

    <section class="card">
      <label class="lbl" for="q">{{ 'knowledge.search' | t }}</label>
      <div class="row">
        <div class="search-field q-field">
          <ui-icon name="search" [size]="15" />
          <input
            id="q"
            class="input"
            type="search"
            [placeholder]="'knowledge.placeholder' | t"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
            (keydown.enter)="search()"
          />
        </div>
        <button class="btn btn--primary" [disabled]="busy() || !query().trim()" (click)="search()">
          <ui-icon name="search" [size]="14" />
          {{ 'knowledge.search' | t }}
        </button>
      </div>
    </section>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="search()" />
    }

    @if (searched()) {
      <p class="muted">{{ 'knowledge.results' | t: { count: hits().length } }}</p>
      @for (h of hits(); track h.path) {
        <article class="card hit" data-lift>
          <h2>{{ h.title }}</h2>
          <p class="muted">{{ h.excerpt }}</p>
          <footer>
            <code>{{ h.path }}</code>
            <span class="cat">{{ h.category }}</span>
          </footer>
        </article>
      } @empty {
        <ui-empty icon="knowledge" [title]="'knowledge.empty' | t" />
      }
    }
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    .lbl {
      display: block;
      font-weight: 600;
      margin-bottom: var(--space-2);
    }
    .row {
      display: flex;
      gap: var(--space-2);
    }
    .q-field {
      flex: 1;
      max-width: none;
      margin-bottom: 0;
    }
    .hit h2 {
      margin: 0 0 6px;
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .hit footer {
      display: flex;
      justify-content: space-between;
      gap: var(--space-2);
      margin-top: var(--space-3);
      font-size: var(--font-xs);
    }
    .hit code {
      color: var(--fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cat {
      color: var(--accent);
      font-weight: 600;
      flex-shrink: 0;
      background: var(--accent-bg);
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
      border-radius: var(--radius-pill);
      padding: 1px var(--space-2);
    }
    .muted {
      color: var(--fg-muted);
    }
  `,
})
export class KnowledgePage {
  private readonly api = inject(PortalApi);
  readonly query = signal('');
  readonly hits = signal<DocHit[]>([]);
  readonly searched = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal(false);

  async search(): Promise<void> {
    if (!this.query().trim()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.hits.set(await firstValueFrom(this.api.docsSearch(this.query())));
      this.searched.set(true);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }
}
