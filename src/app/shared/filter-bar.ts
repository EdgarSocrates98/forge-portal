import { Component, computed, inject, input, model } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { UiIcon } from './icon';

/**
 * Filter bar — the `search-field` pattern used by list pages (skills,
 * agents), lifted into a presentational component: a search input plus an
 * optional projected chip row.
 *
 *   <ui-filter-bar [(query)]="q" placeholder="skills.search">
 *     <button class="fg-pill" data-tone="accent">…</button>
 *   </ui-filter-bar>
 *
 * `placeholder` accepts an i18n key or a literal; `query` is two-way
 * bindable via `model()`. Projected chips are wrapped in a flex row that
 * disappears when empty.
 */
@Component({
  selector: 'ui-filter-bar',
  standalone: true,
  imports: [UiIcon],
  template: `
    <div class="fb">
      <div class="fb__search">
        <ui-icon name="search" [size]="15" />
        <input
          class="input fb__input"
          type="search"
          [value]="query()"
          (input)="onQuery($event)"
          [placeholder]="label()"
          [attr.aria-label]="label() || null"
        />
      </div>
      <div class="fb__chips"><ng-content /></div>
    </div>
  `,
  styles: `
    .fb {
      display: grid;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .fb__search {
      position: relative;
      max-width: 360px;
    }
    .fb__search ui-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      translate: 0 -50%;
      color: var(--fg-muted);
      pointer-events: none;
    }
    .fb__input {
      padding-left: 32px;
    }
    .fb__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .fb__chips:empty {
      display: none;
    }
  `,
})
export class UiFilterBar {
  private readonly i18n = inject(I18nService);
  /** i18n key or literal shown as placeholder + aria-label. */
  readonly placeholder = input('');
  readonly query = model('');

  /** Keys translate; literals (unknown to i18n) render verbatim. */
  protected readonly label = computed(() => {
    const raw = this.placeholder();
    if (!raw) return '';
    const translated = this.i18n.t(raw);
    return translated.startsWith('⟪') ? raw : translated;
  });

  protected onQuery(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
  }
}
