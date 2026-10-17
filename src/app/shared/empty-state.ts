import { Component, input } from '@angular/core';
import { UiIcon } from './icon';

/** Empty state honesto — sem dados inventados, com ação opcional. */
@Component({
  selector: 'ui-empty',
  standalone: true,
  imports: [UiIcon],
  template: `
    <div class="empty" role="note">
      <div class="empty__glyph" aria-hidden="true">
        <ui-icon [name]="icon()" [size]="22" />
      </div>
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
      gap: var(--space-2);
      padding: var(--space-8) var(--space-6);
      border: 1px dashed var(--border);
      border-radius: var(--radius-lg);
      color: var(--fg-muted);
      text-align: center;
      background: color-mix(in srgb, var(--bg-hover) 45%, transparent);
    }
    .empty__glyph {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      margin-bottom: var(--space-1);
      color: var(--accent-ink);
      background: var(--accent-bg);
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
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
  /** Nome do ícone do set `ui-icon` (contexto da página). */
  readonly icon = input('inbox');
}
