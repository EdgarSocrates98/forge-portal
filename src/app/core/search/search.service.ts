import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../api/api.client';
import { ApiError } from '../api/api.error';
import {
  AgentDescriptor,
  DocHit,
  FederationSpecialist,
  HostDetection,
  McpServerDescriptor,
  SkillDescriptor,
  TaskExecution,
} from '../api/api.models';
import { I18nService } from '../i18n/i18n.service';
import { PortalStore } from '../portal/portal.store';
import { ThemeStore } from '../theme/theme.store';
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_KIND_ORDER,
  SearchEntry,
  SearchKind,
  SearchResult,
  makeSearchEntry,
  rankSearchEntries,
} from './search.data';

// The data contract lives in `search.data.ts` (pure, spec'd there);
// re-exported so existing consumers keep one import site.
export {
  MAX_SEARCH_RESULTS,
  SEARCH_DEBOUNCE_MS,
  SEARCH_KIND_LABEL,
  SEARCH_KIND_ORDER,
  normalizeSearchText,
  rankSearchEntries,
} from './search.data';
export type { SearchEntry, SearchKind, SearchResult } from './search.data';

/**
 * Global search (§3.6 + Cycle 5 §8.1) — deterministic, local-first,
 * lazy. The async shell around `search.data.ts`: it owns source
 * loading, caching and debounce; indexing + ranking stay pure.
 *
 * The index is built on demand (first query — never at bootstrap),
 * cached by a data version (`refreshedAt` + locale + manual bump) and
 * rebuilt only when that version changes or `refresh()` is called.
 * Sources — one per real endpoint, all read-only:
 *
 *  - pages/operations: `store.nav()` + static routes + shell actions
 *    (refresh / theme / locale) — always available, even offline.
 *  - forjas: `api.federation()` specialists (provider/state). A 404
 *    means the serving Forja does not expose federation → the kind is
 *    skipped silently (not applicable), other failures flag the kind
 *    `unverified`.
 *  - capabilities: `store.capabilities()` (id + state).
 *  - skills / agents / mcp / hosts: one PortalApi call each.
 *  - operations + known-errors: `api.tasks()` — every task indexes as
 *    an operation; tasks with `refusal` or `receipt.status != 'ok'`
 *    additionally index as known errors.
 *  - docs: `api.docsSearch(q)` per query (server-side deterministic) —
 *    never pre-fetched.
 *
 * Failure of one source never blocks the others: the failed kind is
 * flagged in `unverified()` and the rest of the results still render.
 */
interface BuiltIndex {
  entries: SearchEntry[];
  failed: readonly SearchKind[];
}

/** Static routes — also the offline fallback when `store.nav()` is empty.
 *  Includes the control-center routes landing from sibling agents
 *  (`/forges`, `/config`); `capability` mirrors the old palette gate. */
const STATIC_PAGES: { route: string; labelKey: string; icon: string; capability?: string }[] = [
  { route: '/dashboard', labelKey: 'nav.dashboard', icon: 'dashboard' },
  { route: '/install', labelKey: 'nav.install', icon: 'install' },
  { route: '/federation', labelKey: 'nav.federation', icon: 'network' },
  { route: '/forges', labelKey: 'nav.forges', icon: 'gem' },
  { route: '/profiles', labelKey: 'nav.profiles', icon: 'profiles' },
  { route: '/hosts', labelKey: 'nav.hosts', icon: 'hosts' },
  { route: '/mcp', labelKey: 'nav.mcp', icon: 'mcp' },
  { route: '/skills', labelKey: 'nav.skills', icon: 'skills' },
  { route: '/agents', labelKey: 'nav.agents', icon: 'agents' },
  { route: '/match', labelKey: 'nav.match', icon: 'compass' },
  { route: '/tasks', labelKey: 'nav.tasks', icon: 'tasks', capability: 'tasks' },
  { route: '/graph', labelKey: 'nav.graph', icon: 'graph', capability: 'graph' },
  { route: '/observe', labelKey: 'nav.observe', icon: 'pulse' },
  { route: '/lab', labelKey: 'nav.lab', icon: 'diff' },
  { route: '/versions', labelKey: 'nav.versions', icon: 'history' },
  { route: '/knowledge', labelKey: 'nav.knowledge', icon: 'knowledge' },
  { route: '/settings', labelKey: 'nav.settings', icon: 'settings' },
  { route: '/config', labelKey: 'nav.config', icon: 'settings' },
];

