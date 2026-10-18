import { Injector, effect, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_PREFS,
  PREFS_KEY,
  PREFS_SCHEMA,
  PrefsStore,
  isInternalRoute,
  parsePrefs,
  routeLabelKey,
} from './prefs.store';

const FULL = {
  schema: PREFS_SCHEMA,
  density: 'compact',
  motion: 'reduced',
  navCollapsed: true,
  lastRoute: '/skills?q=growth',
  dismissedHints: ['mcp', 'graph'],
  pageFilters: { skills: 'growth', agents: 'reviewer' },
};

describe('portal prefs — forge-portal/Prefs/v1', () => {
  it('parses a full record verbatim', () => {
    expect(parsePrefs(FULL)).toEqual(FULL);
  });

  it('returns null for absent, corrupt and foreign payloads', () => {
    expect(parsePrefs(null)).toBeNull();
    expect(parsePrefs('x')).toBeNull();
    expect(parsePrefs({ schema: 'other/v9' })).toBeNull();
  });

  it('drops the whole record on an invalid typed field', () => {
    expect(parsePrefs({ ...FULL, density: 'huge' })).toBeNull();
    expect(parsePrefs({ ...FULL, motion: 'warp' })).toBeNull();
    expect(parsePrefs({ ...FULL, navCollapsed: 'yes' })).toBeNull();
  });

  it('falls back per-field for absent optional data', () => {
    const p = parsePrefs({ schema: PREFS_SCHEMA });
    expect(p).toEqual(DEFAULT_PREFS);
    const partial = parsePrefs({ schema: PREFS_SCHEMA, lastRoute: 42, dismissedHints: 'x' });
    expect(partial?.lastRoute).toBeNull();
    expect(partial?.dismissedHints).toEqual([]);
  });

  it('rejects non-internal lastRoute values', () => {
    expect(parsePrefs({ ...FULL, lastRoute: 'https://evil.example' })?.lastRoute).toBeNull();
    expect(parsePrefs({ ...FULL, lastRoute: '//proto-relative' })?.lastRoute).toBeNull();
    expect(parsePrefs({ ...FULL, lastRoute: `/${'a'.repeat(400)}` })?.lastRoute).toBeNull();
    expect(parsePrefs({ ...FULL, lastRoute: '/graph' })?.lastRoute).toBe('/graph');
  });

  it('keeps only string filter values within bounds', () => {
    const p = parsePrefs({
      ...FULL,
      pageFilters: { ok: 'x', num: 3, long: 'a'.repeat(400) },
    });
    expect(p?.pageFilters).toEqual({ ok: 'x' });
  });

  it('isInternalRoute accepts only path-relative URLs', () => {
    expect(isInternalRoute('/skills')).toBe(true);
    expect(isInternalRoute('/skills?q=a')).toBe(true);
    expect(isInternalRoute('skills')).toBe(false);
    expect(isInternalRoute('//host/x')).toBe(false);
    expect(isInternalRoute('https://x')).toBe(false);
    expect(isInternalRoute(7)).toBe(false);
  });

  it('routeLabelKey maps the first segment to a nav key', () => {
    expect(routeLabelKey('/skills?q=growth')).toBe('nav.skills');
    expect(routeLabelKey('/forges/api-forge')).toBe('nav.forges');
    expect(routeLabelKey('/guide')).toBe('nav.guide');
    expect(routeLabelKey('/nope')).toBeNull();
  });
});

describe('PrefsStore', () => {
  const el = document.documentElement;

  beforeEach(() => {
    try {
      localStorage.removeItem(PREFS_KEY);
    } catch {
      // jsdom without storage
    }
    delete el.dataset['density'];
    delete el.dataset['motion'];
  });

  function make(): PrefsStore {
    const prefs = TestBed.inject(PrefsStore);
    TestBed.tick(); // flush the persist+apply effect
    return prefs;
  }

  it('applies defaults and persists them', () => {
    const prefs = make();
    expect(prefs.density()).toBe('comfortable');
    expect(prefs.motion()).toBe('system');
    expect(el.dataset['density']).toBe('comfortable');
    expect(el.dataset['motion']).toBe('system');
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY)!);
    expect(stored.schema).toBe(PREFS_SCHEMA);
  });

  it('round-trips a change through storage', () => {
    const prefs = make();
    prefs.setDensity('compact');
    prefs.setMotion('reduced');
    prefs.setNavCollapsed(true);
    prefs.recordRoute('/skills?q=growth');
    prefs.dismissHint('mcp');
    prefs.setFilter('skills', 'growth');
    TestBed.tick();
    expect(el.dataset['density']).toBe('compact');
    expect(el.dataset['motion']).toBe('reduced');
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY)!);
    expect(stored.density).toBe('compact');
    expect(stored.navCollapsed).toBe(true);
    expect(stored.lastRoute).toBe('/skills?q=growth');
    expect(stored.dismissedHints).toEqual(['mcp']);
    expect(stored.pageFilters).toEqual({ skills: 'growth' });
  });

  it('restores a stored record on construction', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(FULL));
    const prefs = make();
    expect(prefs.density()).toBe('compact');
    expect(prefs.motion()).toBe('reduced');
    expect(prefs.navCollapsed()).toBe(true);
    expect(prefs.lastRoute()).toBe('/skills?q=growth');
    expect(prefs.isHintDismissed('graph')).toBe(true);
    expect(prefs.filterFor('agents')).toBe('reviewer');
  });

  it('ignores a corrupt record and never records external routes', () => {
    localStorage.setItem(PREFS_KEY, '{broken');
    const prefs = make();
    expect(prefs.density()).toBe('comfortable');
    prefs.recordRoute('https://evil.example');
    prefs.recordRoute('relative/path');
    TestBed.tick();
    expect(prefs.lastRoute()).toBeNull();
  });

  it('empty filter text deletes the key; resetHints clears dismissal', () => {
    const prefs = make();
    prefs.setFilter('agents', 'x');
    expect(prefs.filterFor('agents')).toBe('x');
    prefs.setFilter('agents', '');
    expect(prefs.filterFor('agents')).toBe('');
    prefs.dismissHint('graph');
    prefs.resetHints();
    expect(prefs.isHintDismissed('graph')).toBe(false);
  });

  it('terminates when setFilter is driven by an effect (no write→read loop)', () => {
    const prefs = make();
    const src = signal('');
    // Mirrors the page usage: `effect(() => prefs.setFilter(p, q()))` —
    // a tracked pageFilters read + write used to retrigger itself forever.
    TestBed.tick();
    effect(() => prefs.setFilter('skills', src()), { injector: TestBed.inject(Injector) });
    src.set('glue');
    TestBed.tick();
    expect(prefs.filterFor('skills')).toBe('glue');
    src.set('');
    TestBed.tick();
    expect(prefs.filterFor('skills')).toBe('');
  });
});
