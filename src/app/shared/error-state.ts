import { Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiError } from '../core/api/api.error';
import { guidanceFor } from '../core/api/error-guidance';
import { I18nService } from '../core/i18n/i18n.service';
import { TPipe } from '../core/i18n/i18n.pipe';
import { UiIcon } from './icon';

/**
 * Painel de erro — Cycle 5 §8.4 actionable diagnostic shape:
 * explanation (translated `message_key` or the raw message), evidence
 * (the real refusal `code` + server `action` hint, verbatim), next
 * action (a route link when a page owns the resolution — mapped in
 * `core/api/error-guidance.ts`) and verification (the retry action).
 * Unknown codes degrade to the plain panel — nothing is guessed.
 */
@Component({
  selector: 'ui-error',
  standalone: true,
  imports: [RouterLink, TPipe, UiIcon],
  template: `
    <div class="err" role="alert">
      <p class="err__title">{{ 'error.title' | t }}</p>
      <p class="err__msg">{{ message() }}</p>
      @if (error()?.body?.code) {
        <code class="err__code">{{ error()!.body.code }}</code>
      }
      @if (guidance(); as g) {
        <p class="err__hint">
          {{ g.explainKey | t }}
          @if (g.route && g.routeKey) {
            <a class="err__go" [routerLink]="g.route"
              >{{ g.routeKey | t }}<ui-icon name="chevron-right" [size]="13"
            /></a>
          }
        </p>
      }
      @if (error()?.body?.action; as act) {
        <p class="err__action">{{ act }}</p>
      }
      <div class="err__actions">
        @if (error()?.body?.retryable !== false) {
          <button class="btn" (click)="retry.emit()">{{ 'error.retry' | t }}</button>
        }
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .err {
      display: grid;
      gap: 8px;
      padding: var(--space-6);
      border: 1px solid color-mix(in srgb, var(--error) 55%, transparent);
      border-left-width: 3px;
      border-radius: var(--radius-lg);
      background: var(--error-bg);
      box-shadow: var(--elev-card);
    }
    .err__title {
      font-weight: 700;
      color: var(--error);
      margin: 0;
    }
    .err__msg {
      margin: 0;
      color: var(--fg);
    }
    .err__code {
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .err__hint {
      margin: 0;
      font-size: var(--font-sm);
      color: var(--fg-muted);
    }
    .err__go {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      font-weight: 600;
      text-decoration: none;
      white-space: nowrap;
    }
    .err__go:hover {
      color: var(--accent-ink);
    }
    .err__action {
      margin: 0;
      font-size: var(--font-sm);
      font-weight: 550;
      color: var(--accent-ink);
    }
    .err__actions {
      display: flex;
      gap: var(--space-2);
    }
  `,
})
export class ErrorState {
  private readonly i18n = inject(I18nService);
  readonly error = input<ApiError | null>(null);
  readonly retry = output<void>();

  readonly guidance = computed(() => guidanceFor(this.error()));

  readonly message = computed(() => {
    const err = this.error();
    if (!err) return this.i18n.t('error.generic');
    const key = err.body.message_key;
    if (key) {
      const translated = this.i18n.t(key);
      if (!translated.startsWith('⟪')) return translated;
    }
    return err.body.message || this.i18n.t('error.generic');
  });
}
