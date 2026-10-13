import { Component, input } from '@angular/core';

@Component({
  selector: 'ui-page-header',
  standalone: true,
  template: `
    <header class="ph">
      <div class="ph__text">
        <h1 class="ph__title">{{ title() }}</h1>
        @if (subtitle()) {
          <p class="ph__sub">{{ subtitle() }}</p>
        }
      </div>
      <div class="ph__actions"><ng-content /></div>
    </header>
  `,
  styles: `
    .ph {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-4);
      margin-bottom: var(--space-6);
    }
    .ph__title {
      margin: 0;
      font-size: var(--font-2xl);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .ph__sub {
      margin: 4px 0 0;
      color: var(--fg-muted);
      max-width: 68ch;
    }
    .ph__actions {
      display: flex;
      gap: var(--space-2);
      flex-shrink: 0;
    }
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
}
