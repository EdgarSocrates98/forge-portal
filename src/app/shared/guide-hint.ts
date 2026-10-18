import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TPipe } from '../core/i18n/i18n.pipe';
import { PrefsStore } from '../core/prefs/prefs.store';
import { UiIcon } from './icon';

/**
 * Cycle 5 §8.1 — contextual, discreet onboarding hint rendered under a
 * page header. One short concept line per page (`hint.<id>`), a "learn
 * more" deep-link into the matching `/guide` section and a dismiss
 * control persisted in `PrefsStore` — dismissed hints never come back,
 * so the interface is never polluted by a mandatory tutorial.
 *
 * Pure explanation: hints carry copy only, never fabricated state.
 */
@Component({
  selector: 'ui-guide-hint',
  standalone: true,
  imports: [RouterLink, TPipe, UiIcon],
  template: `
    @if (visible()) {
      <div class="hint" role="note" [attr.data-hint]="hintId()">
        <ui-icon class="hint__icon" name="guide" [size]="14" />
        <p class="hint__text">
          {{ textKey() | t }}
          <a class="hint__more" [routerLink]="'/guide'" [fragment]="hintId()">
            {{ 'hint.more' | t }}
          </a>
        </p>
        <button
          type="button"
          class="hint__x"
          (click)="dismiss()"
          [attr.aria-label]="'hint.dismiss' | t"
          [title]="'hint.dismiss' | t"
        >
          <ui-icon name="close" [size]="12" />
        </button>
      </div>
    }
  `,
  styles: `
    .hint {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
      margin-top: var(--space-2);
      padding: 6px var(--space-3);
      border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--accent-bg) 40%, transparent);
      font-size: var(--font-sm);
      color: var(--fg-muted);
    }
    .hint__icon {
      flex: none;
      margin-top: 2px;
      color: var(--accent-ink);
    }
    .hint__text {
      flex: 1;
      margin: 0;
      min-width: 0;
    }
    .hint__more {
      white-space: nowrap;
      font-weight: 600;
      text-decoration: none;
    }
    .hint__more:hover {
      color: var(--accent-ink);
      text-decoration: underline;
    }
    .hint__x {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 20px;
      height: 20px;
      margin-top: 1px;
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--fg-muted);
      cursor: pointer;
      transition:
        color var(--motion-fast),
        background var(--motion-fast);
    }
    .hint__x:hover {
      color: var(--fg);
      background: var(--bg-hover);
    }
    .hint__x:focus-visible {
      outline: var(--fg-focus-width) solid var(--fg-focus);
      outline-offset: var(--fg-focus-offset);
    }
  `,
})
export class UiGuideHint {
  private readonly prefs = inject(PrefsStore);

  /** Concept id — resolves `hint.<id>` copy and the `/guide#<id>`
   *  anchor. Ids are compile-time literals at each page. */
  readonly hintId = input.required<string>();

  readonly textKey = computed(() => `hint.${this.hintId()}`);
  readonly visible = computed(() => !this.prefs.isHintDismissed(this.hintId()));

  dismiss(): void {
    this.prefs.dismissHint(this.hintId());
  }
}
