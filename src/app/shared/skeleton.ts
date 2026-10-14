import { Component, computed, input } from '@angular/core';

export type SkeletonKind = 'text' | 'card' | 'row' | 'avatar';

/**
 * Loading placeholder — static blocks, no shimmer, so it is inherently
 * safe under prefers-reduced-motion. Purely decorative: the host carries
 * `aria-hidden="true"` and callers announce the loading state themselves
 * in their own aria-live region.
 *
 *   <ui-skeleton kind="text" [lines]="3" />
 *
 * `lines` is the repeat count of the chosen unit: text lines, cards,
 * rows (avatar + two lines) or avatars. Unknown kinds fall back to text.
 */
@Component({
  selector: 'ui-skeleton',
  standalone: true,
  host: {
    'aria-hidden': 'true',
    '[attr.data-kind]': 'kind()',
  },
  template: `
    @for (i of repeats(); track i) {
      @switch (kind()) {
        @case ('card') {
          <span class="s s--card"></span>
        }
        @case ('row') {
          <span class="s-row">
            <span class="s s--avatar"></span>
            <span class="s-row__lines">
              <span class="s s--line s--rowtitle"></span>
              <span class="s s--line s--short"></span>
            </span>
          </span>
        }
        @case ('avatar') {
          <span class="s s--avatar"></span>
        }
        @default {
          <span class="s s--line" [class.s--short]="i === lastLine() && lines() > 1"></span>
        }
      }
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-2);
      pointer-events: none;
    }
    :host([data-kind='card']),
    :host([data-kind='row']) {
      gap: var(--space-3);
    }
    :host([data-kind='avatar']) {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .s {
      display: block;
      background: var(--skeleton, var(--bg-hover));
      border-radius: var(--radius-md);
    }
    .s--line {
      height: 0.8rem;
      margin: var(--space-1) 0;
    }
    .s--short {
      width: 62%;
    }
    .s--rowtitle {
      width: 44%;
    }
    .s--card {
      min-height: 7rem;
      border-radius: var(--radius-lg);
      border: 1px solid var(--border);
    }
    .s--avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      flex: none;
    }
    .s-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .s-row__lines {
      display: grid;
      gap: 6px;
      flex: 1;
      min-width: 0;
    }
  `,
})
export class UiSkeleton {
  readonly kind = input<SkeletonKind>('text');
  /** Repeat count (lines/cards/rows/avatars). Clamped to >= 1; accepts
   *  attribute strings as well as bound numbers. */
  readonly lines = input<number, number | string>(1, {
    transform: (v) => {
      const n = Math.floor(Number(v));
      return Number.isFinite(n) && n >= 1 ? n : 1;
    },
  });

  protected readonly repeats = computed(() => Array.from({ length: this.lines() }, (_, i) => i));
  protected readonly lastLine = computed(() => this.lines() - 1);
}
