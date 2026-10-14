import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../api/api.client';
import { ApiError } from '../api/api.error';
import {
  AgentDescriptor,
  FederationSpecialist,
  McpServerDescriptor,
  SkillDescriptor,
} from '../api/api.models';
import { PortalStore } from '../portal/portal.store';

/**
 * Capability matching (spec §4.6) — answers "which agent works with X?",
 * "which skill supports Y?", "which Forja covers Z?" over REAL catalog
 * rows only.
 *
 * Scoring is deterministic token overlap (same normalization as the
 * global search): a query token hits a field when the field's normalized
 * text contains it. Each field contributes `weight × matched-fraction`
 * of the query tokens; hits carry the matched fields + values as
 * evidence plus a fixed limitations note — only catalog metadata is
 * searched, runtime capability stays unverified.
 *
 * Sources: /agents, /skills, /mcp/servers (404 = kind absent → skipped),
 * and Forjas = federation specialists + the serving Forja (bootstrap).
 * A failed source never blocks the others — the kind lands in
 * `report.unverified`.
 */
export type MatchKind = 'agent' | 'skill' | 'forge' | 'mcp';

export const MATCH_KIND_ORDER: readonly MatchKind[] = ['agent', 'skill', 'forge', 'mcp'];

/** Group header keys — reuses the command-palette kind labels. */
export const MATCH_KIND_LABEL: Record<MatchKind, string> = {
  agent: 'command.kind.agent',
  skill: 'command.kind.skill',
  forge: 'command.kind.forge',
  mcp: 'command.kind.mcp',
};

/** Every hit carries this note — catalog metadata ≠ runtime capability. */
export const MATCH_LIMITATION_KEY = 'match.limitation';

/** A searchable field on a real catalog row — `name` is the evidence
 *  label ('domains', 'role', …) and `value` the raw value. */
export interface MatchField {
  name: string;
  value: string;
  weight: number;
}

export interface MatchCandidate {
  kind: MatchKind;
  id: string;
  label: string;
  sublabel?: string;
  route: string;
  queryParams?: Record<string, string>;
  icon: string;
  fields: MatchField[];
}

export interface MatchFieldHit {
  field: string;
  value: string;
  /** Query tokens that hit this field, in query order. */
  tokens: string[];
}

export interface MatchHit {
  kind: MatchKind;
  id: string;
  label: string;
  sublabel?: string;
  route: string;
  queryParams?: Record<string, string>;
  icon: string;
  score: number;
  /** The proof: which real fields matched which query tokens. */
  hits: MatchFieldHit[];
  /** i18n key of the fixed limitations note. */
  limitationKey: string;
}

export interface MatchGroup {
  kind: MatchKind;
  hits: MatchHit[];
}

export interface MatchReport {
  groups: MatchGroup[];
  total: number;
  /** Kinds whose source failed (non-404) — data could not be verified. */
  unverified: MatchKind[];
  /** Kinds the serving Forja does not expose (404) — skipped silently. */
  absent: MatchKind[];
}

export const MATCH_DEBOUNCE_MS = 250;
const MAX_HITS = 60;

/** Same normalization as SearchService — diacritics folded. */
const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const cmpText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Query tokens — normalized, deduped, order preserved. */
export function matchTokens(query: string): string[] {
  const out: string[] = [];
  for (const tok of norm(query).split(/[^a-z0-9]+/)) {
    if (tok && !out.includes(tok)) out.push(tok);
  }
  return out;
}

/**
 * Score one candidate against query tokens. Returns `null` when no
 * token hits any field — a hit always has ≥1 evidence row.
 * Score = Σ field.weight × (matched query tokens / total query tokens).
 */
export function scoreCandidate(tokens: string[], c: MatchCandidate): MatchHit | null {
  if (tokens.length === 0) return null;
  const hits: MatchFieldHit[] = [];
  let score = 0;
  for (const f of c.fields) {
    if (!f.value) continue;
    const nv = norm(f.value);
    if (!nv) continue;
    const matched = tokens.filter((t) => nv.includes(t));
    if (matched.length === 0) continue;
    score += f.weight * (matched.length / tokens.length);
    hits.push({ field: f.name, value: f.value, tokens: matched });
  }
  if (hits.length === 0) return null;
  return {
    kind: c.kind,
    id: c.id,
    label: c.label,
    sublabel: c.sublabel,
    route: c.route,
    queryParams: c.queryParams,
    icon: c.icon,
    score,
    hits,
    limitationKey: MATCH_LIMITATION_KEY,
  };
}

/** Rank hits: score desc, kind order, normalized label, id — fully
 *  deterministic, mirrored from SearchService.rank. */
