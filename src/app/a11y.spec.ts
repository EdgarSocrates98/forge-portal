import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Accessibility contract — static template audit (Cycle 6 §9.1).
 *
 * Runtime behavior (focus trap, aria-live announcements, contrast) is
 * covered by component specs and the browser E2E; this suite locks the
 * markup invariants that are cheap to check and expensive to regress:
 *
 *   1. every <th> carries an explicit scope (col in <thead>, row in body)
 *   2. every routed page renders exactly one <ui-page-header> — the h1
 *   3. <a target="_blank"> always pairs with rel="noopener"
 *   4. role="application"|"dialog"|"toolbar"|"radiogroup" has a name
 *   5. no raw <img> without alt sneaks in
 *
 * It scans the component source the same way scripts/check_i18n.py does:
 * no browser, no Angular toolchain — regressions fail in ~ms.
 */

const root = process.cwd();
const appDir = join(root, 'src/app');

function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* tsFiles(p);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) yield p;
  }
}

function templateOf(src: string): string {
  const m = src.match(/template:\s*`([\s\S]*?)`,\r?\n/);
  return m ? m[1] : '';
}

const sources = [...tsFiles(appDir)].map((path) => ({
  path: path.slice(root.length + 1),
  tpl: templateOf(readFileSync(path, 'utf8')),
}));

const withTemplates = sources.filter((s) => s.tpl.length > 0);

describe('a11y contract (static template audit)', () => {
  it('scans every component template in src/app', () => {
    // sanity: the audit covers the whole feature surface, not a subset
    expect(withTemplates.length).toBeGreaterThanOrEqual(30);
  });

  it('every <th> declares an explicit scope', () => {
    const bad: string[] = [];
    for (const { path, tpl } of withTemplates) {
      for (const m of tpl.matchAll(/<th(?=[\s>])[^>]*>/g)) {
        if (!/scope\s*=/.test(m[0])) bad.push(`${path}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every routed page renders exactly one <ui-page-header> (the h1)', () => {
    const pages = readdirSync(join(appDir, 'pages'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        readdirSync(join(appDir, 'pages', d.name))
          .filter((f) => f.endsWith('.page.ts') && !f.endsWith('.spec.ts'))
          .map((f) => join('pages', d.name, f)),
      );
    expect(pages.length).toBeGreaterThanOrEqual(17);
    for (const rel of pages) {
      const src = readFileSync(join(appDir, rel), 'utf8');
      const h1s = src.match(/<ui-page-header[\s>]/g) ?? [];
      expect(h1s.length, `${rel} must render exactly one <ui-page-header>`).toBe(1);
    }
  });

  it('no <h1> outside the shared page-header component', () => {
    const bad = withTemplates.filter(
      ({ path, tpl }) => path !== 'src/app/shared/page-header.ts' && /<h1[\s>]/.test(tpl),
    );
    expect(bad.map((b) => b.path)).toEqual([]);
  });

  it('every target="_blank" link pairs with rel="noopener"', () => {
    const bad: string[] = [];
    for (const { path, tpl } of withTemplates) {
      for (const m of tpl.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
        if (!/rel="[^"]*noopener[^"]*"/.test(m[0])) {
          bad.push(`${path}: ${m[0].slice(0, 80)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('interactive ARIA roles carry an accessible name', () => {
    const namedRoles = /role="(application|dialog|toolbar|radiogroup|navigation|region|group)"/;
    for (const { path, tpl } of withTemplates) {
      for (const m of tpl.matchAll(/<[a-z][^>]*>/g)) {
        const tag = m[0];
        if (namedRoles.test(tag)) {
          const named =
            /aria-label|aria-labelledby|\[attr\.aria-label\]|\[attr\.aria-labelledby\]/.test(tag);
          expect(named, `${path}: unnamed role in ${tag.slice(0, 80)}`).toBe(true);
        }
      }
    }
  });

  it('no raw <img> without alt', () => {
    const bad: string[] = [];
    for (const { path, tpl } of withTemplates) {
      for (const m of tpl.matchAll(/<img\b[^>]*>/g)) {
        if (!/alt=|\[alt\]/.test(m[0])) bad.push(`${path}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('landmark chrome exists once in the shell: skip-link, labeled nav, main', () => {
    const app = sources.find((s) => s.path === 'src/app/app.ts');
    expect(app?.tpl).toContain('class="skip-link"');
    expect(app?.tpl).toContain('#content');
    expect(app?.tpl).toMatch(/<nav[^>]*aria-label/);
    expect(app?.tpl).toMatch(/<main[^>]*id="content"/);
    expect(app?.tpl).toContain('ariaCurrentWhenActive');
  });

  it('live regions announce toasts and async state', () => {
    const toast = sources.find((s) => s.path === 'src/app/shared/toast.ts');
    expect(toast?.tpl).toContain('aria-live="polite"');
    expect(toast?.tpl).toContain("item.kind === 'error' ? 'alert'");
    const app = sources.find((s) => s.path === 'src/app/app.ts');
    expect(app?.tpl).toContain('role="alert"');
  });

  it('dialogs are modal, labeled and keyboard-trapped', () => {
    const confirm = sources.find((s) => s.path === 'src/app/shared/confirm-dialog.ts');
    const palette = sources.find((s) => s.path === 'src/app/shared/command-palette.ts');
    for (const s of [confirm, palette]) {
      expect(s?.tpl).toContain('role="dialog"');
      expect(s?.tpl).toContain('aria-modal="true"');
      expect(s?.tpl).toMatch(/aria-label|aria-labelledby/);
    }
    // both dialogs implement a Tab boundary — the trap is test-covered
    // in their component specs; here we lock the hook exists.
    expect(confirm?.tpl).toContain('(keydown)="onKeydown($event)"');
    expect(palette?.tpl).toContain('(keydown)="onPanelKey($event)"');
  });

  it('clickable non-button elements stay keyboard-activatable', () => {
    // Cycle 5 (2.2): a <tr (click)> was the only path into the
    // /execution inspector — unreachable by keyboard (WCAG 2.1.1).
    // Any native-static element carrying (click) must also be
    // focusable and Enter-activatable. Backdrop clicks on dialog
    // overlays and role="option" rows are exempt: Esc / the palette's
    // input-driven roving selection already cover them.
    const exempt = new Set([
      'src/app/shared/confirm-dialog.ts',
      'src/app/shared/command-palette.ts',
    ]);
    const bad: string[] = [];
    for (const { path, tpl } of withTemplates) {
      if (exempt.has(path)) continue;
      for (const m of tpl.matchAll(
        /<(tr|td|li|div|span|section|article|header)\b[^>]*\(click\)[^>]*>/g,
      )) {
        const tag = m[0];
        if (/role="option"/.test(tag)) continue;
        if (!/tabindex/.test(tag) || !/\(keydown\.(enter|space)\)/.test(tag)) {
          bad.push(`${path}: ${tag.slice(0, 90)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
