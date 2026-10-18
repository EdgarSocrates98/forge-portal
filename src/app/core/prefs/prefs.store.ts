import { Injectable, effect, signal, untracked } from '@angular/core';

/**
 * Cycle 5 §8.2/§8.3 — portal preferences, one schema-versioned
 * localStorage record (`forge-portal/prefs/v1`).
 *
 * Only non-sensitive UX state lives here: density, motion, sidebar
 * collapse, last visited area, dismissed guide hints and per-page
 * filter text. No tokens, no entity data, no secrets — anything else
 * must NOT be added to this record.
 *
 * Parse is strict: a foreign schema or an invalid typed field drops the
 * whole record back to defaults (never a partial apply); missing
 * optional fields fall back individually. Storage failures degrade to
 * in-memory defaults — preferences are a convenience, never a
 * requirement.
 */

export type Density = 'comfortable' | 'compact';
export type MotionPref = 'system' | 'full' | 'reduced';

export const PREFS_KEY = 'forge-portal/prefs/v1';
export const PREFS_SCHEMA = 'forge-portal/Prefs/v1';

export interface PortalPrefs {
  schema: typeof PREFS_SCHEMA;
  density: Density;
  motion: MotionPref;
  navCollapsed: boolean;
  /** Last visited internal URL (path + query) — the "voltar à última
   *  área" affordance. Internal routes only. */
  lastRoute: string | null;
  /** Guide hint ids the user dismissed — they never reappear. */
  dismissedHints: string[];
  /** Last filter text per page id (skills, agents, match…). */
  pageFilters: Record<string, string>;
}

export const DEFAULT_PREFS: PortalPrefs = {
  schema: PREFS_SCHEMA,
  density: 'comfortable',
  motion: 'system',
  navCollapsed: false,
  lastRoute: null,
  dismissedHints: [],
  pageFilters: {},
};

const DENSITIES = new Set<Density>(['comfortable', 'compact']);
const MOTIONS = new Set<MotionPref>(['system', 'full', 'reduced']);

/** Internal route check for `lastRoute` — path-relative only, never a
 *  protocol-relative or external URL, bounded in length. */
export function isInternalRoute(url: unknown): url is string {
  return (
    typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && url.length <= 300
  );
}

/** Strict parse — null on a foreign schema or an invalid typed field;
 *  absent optional fields fall back to defaults. */
export function parsePrefs(raw: unknown): PortalPrefs | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o['schema'] !== PREFS_SCHEMA) return null;

  const density = o['density'] === undefined ? 'comfortable' : (o['density'] as Density);
  const motion = o['motion'] === undefined ? 'system' : (o['motion'] as MotionPref);
  const navCollapsed = o['navCollapsed'] === undefined ? false : o['navCollapsed'];
  if (!DENSITIES.has(density) || !MOTIONS.has(motion) || typeof navCollapsed !== 'boolean') {
    return null;
  }

  const lastRoute = isInternalRoute(o['lastRoute']) ? o['lastRoute'] : null;
  const dismissedHints = Array.isArray(o['dismissedHints'])
    ? o['dismissedHints'].filter((x): x is string => typeof x === 'string')
    : [];
  const pageFilters: Record<string, string> = {};
  if (o['pageFilters'] && typeof o['pageFilters'] === 'object') {
    for (const [k, v] of Object.entries(o['pageFilters'] as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length <= 300) pageFilters[k] = v;
    }
  }

  return {
    schema: PREFS_SCHEMA,
    density,
    motion,
    navCollapsed,
    lastRoute,
    dismissedHints,
    pageFilters,
  };
}

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Route → nav label key, for rendering "voltar à última área" without
 *  inventing names — keys are the same ones the sidebar renders. */
export const ROUTE_LABEL_KEYS: Record<string, string> = {
  dashboard: 'nav.dashboard',
  guide: 'nav.guide',
  federation: 'nav.federation',
  forges: 'nav.forges',
  agents: 'nav.agents',
  skills: 'nav.skills',
  mcp: 'nav.mcp',
  knowledge: 'nav.knowledge',
  match: 'nav.match',
  tasks: 'nav.tasks',
  install: 'nav.install',
  profiles: 'nav.profiles',
  hosts: 'nav.hosts',
  config: 'nav.config',
  graph: 'nav.graph',
  observe: 'nav.observe',
  execution: 'nav.execution',
  lab: 'nav.lab',
  versions: 'nav.versions',
  settings: 'nav.settings',
};

