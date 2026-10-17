/**
 * Unified search — pure, deterministic core (Cycle 5 §8.1).
 *
 * Everything in this file is a pure function or constant over plain
 * data: no DI, no HTTP, no clock. `SearchService` owns the async part
 * (one PortalApi call per real source); this module owns what a result
 * IS and how it ranks, so the contract is unit-testable end to end.
 *
 * Indexed kinds and their only sources — an entity enters the index
 * exclusively through a real endpoint answer, never inferred:
 *
 *   kind          source
 *   ------------  --------------------------------------------------
 *   page          store.nav() + static routes + shell actions
 *   forge         GET /api/v1/federation  (specialists[].provider)
 *   capability    store.capabilities()    (descriptor catalog)
 *   skill         GET /api/v1/skills
 *   agent         GET /api/v1/agents
 *   mcp           GET /api/v1/mcp/servers
 *   host          GET /api/v1/hosts
 *   operation     GET /api/v1/tasks       (every recorded task)
 *   doc           GET /api/v1/docs/search (server-side, per query)
 *   error         GET /api/v1/tasks       (refusal / non-ok receipts)
 *
 * Ranking (documented, deterministic):
 *   score 0 — normalized label equals the query
 *   score 1 — normalized label starts with the query
 *   score 2 — label + sublabel contains the query as a substring
 *   score 2 — doc hits always land here (the server already matched
 *             them against excerpt/path, not the title)
 * Ties break by kind boost (pages first, forjas second, all others
 * equal), then by normalized label, then by id — a total order, so a
 * query always yields the same list for the same index. Diacritics are
 * folded so `instalacao` matches `Instalação`.
 */
export type SearchKind =
  | 'page'
  | 'forge'
  | 'capability'
  | 'skill'
  | 'agent'
  | 'mcp'
  | 'host'
  | 'operation'
  | 'doc'
  | 'error';

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

/** A result plus the normalized fields ranking scores on. */
export interface SearchEntry extends SearchResult {
  /** normalized label — exact/prefix scoring */
  normLabel: string;
  /** normalized label + sublabel — substring scoring */
  norm: string;
}

export const SEARCH_DEBOUNCE_MS = 250;
export const MAX_SEARCH_RESULTS = 60;

/** Display + boost order: pages first, forjas second, all others equal. */
export const SEARCH_KIND_ORDER: readonly SearchKind[] = [
  'page',
  'forge',
  'capability',
  'skill',
  'agent',
  'mcp',
  'host',
  'operation',
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
  operation: 2,
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
  operation: 'command.kind.operation',
  doc: 'command.kind.doc',
  error: 'command.kind.error',
};

/** Diacritic-folding, whitespace-collapsing normalization. */
export const normalizeSearchText = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const cmpSearchText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Build the scorable form of a result — the only way into an index. */
export function makeSearchEntry(r: SearchResult): SearchEntry {
  return {
    ...r,
    normLabel: normalizeSearchText(r.label),
    norm: normalizeSearchText(`${r.label} ${r.sublabel ?? ''}`),
  };
}

/**
 * Score one entry against a normalized query. Returns the tier
 * (0 exact, 1 prefix, 2 substring/server-matched) or -1 for no match.
 */
export function scoreEntry(e: SearchEntry, normalizedQuery: string): number {
  if (e.normLabel === normalizedQuery) return 0;
  if (e.normLabel.startsWith(normalizedQuery)) return 1;
  if (e.norm.includes(normalizedQuery)) return 2;
  // server-side hit (excerpt/path) — keep, lowest tier
  if (e.kind === 'doc') return 2;
  return -1;
}

const strip = (e: SearchEntry): SearchResult => ({
  id: e.id,
  kind: e.kind,
  label: e.label,
  sublabel: e.sublabel,
  icon: e.icon,
  route: e.route,
  url: e.url,
  run: e.run,
});

/**
 * Rank `entries` for `query`: blank query returns the whole index in
 * kind/label/id order (the palette's opening state); otherwise scored
 * tiers then the deterministic tie-break chain. Always capped at
 * `max` — a flat list the palette can navigate by keyboard.
 */
export function rankSearchEntries(
  query: string,
  entries: readonly SearchEntry[],
  max = MAX_SEARCH_RESULTS,
): SearchResult[] {
  const n = normalizeSearchText(query);
  if (!n) {
    return entries
      .slice()
      .sort(
        (a, b) =>
          KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
          cmpSearchText(a.normLabel, b.normLabel) ||
          cmpSearchText(a.id, b.id),
      )
      .slice(0, max)
      .map(strip);
  }
  const scored: { e: SearchEntry; s: number }[] = [];
  for (const e of entries) {
    const s = scoreEntry(e, n);
    if (s >= 0) scored.push({ e, s });
  }
  scored.sort(
    (a, b) =>
      a.s - b.s ||
      KIND_RANK[a.e.kind] - KIND_RANK[b.e.kind] ||
      cmpSearchText(a.e.normLabel, b.e.normLabel) ||
      cmpSearchText(a.e.id, b.e.id),
  );
  return scored.slice(0, max).map((x) => strip(x.e));
}
