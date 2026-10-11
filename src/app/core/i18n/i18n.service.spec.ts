import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';
import { PT_BR } from './locales/pt-br';
import { EN } from './locales/en';

describe('I18nService', () => {
  it('pt-BR and en dictionaries have identical key sets', () => {
    const pt = new Set(Object.keys(PT_BR));
    const en = new Set(Object.keys(EN));
    expect([...pt].filter((k) => !en.has(k))).toEqual([]);
    expect([...en].filter((k) => !pt.has(k))).toEqual([]);
  });

  it('translates with interpolation and plural forms', async () => {
    const i18n = TestBed.inject(I18nService);
    await i18n.applyPreference('en');
    expect(i18n.t('nav.dashboard')).toBe('Dashboard');
    expect(i18n.t('install.plan.changes', { count: 1 })).toBe('1 planned change');
    expect(i18n.t('install.plan.changes', { count: 4 })).toBe('4 planned changes');
  });

  it('switches locale at runtime without reload', async () => {
    const i18n = TestBed.inject(I18nService);
    await i18n.applyPreference('en');
    expect(i18n.t('nav.dashboard')).toBe('Dashboard');
    await i18n.applyPreference('pt-BR');
    expect(i18n.t('nav.dashboard')).toBe('Painel');
  });

  it('marks missing keys visibly instead of crashing', async () => {
    const i18n = TestBed.inject(I18nService);
    await i18n.applyPreference('en');
    expect(i18n.t('no.such.key')).toBe('⟪no.such.key⟫');
  });

  it('no missing keys remain after loading en', async () => {
    const i18n = TestBed.inject(I18nService);
    await i18n.applyPreference('en');
    expect(i18n.missingKeys()).toEqual([]);
  });
});