/** First path segment → nav label key; unknown routes return null so
 *  the caller renders the raw URL instead of a guessed name. */
export function routeLabelKey(url: string): string | null {
  const seg = url.replace(/^\//, '').split(/[/?#]/)[0];
  return ROUTE_LABEL_KEYS[seg] ?? null;
}

@Injectable({ providedIn: 'root' })
export class PrefsStore {
  readonly density = signal<Density>(DEFAULT_PREFS.density);
  readonly motion = signal<MotionPref>(DEFAULT_PREFS.motion);
  readonly navCollapsed = signal<boolean>(DEFAULT_PREFS.navCollapsed);
  readonly lastRoute = signal<string | null>(null);
  readonly dismissedHints = signal<readonly string[]>([]);
  readonly pageFilters = signal<Readonly<Record<string, string>>>({});

  private readonly media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');

  constructor() {
    const stored = this.read();
    if (stored) {
      this.density.set(stored.density);
      this.motion.set(stored.motion);
      this.navCollapsed.set(stored.navCollapsed);
      this.lastRoute.set(stored.lastRoute);
      this.dismissedHints.set(stored.dismissedHints);
      this.pageFilters.set(stored.pageFilters);
    }
    this.media?.addEventListener('change', () => this.apply());
    // one persistence point — any signal change rewrites the record and
    // re-applies the document attributes.
    effect(() => {
      this.persist();
      this.apply();
    });
    this.apply();
  }

  setDensity(d: Density): void {
    this.density.set(d);
  }

  setMotion(m: MotionPref): void {
    this.motion.set(m);
  }

  setNavCollapsed(v: boolean): void {
    this.navCollapsed.set(v);
  }

  /** Called by the shell on every NavigationEnd; only internal routes
   *  are recorded, and the dashboard root itself is worth recording too
   *  (returning there is still "the last area"). */
  recordRoute(url: string): void {
    if (isInternalRoute(url)) this.lastRoute.set(url);
  }

  filterFor(page: string): string {
    return this.pageFilters()[page] ?? '';
  }

  /** '' removes the key — an empty filter is absence, not a value.
   *  Read is `untracked` + no-op early return: pages call this from an
   *  effect, and a tracked read-then-write would loop forever. */
  setFilter(page: string, query: string): void {
    const current = untracked(() => this.pageFilters());
    if (query ? current[page] === query : !(page in current)) return;
    const next = { ...current };
    if (query) next[page] = query;
    else delete next[page];
    this.pageFilters.set(next);
  }

  isHintDismissed(id: string): boolean {
    return this.dismissedHints().includes(id);
  }

  dismissHint(id: string): void {
    if (untracked(() => this.isHintDismissed(id))) return;
    this.dismissedHints.set([...untracked(() => this.dismissedHints()), id]);
  }

  resetHints(): void {
    if (untracked(() => this.dismissedHints()).length === 0) return;
    this.dismissedHints.set([]);
  }

  /** Snapshot → storage. Best-effort: quota/private-mode failures are
   *  non-fatal. */
  private persist(): void {
    const store = storage();
    if (!store) return;
    const record: PortalPrefs = {
      schema: PREFS_SCHEMA,
      density: this.density(),
      motion: this.motion(),
      navCollapsed: this.navCollapsed(),
      lastRoute: this.lastRoute(),
      dismissedHints: [...this.dismissedHints()],
      pageFilters: { ...this.pageFilters() },
    };
    try {
      store.setItem(PREFS_KEY, JSON.stringify(record));
    } catch {
      // storage blocked — prefs live on in memory for this session
    }
  }

  private read(): PortalPrefs | null {
    const store = storage();
    if (!store) return null;
    try {
      const raw = store.getItem(PREFS_KEY);
      if (!raw) return null;
      return parsePrefs(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Density + motion applied as data-* on <html> — the same mechanism
   *  ThemeStore uses for scheme/forge, so the token layer stays the
   *  single place where values resolve. */
  private apply(): void {
    const el = globalThis.document?.documentElement;
    if (!el) return;
    el.dataset['density'] = this.density();
    el.dataset['motion'] = this.motion();
  }
}
