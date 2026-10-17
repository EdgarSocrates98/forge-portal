import { TestBed } from '@angular/core/testing';
import { ThemeStore } from './theme.store';

const SCHEME_KEY = 'forge-portal.scheme';

function stubMatchMedia(dark: boolean) {
  globalThis.matchMedia = ((query: string) => ({
    matches: dark,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof matchMedia;
}

describe('ThemeStore', () => {
  const el = document.documentElement;

  beforeEach(() => {
    try {
      localStorage.removeItem(SCHEME_KEY);
    } catch {
      // jsdom without storage
    }
    delete el.dataset['scheme'];
    delete el.dataset['forge'];
  });

  it('defaults to dark — the primary scheme', () => {
    stubMatchMedia(false);
    const theme = TestBed.inject(ThemeStore);
    expect(theme.scheme()).toBe('dark');
    expect(el.dataset['scheme']).toBe('dark');
  });

  it('applies and persists an explicit scheme', () => {
    stubMatchMedia(false);
    const theme = TestBed.inject(ThemeStore);
    theme.setScheme('light');
    expect(el.dataset['scheme']).toBe('light');
    expect(localStorage.getItem(SCHEME_KEY)).toBe('light');
  });

  it('system resolves through prefers-color-scheme', () => {
    stubMatchMedia(true);
    const theme = TestBed.inject(ThemeStore);
    theme.setScheme('system');
    expect(el.dataset['scheme']).toBe('dark');
  });

  it('system resolves to light when the OS prefers light', () => {
    stubMatchMedia(false);
    const theme = TestBed.inject(ThemeStore);
    theme.setScheme('system');
    expect(el.dataset['scheme']).toBe('light');
  });

  it('applies the forge accent and normalizes unknown ids', () => {
    stubMatchMedia(false);
    const theme = TestBed.inject(ThemeStore);
    theme.setForge('api-forge');
    expect(el.dataset['forge']).toBe('api-forge');
    theme.setForge('not-a-forge');
    expect(el.dataset['forge']).toBe('the-forge');
  });
});