export function rankHits(hits: MatchHit[]): MatchHit[] {
  return hits
    .slice()
    .sort(
      (a, b) =>
        b.score - a.score ||
        MATCH_KIND_ORDER.indexOf(a.kind) - MATCH_KIND_ORDER.indexOf(b.kind) ||
        cmpText(norm(a.label), norm(b.label)) ||
        cmpText(a.id, b.id),
    )
    .slice(0, MAX_HITS);
}

/** Group ranked hits by kind, in MATCH_KIND_ORDER; empty kinds drop out. */
export function groupHits(hits: MatchHit[]): MatchGroup[] {
  const out: MatchGroup[] = [];
  for (const kind of MATCH_KIND_ORDER) {
    const group = hits.filter((h) => h.kind === kind);
    if (group.length) out.push({ kind, hits: group });
  }
  return out;
}

@Injectable({ providedIn: 'root' })
export class MatchService {
  private readonly api = inject(PortalApi);
  private readonly store = inject(PortalStore);

  readonly report = signal<MatchReport>({ groups: [], total: 0, unverified: [], absent: [] });
  readonly loading = signal(false);
  readonly searched = signal(false);

  private cache: { version: string; candidates: MatchCandidate[] } | null = null;
  private failed = signal<readonly MatchKind[]>([]);
  private absent = signal<readonly MatchKind[]>([]);
  private building: Promise<{
    candidates: MatchCandidate[];
    failed: MatchKind[];
    absent: MatchKind[];
  }> | null = null;
  private bump = 0;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastQuery = '';