@Injectable({ providedIn: 'root' })
export class SearchService {
  private readonly api = inject(PortalApi);
  private readonly store = inject(PortalStore);
  private readonly theme = inject(ThemeStore);
  private readonly i18n = inject(I18nService);

  /** Flat, already-ranked results for the last executed query. */
  readonly results = signal<SearchResult[]>([]);
  /** True while the index builds or a docs query is in flight. */
  readonly loading = signal(false);
  /** True once at least one search executed (gates the empty state). */
  readonly searched = signal(false);

  private readonly indexFailures = signal<readonly SearchKind[]>([]);
  private readonly docsFailed = signal(false);

  /** Kinds whose source could not be verified for the current results. */
  readonly unverified = computed<readonly SearchKind[]>(() => {
    const failed = new Set<SearchKind>(this.indexFailures());
    if (this.docsFailed()) failed.add('doc');
    return SEARCH_KIND_ORDER.filter((k) => failed.has(k));
  });

  private cache: { version: string; entries: SearchEntry[] } | null = null;
  private building: Promise<BuiltIndex> | null = null;
  private bump = 0;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastQuery = '';

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  /**
   * Debounced entry point used by the palette input. A blank query runs
   * immediately (opening the palette must feel instant); non-blank queries
   * wait `SEARCH_DEBOUNCE_MS` so each keystroke does not hit `/docs/search`.
   */
  setQuery(q: string): void {
    this.lastQuery = q;
    this.clearTimer();
    if (!q.trim()) {
      void this.searchNow('');
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.searchNow(q);
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Immediate search — skips the debounce. Last call wins. */
  async searchNow(q: string): Promise<void> {
    const token = ++this.seq;
    this.lastQuery = q;
    this.searched.set(true);
    this.loading.set(true);
    try {
      const entries = await this.ensureIndex();
      const docs = q.trim() ? await this.fetchDocs(q.trim(), token) : [];
      if (token !== this.seq) return;
      this.results.set(rankSearchEntries(q.trim(), [...entries, ...docs]));
    } finally {
      if (token === this.seq) this.loading.set(false);
    }
  }

  /** Invalidate the cached index; re-runs the current query if one ran. */
  refresh(): void {
    this.bump++;
    this.cache = null;
    this.docsFailed.set(false);
    if (this.searched()) void this.searchNow(this.lastQuery);
  }

  // -- index ---------------------------------------------------------------

  private version(): string {
    return `${this.store.refreshedAt() ?? 'never'}|${this.i18n.locale()}|${this.bump}`;
  }

  private async ensureIndex(): Promise<SearchEntry[]> {
    const v = this.version();
    if (this.cache?.version === v) return this.cache.entries;
    this.building ??= this.buildIndex().finally(() => (this.building = null));
    const built = await this.building;
    if (this.version() !== v) return this.ensureIndex(); // stale build — retry once per version change
    this.cache = { version: v, entries: built.entries };
    this.indexFailures.set(built.failed);
    return built.entries;
  }

  private async buildIndex(): Promise<BuiltIndex> {
    const entries: SearchEntry[] = [];
    const failed = new Set<SearchKind>();

    try {
      entries.push(...this.pageEntries());
    } catch {
      failed.add('page');
    }
    try {
      entries.push(...this.capabilityEntries());
    } catch {
      failed.add('capability');
    }

    const load = async (kind: SearchKind, loader: () => Promise<SearchEntry[]>) => {
      try {
        entries.push(...(await loader()));
      } catch (err) {
        // 404 = this Forja does not expose the kind → skip silently;
        // any other failure leaves the kind flagged as unverified.
        if (!(err instanceof ApiError && err.status === 404)) failed.add(kind);
      }
    };

    await Promise.all([
      load('forge', async () =>
        (await firstValueFrom(this.api.federation())).specialists.map((s) => this.forgeEntry(s)),
      ),
      load('skill', async () =>
        (await firstValueFrom(this.api.skills())).map((s) => this.skillEntry(s)),
      ),
      load('agent', async () =>
        (await firstValueFrom(this.api.agents())).map((a) => this.agentEntry(a)),
      ),
      load('mcp', async () =>
        (await firstValueFrom(this.api.mcpServers())).map((s) => this.mcpEntry(s)),
      ),
      load('host', async () =>
        (await firstValueFrom(this.api.hosts())).map((h) => this.hostEntry(h)),
      ),
      // one call feeds both task-derived kinds; a failure flags both.
      (async () => {
        try {
          entries.push(...this.taskEntries(await firstValueFrom(this.api.tasks())));
        } catch (err) {
          if (!(err instanceof ApiError && err.status === 404)) {
            failed.add('operation');
            failed.add('error');
          }
        }
      })(),
    ]);

    return { entries, failed: SEARCH_KIND_ORDER.filter((k) => failed.has(k)) };
  }

  private async fetchDocs(q: string, token: number): Promise<SearchEntry[]> {
    try {
      const hits = await firstValueFrom(this.api.docsSearch(q));
      if (token === this.seq) this.docsFailed.set(false);
      return hits.map((h) => this.docEntry(h));
    } catch (err) {
      if (token === this.seq) this.docsFailed.set(!(err instanceof ApiError && err.status === 404));
      return [];
    }
  }

  // -- sources -------------------------------------------------------------

  private capVisible(capability: string | undefined): boolean {
    if (!capability) return true;
    const caps = this.store.capabilities();
    if (caps.length === 0) return true; // catalog unverified → show, never hide
    return caps.some((c) => c.id === capability && c.state !== 'unsupported');
  }

  private pageEntries(): SearchEntry[] {
    const out: SearchEntry[] = [];
    const seen = new Set<string>();
    for (const item of this.store.nav()) {
      if (!item.route || seen.has(item.route) || !this.capVisible(item.requires_capability)) {
        continue;
      }
      seen.add(item.route);
      out.push(
        makeSearchEntry({
          id: `page:${item.route}`,
          kind: 'page',
          label: this.i18n.t(item.label_key),
          sublabel: item.route,
          icon: item.icon || 'dashboard',
          route: item.route,
        }),
      );
    }
    for (const p of STATIC_PAGES) {
      if (seen.has(p.route) || !this.capVisible(p.capability)) continue;
      seen.add(p.route);
      out.push(
        makeSearchEntry({
          id: `page:${p.route}`,
          kind: 'page',
          label: this.i18n.t(p.labelKey),
          sublabel: p.route,
          icon: p.icon,
          route: p.route,
        }),
      );
    }
    out.push(
      makeSearchEntry({
        id: 'act:refresh',
        kind: 'page',
        label: this.i18n.t('state.refresh'),
        icon: 'refresh',
        run: () => void this.store.refreshHealth(),
      }),
      makeSearchEntry({
        id: 'act:theme',
        kind: 'page',
        label: this.i18n.t('settings.theme'),
        icon: 'contrast',
        run: () => this.cycleTheme(),
      }),
      makeSearchEntry({
        id: 'act:locale',
        kind: 'page',
        label: this.i18n.t('settings.language'),
        icon: 'globe',
        run: () => this.toggleLocale(),
      }),
    );
    return out;
  }

  private capabilityEntries(): SearchEntry[] {
    return this.store.capabilities().map((c) =>
      makeSearchEntry({
        id: `cap:${c.id}`,
        kind: 'capability',
        label: c.label_key ? this.i18n.t(c.label_key) : c.id,
        sublabel: c.state,
        icon: 'shield-check',
        route: '/dashboard',
      }),
    );
  }

  private forgeEntry(s: FederationSpecialist): SearchEntry {
    return makeSearchEntry({
      id: `forge:${s.provider}`,
      kind: 'forge',
      label: s.provider,
      sublabel: [s.state, s.status].filter(Boolean).join(' · ') || undefined,
      icon: 'gem',
      route: `/forges/${encodeURIComponent(s.provider)}`,
    });
  }

  private skillEntry(s: SkillDescriptor): SearchEntry {
    return makeSearchEntry({
      id: `skill:${s.id}`,
      kind: 'skill',
      label: s.name || s.id,
      sublabel: [s.domain, s.state].filter(Boolean).join(' · ') || undefined,
      icon: 'skills',
      route: '/skills',
    });
  }

  private agentEntry(a: AgentDescriptor): SearchEntry {
    return makeSearchEntry({
      id: `agent:${a.id}`,
      kind: 'agent',
      label: a.name || a.id,
      sublabel: a.role || undefined,
      icon: 'agents',
      route: '/agents',
    });
  }

  private mcpEntry(s: McpServerDescriptor): SearchEntry {
    return makeSearchEntry({
      id: `mcp:${s.id}`,
      kind: 'mcp',
      label: s.id,
      sublabel: [s.state, s.host].filter(Boolean).join(' · ') || undefined,
      icon: 'mcp',
      route: '/mcp',
    });
  }

  private hostEntry(h: HostDetection): SearchEntry {
    return makeSearchEntry({
      id: `host:${h.host}`,
      kind: 'host',
      label: h.host,
      sublabel: [h.integration, h.version].filter(Boolean).join(' · ') || undefined,
      icon: 'hosts',
      route: '/hosts',
    });
  }

  /** §8.1 — every recorded task is an operation; the subset carrying a
   *  refusal or a non-ok receipt additionally indexes as a known error. */
  private taskEntries(tasks: TaskExecution[]): SearchEntry[] {
    const out: SearchEntry[] = [];
    for (const t of tasks) {
      out.push(
        makeSearchEntry({
          id: `op:${t.id}`,
          kind: 'operation',
          label: t.label || t.verb,
          sublabel: [t.verb, t.stage].filter(Boolean).join(' · ') || undefined,
          icon: 'tasks',
          route: '/tasks',
        }),
      );
      const status = t.receipt?.['status'];
      if (t.refusal || (typeof status === 'string' && status !== 'ok')) {
        out.push(
          makeSearchEntry({
            id: `err:${t.id}`,
            kind: 'error',
            label: t.refusal ?? (t.label || t.verb),
            sublabel: [t.verb, t.stage].filter(Boolean).join(' · ') || undefined,
            icon: 'alert',
            route: '/tasks',
          }),
        );
      }
    }
    return out;
  }

  private docEntry(h: DocHit): SearchEntry {
    return makeSearchEntry({
      id: `doc:${h.path}`,
      kind: 'doc',
      label: h.title || h.path,
      sublabel: h.category || h.path || undefined,
      icon: 'knowledge',
      ...(h.url ? { url: h.url } : { route: '/knowledge' }),
    });
  }

  // -- actions -------------------------------------------------------------

  private cycleTheme(): void {
    const next =
      this.theme.scheme() === 'system'
        ? 'light'
        : this.theme.scheme() === 'light'
          ? 'dark'
          : 'system';
    this.theme.setScheme(next);
  }

  private toggleLocale(): void {
    void this.i18n.applyPreference(this.i18n.locale() === 'pt-BR' ? 'en' : 'pt-BR');
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
