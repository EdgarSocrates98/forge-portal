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

/**
 * Global search (spec §3.6) — deterministic, local-first, lazy.
 *
 * The index is built on demand (first query — never at bootstrap), cached
 * by a data version (`refreshedAt` + locale + manual bump) and rebuilt only
 * when that version changes or `refresh()` is called. Sources:
 *
 *  - pages/operations: `store.nav()` + static routes + shell actions
 *    (refresh / theme / locale) — always available, even offline.
 *  - forjas: `api.federation()` specialists (provider/state). A 404 means
 *    the serving Forja does not expose federation → the kind is skipped
 *    silently (not applicable), other failures flag the kind `unverified`.
 *  - capabilities: `store.capabilities()` (id + state).
 *  - skills / agents / mcp / hosts / known-errors: one PortalApi call each;
 *    known-errors = task receipts with `refusal` or `receipt.status != 'ok'`.
 *  - docs: `api.docsSearch(q)` per query (server-side deterministic) —
 *    never pre-fetched.
 *
 * Failure of one source never blocks the others: the failed kind is
 * flagged in `unverified()` and the rest of the results still render.
 *
 * Ranking: exact > prefix > substring; kind boost pages > forjas > others;
 * deterministic tie-break by normalized label, then id. Diacritics are
 * folded so `instalacao` matches `Instalação`.
 */
export type SearchKind =
  'page' | 'forge' | 'capability' | 'skill' | 'agent' | 'mcp' | 'host' | 'doc' | 'error';

export interface SearchResult {
  id: string;
  kind: SearchKind;
  label: string;
  sublabel?: string;
  icon: string;
  /** Internal navigation target (pages, entities, errors, in-app docs). */
  route?: string;
  /** External doc URL — opened in a new tab when present. */
  url?: string;
  /** Shell actions (refresh / theme / locale) carry a runnable closure. */
  run?: () => void;
}

interface SearchEntry extends SearchResult {
  /** normalized label — exact/prefix scoring */
  normLabel: string;
  /** normalized label + sublabel — substring scoring */
  norm: string;
}

interface BuiltIndex {
  entries: SearchEntry[];
  failed: readonly SearchKind[];
}

export const SEARCH_DEBOUNCE_MS = 250;
const MAX_RESULTS = 60;

/** Display + boost order: pages first, forjas second, all others equal. */
export const SEARCH_KIND_ORDER: readonly SearchKind[] = [
  'page',
  'forge',
  'capability',
  'skill',
  'agent',
  'mcp',
  'host',
  'doc',
  'error',
];

const KIND_RANK: Record<SearchKind, number> = {
  page: 0,
  forge: 1,
  capability: 2,
  skill: 2,
  agent: 2,
  mcp: 2,
  host: 2,
  doc: 2,
  error: 2,
};

