import { readFileSync } from 'node:fs';

const root = process.cwd();
const tokens = readFileSync(`${root}/src/styles/tokens.css`, 'utf8');
const styles = readFileSync(`${root}/src/styles.css`, 'utf8');

describe('design tokens (tokens.css)', () => {
  it('declares the neutral surface/border/text ramps for both schemes', () => {
    for (const name of ['--fg-bg', '--fg-surface', '--fg-surface-2', '--fg-border', '--fg-text']) {
      expect(tokens).toContain(name);
    }
    expect(tokens).toContain("[data-scheme='dark']");
    expect(tokens).toContain('color-scheme: dark');
    expect(tokens).toContain('color-scheme: light');
  });

  it('exposes the full state vocabulary: ok/warn/error/info/unverified', () => {
    for (const alias of ['--ok', '--warn', '--error', '--info', '--unverified']) {
      expect(tokens).toMatch(new RegExp(`${alias}: `));
      expect(tokens).toMatch(new RegExp(`${alias}-bg: `));
    }
  });

  it('covers typography, spacing, radii, elevation, motion and z-index', () => {
    for (const name of [
      '--fg-text-xs',
      '--fg-text-2xl',
      '--fg-weight-semibold',
      '--fg-space-4',
      '--fg-radius-md',
      '--fg-elev-2',
      '--fg-motion-med',
      '--z-dialog',
      '--z-toast',
    ]) {
      expect(tokens).toContain(name);
    }
  });

  it('defines a single focus-ring source', () => {
    expect(tokens).toContain('--fg-focus-width');
    expect(tokens).toContain('--fg-focus-ring');
    expect(styles).toContain('outline: var(--fg-focus-width) solid var(--fg-focus)');
  });

  it('zeros motion durations under prefers-reduced-motion', () => {
    const block = tokens.slice(tokens.indexOf('prefers-reduced-motion'));
    expect(block).toContain('--fg-motion-fast: 0ms');
    expect(block).toContain('--fg-motion-med: 0ms');
  });

  it('strengthens borders and the focus ring under prefers-contrast: more', () => {
    const block = tokens.slice(tokens.indexOf('prefers-contrast: more'));
    expect(block).toContain('--fg-focus-width: 3px');
    expect(block).toContain('--fg-border:');
  });

  it('keeps one accent set per Forja', () => {
    const forges = new Set(tokens.match(/\[data-forge='[a-z-]+'\]/g) ?? []);
    expect(forges.size).toBe(7);
  });
});
