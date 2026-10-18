import { Component, input } from '@angular/core';
import { UiGuideHint } from './guide-hint';

@Component({
  selector: 'ui-page-header',
  standalone: true,
  imports: [UiGuideHint],
  template: `
    <div class="phw">
      <header class="ph">
        <div class="ph__text">
          <h1 class="ph__title">{{ title() }}</h1>
          @if (subtitle()) {
            <p class="ph__sub">{{ subtitle() }}</p>
          }
        </div>
        <div class="ph__actions"><ng-content /></div>
      </header>
      @if (hintId(); as h) {
        <ui-guide-hint [hintId]="h" />
      }
    </div>
  `,
  styles: `
    .phw {
      margin-bottom: var(--space-6);
    }
    .ph {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-4);
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
  /** Cycle 5 §8.1 — optional concept id that renders a dismissible
   *  `ui-guide-hint` under the header; absent input renders nothing. */
  readonly hintId = input<string | null>(null);
}
