import { Component, input } from '@angular/core';

/** Empty state honesto — sem dados inventados, com ação opcional. */
@Component({
  selector: 'ui-empty',
  standalone: true,
  template: `
    <div class="empty" role="note">
      <div class="empty__glyph" aria-hidden="true">{{ glyph() }}</div>
      <p class="empty__title">{{ title() }}</p>
      @if (hint()) {
        <p class="empty__hint">{{ hint() }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: `
    .empty {
      display: grid;
      place-items: center;
      gap: 6px;
      padding: var(--space-8) var(--space-6);
      border: 1px dashed var(--border);
      border-radius: var(--radius-lg);
      color: var(--fg-muted);
      text-align: center;
    }
    .empty__glyph {
      font-size: 28px;
      opacity: 0.7;
    }
    .empty__title {
      font-weight: 600;
      color: var(--fg);
      margin: 0;
    }
    .empty__hint {
      font-size: var(--font-sm);
      margin: 0;
      max-width: 46ch;
    }
  `,
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly hint = input<string | null>(null);
  readonly glyph = input('◌');
}
