import { Component, computed, input, output } from '@angular/core';
import { TPipe } from '../core/i18n/i18n.pipe';

/**
 * Pagination primitive for long recorded surfaces (Cycle 4 §7).
 *
 * Chosen over scroll-window virtualization on purpose: a pager keeps
 * EVERY row keyboard- and AT-reachable (unrendered rows in a virtual
 * scroll would leave tab order and the a11y tree), the math is a pure
 * function, and the "X–Y of N" range makes the bounded view honest —
 * a sliced list is never mistaken for the whole buffer.
 *
 * `pageSlice` clamps the requested page into range instead of throwing:
 * a stale page number after the data shrinks resolves to the last
 * valid page, never to an empty-looking render.
 */
export interface PageSlice {
  /** Clamped page index actually rendered. */
  page: number;
  /** Total pages at this size — always >= 1. */
  pages: number;
  /** First item index rendered (0-based). */
  start: number;
  /** Exclusive end index rendered. */
  end: number;
  /** Item count across all pages. */
  total: number;
}

export function pageSlice(total: number, pageSize: number, requested: number): PageSlice {
  const size = Math.max(1, Math.floor(pageSize));
  const n = Math.max(0, total);
  const pages = Math.max(1, Math.ceil(n / size));
  const page = Math.min(Math.max(0, Math.floor(requested)), pages - 1);
  const start = Math.min(page * size, n);
  return { page, pages, start, end: Math.min(start + size, n), total: n };
}

@Component({
  selector: 'ui-pager',
  standalone: true,
  imports: [TPipe],
  template: `
    @if (slice().pages > 1) {
      <nav class="pager" [attr.aria-label]="label() || ('pager.label' | t)">
        <button
          class="btn btn--mini"
          data-page="prev"
          [disabled]="slice().page <= 0"
          (click)="go(slice().page - 1)"
        >
          {{ 'pager.prev' | t }}
        </button>
        <span class="muted pager__range" data-page="range">
          {{
            'pager.range' | t: { from: slice().start + 1, to: slice().end, total: slice().total }
          }}
        </span>
        <button
          class="btn btn--mini"
          data-page="next"
          [disabled]="slice().page >= slice().pages - 1"
          (click)="go(slice().page + 1)"
        >
          {{ 'pager.next' | t }}
        </button>
      </nav>
    }
  `,
  styles: `
    .pager {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--space-2);
      margin: var(--space-2) 0 0;
    }
    .pager__range {
      font-size: var(--font-xs);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
})
export class UiPager {
  /** Item count across all pages — drives the honest range text. */
  readonly total = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly page = input.required<number>();
  /** aria-label of the nav landmark — defaults to the generic key. */
  readonly label = input<string | null>(null);
  readonly pageChange = output<number>();

  readonly slice = computed(() => pageSlice(this.total(), this.pageSize(), this.page()));

  go(page: number): void {
    this.pageChange.emit(page);
  }
}
