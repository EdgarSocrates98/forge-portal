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

@Component({
  selector: 'page-knowledge',
  standalone: true,
  imports: [FormsModule, TPipe, PageHeader, EmptyState, ErrorState],
  template: `
    <ui-page-header [title]="'knowledge.title' | t" [subtitle]="'knowledge.subtitle' | t" />

    <section class="card">
      <label class="lbl" for="q">{{ 'knowledge.search' | t }}</label>
      <div class="row">
        <input
          id="q"
          class="input"
          type="search"
          [placeholder]="'knowledge.placeholder' | t"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
          (keydown.enter)="search()"
        />
        <button class="btn btn--primary" [disabled]="busy() || !query().trim()" (click)="search()">
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
        <article class="card hit">
          <h2>{{ h.title }}</h2>
          <p class="muted">{{ h.excerpt }}</p>
          <footer>
            <code>{{ h.path }}</code>
            <span class="cat">{{ h.category }}</span>
          </footer>
        </article>
      } @empty {
        <ui-empty [title]="'knowledge.empty' | t" />
      }
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
    .lbl {
      display: block;
      font-weight: 600;
      margin-bottom: var(--space-2);
    }
    .row {
      display: flex;
      gap: var(--space-2);
    }
    .row .input {
      flex: 1;
    }
    .hit h2 {
      margin: 0 0 6px;
      font-size: var(--font-lg);
    }
    .hit footer {
      display: flex;
      justify-content: space-between;
      margin-top: var(--space-3);
      font-size: var(--font-xs);
    }
    .hit code {
      color: var(--fg-muted);
    }
    .cat {
      color: var(--accent);
      font-weight: 600;
    }
    .muted {
      color: var(--fg-muted);
    }
    .btn--primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-fg);
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
