import { Injectable, signal } from '@angular/core';
import { ForgeId } from '../api/api.models';

export type Scheme = 'light' | 'dark' | 'system';
const SCHEME_KEY = 'forge-portal.scheme';
const FORGE_ORDER: ForgeId[] = [
  'the-forge',
  'spark-forge-aws',
  'spark-forge-azure',
  'api-forge',
  'platform-forge',
  'forge-doctor-data',
  'forge-doctor-api',
];

/** Esquema claro/escuro + acento por Forja, aplicados em data-* no <html>. */
@Injectable({ providedIn: 'root' })
export class ThemeStore {
  readonly scheme = signal<Scheme>('system');
  readonly forge = signal<ForgeId>('the-forge');

  private media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');

  constructor() {
    try {
      const stored = globalThis.localStorage?.getItem(SCHEME_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        this.scheme.set(stored);
      }
    } catch {
      // storage unavailable
    }
    this.media?.addEventListener('change', () => this.apply());
    this.apply();
  }

  setScheme(scheme: Scheme): void {
    this.scheme.set(scheme);
    try {
      globalThis.localStorage?.setItem(SCHEME_KEY, scheme);
    } catch {
      // non-fatal
    }
    this.apply();
  }

  /** Chamado pelo bootstrap quando a Forja alvo é conhecida — troca o
   *  acento sem reload. Nomes desconhecidos caem em `the-forge`. */
  setForge(forge: string): void {
    this.forge.set(this.normalizeForge(forge));
    this.apply();
  }

  normalizeForge(raw: string): ForgeId {
    return (FORGE_ORDER as string[]).includes(raw) ? (raw as ForgeId) : 'the-forge';
  }

  private apply(): void {
    const el = globalThis.document?.documentElement;
    if (!el) return;
    const scheme =
      this.scheme() === 'system' ? (this.media?.matches ? 'dark' : 'light') : this.scheme();
    el.dataset['scheme'] = scheme;
    el.dataset['forge'] = this.forge();
  }
}
