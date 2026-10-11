import { Injectable, computed, signal } from '@angular/core';

export type Locale = 'pt-BR' | 'en';
export type LocalePreference = Locale | 'automatic';

const STORAGE_KEY = 'forge-portal.locale';
const DICTS: Record<Locale, () => Promise<Record<string, string>>> = {
  'pt-BR': () => import('./locales/pt-br').then((m) => m.PT_BR),
  en: () => import('./locales/en').then((m) => m.EN),
};

/**
 * Runtime i18n — pt-BR é o idioma principal; troca é imediata via
 * signals (nenhum reload, nenhum build por locale). `automatic` segue
 * navigator.language com fallback pt-BR. Chaves ausentes aparecem como
 * `⟪key⟫` para o gate de cobertura nunca deixar uma chave crua vazar.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly dict = signal<Map<string, string>>(new Map());
  private readonly fallbackDict = signal<Map<string, string>>(new Map());
  readonly preference = signal<LocalePreference>('automatic');
  readonly locale = signal<Locale>('pt-BR');
  readonly ready = signal(false);

  readonly missingKeys = signal<string[]>([]);

  constructor() {
    const stored = this.readStoredPreference();
    void this.applyPreference(stored);
  }

  private readStoredPreference(): LocalePreference {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (raw === 'pt-BR' || raw === 'en' || raw === 'automatic') return raw;
    } catch {
      // storage unavailable — automatic is the safe default
    }
    return 'automatic';
  }

  async applyPreference(pref: LocalePreference): Promise<void> {
    this.preference.set(pref);
    const locale = pref === 'automatic' ? this.detectLocale() : pref;
    this.locale.set(locale);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, pref);
    } catch {
      // non-fatal
    }
    if (this.fallbackDict().size === 0) {
      this.fallbackDict.set(new Map(Object.entries(await DICTS['pt-BR']())));
    }
    this.dict.set(new Map(Object.entries(await DICTS[locale]())));
    this.ready.set(true);
    this.collectMissing();
  }

  private detectLocale(): Locale {
    const nav = globalThis.navigator?.language ?? 'pt-BR';
    return nav.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
  }

  private collectMissing(): void {
    const dict = this.dict();
    const missing: string[] = [];
    for (const key of this.fallbackDict().keys()) {
      if (!dict.has(key)) missing.push(key);
    }
    this.missingKeys.set(missing);
  }

  /** Translate `key`; interpolate `{param}` placeholders; supports the
   *  `{count, plural, one{…} other{…}}` subset used by our strings. */
  t(key: string, params?: Record<string, string | number>): string {
    let value = this.dict().get(key) ?? this.fallbackDict().get(key);
    if (value === undefined) return `⟪${key}⟫`;
    if (params && value.includes('{')) {
      value = value.replace(
        /\{(\w+),\s*plural,\s*one\{([^}]*)\}\s*other\{([^}]*)\}\}/g,
        (_m: string, name: string, one: string, other: string) => {
          const n = Number(params[name]);
          const branch = n === 1 ? one : other;
          return branch.replace(/#/g, String(n));
        },
      );
      value = value.replace(/\{(\w+)\}/g, (m: string, name: string) =>
        params[name] !== undefined ? String(params[name]) : m,
      );
    }
    return value;
  }

  /** Convenience for templates that need a computed translation. */
  translate(key: string, params?: Record<string, string | number>) {
    return computed(() => this.t(key, params));
  }
}