/** i18n keys for group headers / filter chips (reported for the locales). */
export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  page: 'command.kind.page',
  forge: 'command.kind.forge',
  capability: 'command.kind.capability',
  skill: 'command.kind.skill',
  agent: 'command.kind.agent',
  mcp: 'command.kind.mcp',
  host: 'command.kind.host',
  doc: 'command.kind.doc',
  error: 'command.kind.error',
};

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
  { route: '/tasks', labelKey: 'nav.tasks', icon: 'tasks', capability: 'tasks' },
  { route: '/graph', labelKey: 'nav.graph', icon: 'graph', capability: 'graph' },
  { route: '/knowledge', labelKey: 'nav.knowledge', icon: 'knowledge' },
  { route: '/settings', labelKey: 'nav.settings', icon: 'settings' },
  { route: '/config', labelKey: 'nav.config', icon: 'settings' },
];

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
      this.results.set(this.rank(q.trim(), [...entries, ...docs]));
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
      load('error', async () => this.errorEntries(await firstValueFrom(this.api.tasks()))),
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

  // -- ranking -------------------------------------------------------------

  private rank(q: string, entries: SearchEntry[]): SearchResult[] {
    const n = norm(q);
    if (!n) {
      return entries
        .slice()
        .sort(
          (a, b) =>
            KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
            cmpText(a.normLabel, b.normLabel) ||
            cmpText(a.id, b.id),
        )
        .slice(0, MAX_RESULTS)
        .map((e) => this.strip(e));
    }
    const scored: { e: SearchEntry; s: number }[] = [];
    for (const e of entries) {
      let s = -1;
      if (e.normLabel === n) s = 0;
      else if (e.normLabel.startsWith(n)) s = 1;
      else if (e.norm.includes(n)) s = 2;
      else if (e.kind === 'doc') s = 2; // server-side hit (excerpt/path) — keep, lowest tier
      if (s >= 0) scored.push({ e, s });
    }
    scored.sort(
      (a, b) =>
        a.s - b.s ||
        KIND_RANK[a.e.kind] - KIND_RANK[b.e.kind] ||
        cmpText(a.e.normLabel, b.e.normLabel) ||
        cmpText(a.e.id, b.e.id),
    );
    return scored.slice(0, MAX_RESULTS).map((x) => this.strip(x.e));
  }

  private strip(e: SearchEntry): SearchResult {
    return {
      id: e.id,
      kind: e.kind,
      label: e.label,
      sublabel: e.sublabel,
      icon: e.icon,
      route: e.route,
      url: e.url,
      run: e.run,
    };
  }

  private mk(r: SearchResult): SearchEntry {
    return {
      ...r,
      normLabel: norm(r.label),
      norm: norm(`${r.label} ${r.sublabel ?? ''}`),
    };
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
        this.mk({
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
        this.mk({
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
      this.mk({
        id: 'act:refresh',
        kind: 'page',
        label: this.i18n.t('state.refresh'),
        icon: 'refresh',
        run: () => void this.store.refreshHealth(),
      }),
      this.mk({
        id: 'act:theme',
        kind: 'page',
        label: this.i18n.t('settings.theme'),
        icon: 'contrast',
        run: () => this.cycleTheme(),
      }),
      this.mk({
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
      this.mk({
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
    return this.mk({
      id: `forge:${s.provider}`,
      kind: 'forge',
      label: s.provider,
      sublabel: [s.state, s.status].filter(Boolean).join(' · ') || undefined,
      icon: 'gem',
      route: `/forges/${encodeURIComponent(s.provider)}`,
    });
  }

  private skillEntry(s: SkillDescriptor): SearchEntry {
    return this.mk({
      id: `skill:${s.id}`,
      kind: 'skill',
      label: s.name || s.id,
      sublabel: [s.domain, s.state].filter(Boolean).join(' · ') || undefined,
      icon: 'skills',
      route: '/skills',
    });
  }

  private agentEntry(a: AgentDescriptor): SearchEntry {
    return this.mk({
      id: `agent:${a.id}`,
      kind: 'agent',
      label: a.name || a.id,
      sublabel: a.role || undefined,
      icon: 'agents',
      route: '/agents',
    });
  }

  private mcpEntry(s: McpServerDescriptor): SearchEntry {
    return this.mk({
      id: `mcp:${s.id}`,
      kind: 'mcp',
      label: s.id,
      sublabel: [s.state, s.host].filter(Boolean).join(' · ') || undefined,
      icon: 'mcp',
      route: '/mcp',
    });
  }

  private hostEntry(h: HostDetection): SearchEntry {
    return this.mk({
      id: `host:${h.host}`,
      kind: 'host',
      label: h.host,
      sublabel: [h.integration, h.version].filter(Boolean).join(' · ') || undefined,
      icon: 'hosts',
      route: '/hosts',
    });
  }

  private docEntry(h: DocHit): SearchEntry {
    return this.mk({
      id: `doc:${h.path}`,
      kind: 'doc',
      label: h.title || h.path,
      sublabel: h.category || h.path || undefined,
      icon: 'knowledge',
      ...(h.url ? { url: h.url } : { route: '/knowledge' }),
    });
  }

  private errorEntries(tasks: TaskExecution[]): SearchEntry[] {
    return tasks
      .filter((t) => {
        if (t.refusal) return true;
        const status = t.receipt?.['status'];
        return typeof status === 'string' && status !== 'ok';
      })
      .map((t) =>
        this.mk({
          id: `err:${t.id}`,
          kind: 'error',
          label: t.refusal ?? (t.label || t.verb),
          sublabel: [t.verb, t.stage].filter(Boolean).join(' · ') || undefined,
          icon: 'alert',
          route: '/tasks',
        }),
      );
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
