import { Component, inject } from '@angular/core';
import { PortalStore } from '../../core/portal/portal.store';
import { I18nService, LocalePreference } from '../../core/i18n/i18n.service';
import { ThemeStore, Scheme } from '../../core/theme/theme.store';
import { Density, MotionPref, PrefsStore } from '../../core/prefs/prefs.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { UiIcon } from '../../shared/icon';

@Component({
  selector: 'page-settings',
  standalone: true,
  imports: [TPipe, PageHeader, UiIcon],
  template: `
    <ui-page-header [title]="'settings.title' | t" [subtitle]="'settings.subtitle' | t" />

    <section class="card">
      <h2>{{ 'settings.language' | t }}</h2>
      <div class="opts" role="radiogroup" [attr.aria-label]="'settings.language' | t">
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
      <div class="opts" role="radiogroup" [attr.aria-label]="'settings.theme' | t">
        @for (opt of schemeOpts; track opt.id) {
          <label class="opt" [attr.data-active]="theme.scheme() === opt.id || null">
            <input
              type="radio"
              name="scheme"
              [value]="opt.id"
              [checked]="theme.scheme() === opt.id"
              (change)="setScheme(opt.id)"
            />
            <ui-icon [name]="schemeIcon(opt.id)" [size]="15" />
            <span>{{ opt.label | t }}</span>
          </label>
        }
      </div>
    </section>

    <section class="card">
      <h2>{{ 'settings.density' | t }}</h2>
      <div class="opts" role="radiogroup" [attr.aria-label]="'settings.density' | t">
        @for (opt of densityOpts; track opt.id) {
          <label class="opt" [attr.data-active]="prefs.density() === opt.id || null">
            <input
              type="radio"
              name="density"
              [value]="opt.id"
              [checked]="prefs.density() === opt.id"
              (change)="setDensity(opt.id)"
            />
            <span>{{ opt.label | t }}</span>
          </label>
        }
      </div>
    </section>

    <section class="card">
      <h2>{{ 'settings.motion' | t }}</h2>
      <div class="opts" role="radiogroup" [attr.aria-label]="'settings.motion' | t">
        @for (opt of motionOpts; track opt.id) {
          <label class="opt" [attr.data-active]="prefs.motion() === opt.id || null">
            <input
              type="radio"
              name="motion"
              [value]="opt.id"
              [checked]="prefs.motion() === opt.id"
              (change)="setMotion(opt.id)"
            />
            <span>{{ opt.label | t }}</span>
          </label>
        }
      </div>
    </section>

    <section class="card">
      <h2>{{ 'settings.hints' | t }}</h2>
      <p class="muted">{{ 'settings.hints.hint' | t }}</p>
      <button
        class="btn"
        [disabled]="prefs.dismissedHints().length === 0"
        (click)="prefs.resetHints()"
      >
        {{ 'settings.hints.reset' | t }}
      </button>
    </section>

    <p class="muted privacy">{{ 'settings.privacy' | t }}</p>

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
      margin-bottom: var(--space-4);
      max-width: 640px;
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
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
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast),
        box-shadow var(--motion-fast);
    }
    .opt:hover {
      border-color: var(--border-strong);
      background: var(--bg-hover);
    }
    .opt:focus-within {
      border-color: var(--fg-focus);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg-focus) 22%, transparent);
    }
    .opt[data-active] {
      border-color: color-mix(in srgb, var(--accent) 55%, transparent);
      background: var(--accent-bg);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
      font-weight: 550;
    }
    .opt input[type='radio'] {
      accent-color: var(--accent-ink);
    }
    .opt ui-icon {
      color: var(--fg-muted);
    }
    .opt[data-active] ui-icon {
      color: var(--accent-ink);
    }
    .kv {
      display: grid;
      margin: 0;
    }
    .kv div {
      display: flex;
      gap: var(--space-2);
      padding: var(--space-2) 0;
      border-bottom: 1px solid var(--border);
    }
    .kv div:last-child {
      border-bottom: none;
    }
    .kv dt {
      color: var(--fg-muted);
      min-width: 140px;
    }
    .kv dd {
      margin: 0;
      font-weight: 500;
    }
    .muted {
      color: var(--fg-muted);
    }
    .privacy {
      max-width: 640px;
      margin: 0 0 var(--space-4);
      font-size: var(--font-xs);
    }
  `,
})
export class SettingsPage {
  readonly store = inject(PortalStore);
  readonly i18n = inject(I18nService);
  readonly theme = inject(ThemeStore);
  readonly prefs = inject(PrefsStore);

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

  readonly densityOpts: { id: Density; label: string }[] = [
    { id: 'comfortable', label: 'settings.density.comfortable' },
    { id: 'compact', label: 'settings.density.compact' },
  ];

  readonly motionOpts: { id: MotionPref; label: string }[] = [
    { id: 'system', label: 'settings.motion.system' },
    { id: 'full', label: 'settings.motion.full' },
    { id: 'reduced', label: 'settings.motion.reduced' },
  ];

  setLocale(pref: LocalePreference): void {
    void this.i18n.applyPreference(pref);
  }

  setScheme(scheme: Scheme): void {
    this.theme.setScheme(scheme);
  }

  setDensity(d: Density): void {
    this.prefs.setDensity(d);
  }

  setMotion(m: MotionPref): void {
    this.prefs.setMotion(m);
  }

  schemeIcon(id: Scheme): string {
    return id === 'dark' ? 'moon' : id === 'light' ? 'sun' : 'contrast';
  }
}
