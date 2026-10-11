import { Component, inject } from '@angular/core';
import { PortalStore } from '../../core/portal/portal.store';
import { I18nService, LocalePreference } from '../../core/i18n/i18n.service';
import { ThemeStore, Scheme } from '../../core/theme/theme.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';

@Component({
  selector: 'page-settings',
  standalone: true,
  imports: [TPipe, PageHeader],
  template: `
    <ui-page-header [title]="'settings.title' | t" [subtitle]="'settings.subtitle' | t" />

    <section class="card">
      <h2>{{ 'settings.language' | t }}</h2>
      <div class="opts" role="radiogroup">
        @for (opt of localeOpts; track opt.id) {
          <label class="opt" [attr.data-active]="i18n.preference() === opt.id || null">
            <input
              type="radio"
              name="locale"
              [value]="opt.id"
              [checked]="i18n.preference() === opt.id"
              (change)="setLocale(opt.id)"
            />
            <span>{{ opt.label | t }}</span>
          </label>
        }
      </div>
    </section>

    <section class="card">
      <h2>{{ 'settings.theme' | t }}</h2>
      <div class="opts" role="radiogroup">
        @for (opt of schemeOpts; track opt.id) {
          <label class="opt" [attr.data-active]="theme.scheme() === opt.id || null">
            <input
              type="radio"
              name="scheme"
              [value]="opt.id"
              [checked]="theme.scheme() === opt.id"
              (change)="setScheme(opt.id)"
            />
            <span>{{ opt.label | t }}</span>
          </label>
        }
      </div>
    </section>

    <section class="card">
      <h2>{{ 'settings.about' | t }}</h2>
      @if (store.descriptor(); as d) {
        <dl class="kv">
          <div>
            <dt>{{ 'settings.forge' | t }}</dt>
            <dd>{{ d.forge_name }}</dd>
          </div>
          <div>
            <dt>{{ 'settings.version' | t }}</dt>
            <dd>{{ d.forge_version }}</dd>
          </div>
          <div>
            <dt>{{ 'settings.portalVersion' | t }}</dt>
            <dd>{{ d.portal_version }}</dd>
          </div>
          <div>
            <dt>{{ 'settings.cli' | t }}</dt>
            <dd>
              <code>{{ d.cli }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ 'settings.federated' | t }}</dt>
            <dd>{{ (d.federated ? 'state.yes' : 'state.no') | t }}</dd>
          </div>
        </dl>
      }
    </section>
  `,
  styles: `
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      padding: var(--space-5);
      margin-bottom: var(--space-4);
      max-width: 640px;
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
    }
    .opts {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .opt {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: 8px var(--space-3);
      cursor: pointer;
    }
    .opt[data-active] {
      border-color: var(--accent);
      background: var(--accent-bg);
    }
    .kv {
      display: grid;
      gap: 6px;
      margin: 0;
    }
    .kv div {
      display: flex;
      gap: var(--space-2);
    }
    .kv dt {
      color: var(--fg-muted);
      min-width: 140px;
    }
    .kv dd {
      margin: 0;
    }
  `,
})
export class SettingsPage {
  readonly store = inject(PortalStore);
  readonly i18n = inject(I18nService);
  readonly theme = inject(ThemeStore);

  readonly localeOpts: { id: LocalePreference; label: string }[] = [
    { id: 'automatic', label: 'settings.language.auto' },
    { id: 'pt-BR', label: 'settings.language.pt' },
    { id: 'en', label: 'settings.language.en' },
  ];

  readonly schemeOpts: { id: Scheme; label: string }[] = [
    { id: 'system', label: 'settings.theme.system' },
    { id: 'light', label: 'settings.theme.light' },
    { id: 'dark', label: 'settings.theme.dark' },
  ];

  setLocale(pref: LocalePreference): void {
    void this.i18n.applyPreference(pref);
  }

  setScheme(scheme: Scheme): void {
    this.theme.setScheme(scheme);
  }
}
