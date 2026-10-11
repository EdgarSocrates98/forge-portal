import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';

/**
 * `{{ 'nav.dashboard' | t }}` — impure on purpose: re-evaluates when the
 * locale dictionary swaps so the switch is instant app-wide. The service
 * itself is signal-driven so this stays cheap.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string | null | undefined, params?: Record<string, string | number>): string {
    if (!key) return '';
    // touch the signals so this pipe re-runs on locale change
    this.i18n.locale();
    this.i18n.ready();
    return this.i18n.t(key, params);
  }
}