  /** Kinds whose source could not be verified for the current report. */
  readonly unverified = computed<readonly MatchKind[]>(() =>
    MATCH_KIND_ORDER.filter((k) => this.failed().includes(k)),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  /** Debounced query entry point — same cadence as SearchService. */
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
    }, MATCH_DEBOUNCE_MS);
  }

  /** Immediate search — skips the debounce. Last call wins. */
  async searchNow(q: string): Promise<void> {
    const token = ++this.seq;
    this.lastQuery = q;
    this.searched.set(true);
    this.loading.set(true);
    try {
      const candidates = await this.ensureIndex();
      if (token !== this.seq) return;
      const tokens = matchTokens(q);
      const hits = rankHits(
        candidates.map((c) => scoreCandidate(tokens, c)).filter((h): h is MatchHit => h !== null),
      );
      const groups = groupHits(hits);
      this.report.set({
        groups,
        total: hits.length,
        unverified: MATCH_KIND_ORDER.filter((k) => this.failed().includes(k)),
        absent: MATCH_KIND_ORDER.filter((k) => this.absent().includes(k)),
      });
    } finally {
      if (token === this.seq) this.loading.set(false);
    }
  }

  /** Invalidate the cached index; re-runs the current query if one ran. */
  refresh(): void {
    this.bump++;
    this.cache = null;
    if (this.searched()) void this.searchNow(this.lastQuery);
  }

  // -- index ---------------------------------------------------------------

  private version(): string {
    return `${this.store.refreshedAt() ?? 'never'}|${this.bump}`;
  }

  private async ensureIndex(): Promise<MatchCandidate[]> {
    const v = this.version();
    if (this.cache?.version === v) return this.cache.candidates;
    this.building ??= this.buildIndex().finally(() => (this.building = null));
    const built = await this.building;
    if (this.version() !== v) return this.ensureIndex();
    this.cache = { version: v, candidates: built.candidates };
    this.failed.set(built.failed);
    this.absent.set(built.absent);
    return built.candidates;
  }

  private async buildIndex(): Promise<{
    candidates: MatchCandidate[];
    failed: MatchKind[];
    absent: MatchKind[];
  }> {
    const candidates: MatchCandidate[] = [];
    const failed = new Set<MatchKind>();
    const absent = new Set<MatchKind>();

    candidates.push(...this.forgeCandidates());

    const load = async (kind: MatchKind, loader: () => Promise<MatchCandidate[]>) => {
      try {
        candidates.push(...(await loader()));
      } catch (err) {
        // 404 / PORTAL-NOT-FOUND = this Forja does not expose the kind →
        // absent, skipped silently; anything else flags the kind
        // unverified in the report.
        if (
          err instanceof ApiError &&
          (err.status === 404 || err.body.code === 'PORTAL-NOT-FOUND')
        ) {
          absent.add(kind);
        } else {
          failed.add(kind);
        }
      }
    };

    await Promise.all([
      load('forge', async () =>
        (await firstValueFrom(this.api.federation())).specialists.map((s) =>
          this.specialistCandidate(s),
        ),
      ),
      load('agent', async () =>
        (await firstValueFrom(this.api.agents())).map((a) => this.agentCandidate(a)),
      ),
      load('skill', async () =>
        (await firstValueFrom(this.api.skills())).map((s) => this.skillCandidate(s)),
      ),
      load('mcp', async () =>
        (await firstValueFrom(this.api.mcpServers())).map((s) => this.mcpCandidate(s)),
      ),
    ]);

    return {
      candidates,
      failed: MATCH_KIND_ORDER.filter((k) => failed.has(k)),
      absent: MATCH_KIND_ORDER.filter((k) => absent.has(k)),
    };
  }

  // -- candidates ------------------------------------------------------------

  private agentCandidate(a: AgentDescriptor): MatchCandidate {
    const fields: MatchField[] = [
      { name: 'name', value: a.name || a.id, weight: 4 },
      { name: 'id', value: a.id, weight: 4 },
      { name: 'role', value: a.role, weight: 3 },
      { name: 'description', value: a.description, weight: 2 },
      { name: 'state', value: a.state, weight: 1 },
    ];
    for (const d of a.domains) fields.push({ name: 'domains', value: d, weight: 3 });
    for (const s of a.skills) fields.push({ name: 'skills', value: s, weight: 3 });
    for (const h of a.hosts) fields.push({ name: 'hosts', value: h, weight: 1 });
    if (a.authority) fields.push({ name: 'authority', value: a.authority, weight: 1 });
    return {
      kind: 'agent',
      id: a.id,
      label: a.name || a.id,
      sublabel: a.role || undefined,
      route: '/agents',
      queryParams: { q: a.name || a.id },
      icon: 'agents',
      fields,
    };
  }

  private skillCandidate(s: SkillDescriptor): MatchCandidate {
    const fields: MatchField[] = [
      { name: 'name', value: s.name || s.id, weight: 4 },
      { name: 'id', value: s.id, weight: 4 },
      { name: 'description', value: s.description, weight: 2 },
      { name: 'state', value: s.state, weight: 1 },
    ];
    if (s.domain) fields.push({ name: 'domain', value: s.domain, weight: 3 });
    for (const h of s.hosts) fields.push({ name: 'hosts', value: h, weight: 1 });
    if (s.source) fields.push({ name: 'source', value: s.source, weight: 1 });
    return {
      kind: 'skill',
      id: s.id,
      label: s.name || s.id,
      sublabel: [s.domain, s.state].filter(Boolean).join(' · ') || undefined,
      route: '/skills',
      queryParams: { q: s.name || s.id },
      icon: 'skills',
      fields,
    };
  }

  /** Federation specialist → searchable Forja row. */
  private specialistCandidate(s: FederationSpecialist): MatchCandidate {
    const fields: MatchField[] = [{ name: 'id', value: s.provider, weight: 4 }];
    if (s.cli) fields.push({ name: 'cli', value: s.cli, weight: 3 });
    if (s.state) fields.push({ name: 'state', value: s.state, weight: 1 });
    if (s.status) fields.push({ name: 'status', value: s.status, weight: 1 });
    if (typeof s.checkout === 'string') {
      fields.push({ name: 'checkout', value: s.checkout, weight: 1 });
    }
    for (const n of s.notes ?? []) fields.push({ name: 'notes', value: n, weight: 1 });
    return {
      kind: 'forge',
      id: s.provider,
      label: s.provider,
      sublabel: [s.state, s.status].filter(Boolean).join(' · ') || undefined,
      route: `/forges/${encodeURIComponent(s.provider)}`,
      icon: 'gem',
      fields,
    };
  }

  /** The serving Forja from bootstrap — searchable without any extra
   *  call; capability ids count as searchable catalog fields. */
  private forgeCandidates(): MatchCandidate[] {
    const d = this.store.descriptor();
    if (!d) return [];
    const fields: MatchField[] = [
      { name: 'name', value: d.forge_name, weight: 4 },
      { name: 'id', value: d.forge_id, weight: 4 },
      { name: 'cli', value: d.cli, weight: 3 },
    ];
    for (const c of d.capabilities) fields.push({ name: 'capabilities', value: c.id, weight: 2 });
    return [
      {
        kind: 'forge',
        id: d.forge_id,
        label: d.forge_name || d.forge_id,
        sublabel: d.forge_id,
        route: `/forges/${encodeURIComponent(d.forge_id)}`,
        icon: 'gem',
        fields,
      },
    ];
  }

  private mcpCandidate(s: McpServerDescriptor): MatchCandidate {
    const fields: MatchField[] = [
      { name: 'id', value: s.id, weight: 4 },
      { name: 'state', value: s.state, weight: 1 },
    ];
    if (s.host) fields.push({ name: 'host', value: s.host, weight: 2 });
    if (s.detail) fields.push({ name: 'detail', value: s.detail, weight: 2 });
    for (const l of s.limitations ?? []) fields.push({ name: 'limitations', value: l, weight: 1 });
    return {
      kind: 'mcp',
      id: s.id,
      label: s.id,
      sublabel: [s.state, s.host].filter(Boolean).join(' · ') || undefined,
      route: '/mcp',
      icon: 'mcp',
      fields,
    };
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
