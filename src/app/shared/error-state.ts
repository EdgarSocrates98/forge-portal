import { Component, computed, inject, input, output } from '@angular/core';
import { ApiError } from '../core/api/api.error';
import { I18nService } from '../core/i18n/i18n.service';
import { TPipe } from '../core/i18n/i18n.pipe';

/** Painel de erro — traduz message_key quando existe, mostra recusa/código. */
@Component({
  selector: 'ui-error',
  standalone: true,
  imports: [TPipe],
  template: `
    <div class="err" role="alert">
      <p class="err__title">{{ 'error.title' | t }}</p>
      <p class="err__msg">{{ message() }}</p>
      @if (error()?.body?.code) {
        <code class="err__code">{{ error()!.body.code }}</code>
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
