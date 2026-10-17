import { AgentDescriptor } from '../../core/api/api.models';
import {
  FED_NODE_KINDS,
  FedEdge,
  FedGraph,
  FedNodeKind,
  originOf,
} from '../../core/graph/federated';

/**
 * Agent Studio derivations — pure functions over already-fetched
 * payloads (same contract as dashboard `ops.data.ts`). Nothing here
 * invents a field: a filter option only exists when a descriptor
 * really carries the value, and the Forja filter probes the *declared*
 * origin keys on the raw descriptor — adapters that do not declare an
 * origin per agent produce the explicit `UNDECLARED` bucket, never a
 * guessed attribution.
 */

/** Filter value for agents whose descriptors declare no origin Forja. */
export const UNDECLARED = '__undeclared__';

export const normText = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** The Forja the descriptor itself names as origin — `origin`, `forge`,
 *  `forge_id`, `provider`, `source_provider` (and `source` only when it
 *  names a known Forja). Null when the adapter declares none; the
 *  serving Forja is NEVER substituted here — serving is catalog
 *  provenance, not per-agent origin. */
export function declaredForge(
  a: AgentDescriptor,
  knownForges: ReadonlySet<string> = new Set(),
): string | null {
  return originOf(a as unknown as Record<string, unknown>, knownForges);
}

export interface AgentFilters {
  query: string;
  domain: string | null;
  skill: string | null;
  host: string | null;
  /** A declared origin id, UNDECLARED, or null = no forge filter. */
  forge: string | null;
}

export const NO_FILTERS: AgentFilters = {
  query: '',
  domain: null,
  skill: null,
  host: null,
  forge: null,
};

export function filterAgents(
  agents: readonly AgentDescriptor[],
  f: AgentFilters,
  knownForges: ReadonlySet<string> = new Set(),
): AgentDescriptor[] {
  const q = normText(f.query);
  return agents.filter((a) => {
    if (f.domain !== null && !a.domains.includes(f.domain)) return false;
    if (f.skill !== null && !a.skills.includes(f.skill)) return false;
    if (f.host !== null && !a.hosts.includes(f.host)) return false;
    if (f.forge !== null) {
      const declared = declaredForge(a, knownForges);
      if (f.forge === UNDECLARED ? declared !== null : declared !== f.forge) return false;
    }
    if (!q) return true;
    const hay = [
      a.id,
      a.name,
      a.role,
      a.description,
      a.authority ?? '',
      ...a.domains,
      ...a.skills,
      ...a.hosts,
    ]
      .map(normText)
      .join(' ');
    return hay.includes(q);
  });
}

/** Sorted unique values across one list field — options are mined from
 *  the catalog, never hardcoded. */
function uniqValues(agents: readonly AgentDescriptor[], pick: (a: AgentDescriptor) => string[]) {
  const set = new Set<string>();
  for (const a of agents) for (const v of pick(a)) set.add(v);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export const domainOptions = (agents: readonly AgentDescriptor[]): string[] =>
  uniqValues(agents, (a) => a.domains);

export const skillOptions = (agents: readonly AgentDescriptor[]): string[] =>
  uniqValues(agents, (a) => a.skills);

export const hostOptions = (agents: readonly AgentDescriptor[]): string[] =>
  uniqValues(agents, (a) => a.hosts);

export interface ForgeOptions {
  /** Declared origins observed on at least one descriptor — sorted. */
  declared: string[];
  /** At least one agent declares no origin → the UNDECLARED option shows. */
  hasUndeclared: boolean;
}

export function forgeOptions(
  agents: readonly AgentDescriptor[],
  knownForges: ReadonlySet<string> = new Set(),
): ForgeOptions {
  const declared = new Set<string>();
  let hasUndeclared = false;
  for (const a of agents) {
    const f = declaredForge(a, knownForges);
    if (f) declared.add(f);
    else hasUndeclared = true;
  }
  return { declared: [...declared].sort((a, b) => a.localeCompare(b)), hasUndeclared };
}

// ------------------------------------------------------------------
// side-by-side comparison — only fields the descriptor really carries
// ------------------------------------------------------------------

export interface CompareCell {
  /** Display text, or null → "not declared". */
  text: string | null;
  /** True when the descriptor carried no value (null/empty/absent). */
  absent: boolean;
}

export interface CompareRow {
  /** i18n key for the field label. */
  key: string;
  a: CompareCell;
  b: CompareCell;
  /** Both sides declared and values differ → highlight. */
  differ: boolean;
}

const cell = (v: string | null | undefined): CompareCell => ({
  text: v && v.trim() ? v : null,
  absent: !(v && v.trim()),
});

const listCell = (v: readonly string[]): CompareCell => ({
  text: v.length ? v.join(', ') : null,
  absent: v.length === 0,
});

/**
 * Field-by-field comparison of two agents. Rows exist for every real
 * `AgentDescriptor` field plus the declared origin probe; a descriptor
 * that lacks the value renders "not declared", never a synthesized
 * default. `differ` is only computed when BOTH sides declared a value —
 * absent-vs-present is a fact about coverage, not a value difference.
 */
export function compareAgents(
  a: AgentDescriptor,
  b: AgentDescriptor,
  knownForges: ReadonlySet<string> = new Set(),
): CompareRow[] {
  const fields: { key: string; va: CompareCell; vb: CompareCell }[] = [
    { key: 'table.id', va: cell(a.id), vb: cell(b.id) },
    { key: 'agents.role', va: cell(a.role), vb: cell(b.role) },
    { key: 'agents.responsibility', va: cell(a.description), vb: cell(b.description) },
    { key: 'agents.authority', va: cell(a.authority), vb: cell(b.authority) },
    {
      key: 'agents.origin',
      va: cell(declaredForge(a, knownForges)),
      vb: cell(declaredForge(b, knownForges)),
    },
    { key: 'agents.domains', va: listCell(a.domains), vb: listCell(b.domains) },
    { key: 'agents.skills', va: listCell(a.skills), vb: listCell(b.skills) },
    { key: 'agents.compatibleHosts', va: listCell(a.hosts), vb: listCell(b.hosts) },
    { key: 'skills.state', va: cell(a.state), vb: cell(b.state) },
  ];
  return fields.map(({ key, va, vb }) => ({
    key,
    a: va,
    b: vb,
    differ: !va.absent && !vb.absent && va.text !== vb.text,
  }));
}

// ------------------------------------------------------------------
// agent subgraph — a filtered projection of the real FedGraph
// ------------------------------------------------------------------

/**
 * Agent-centric projection of a `FedGraph` that already exists: keep the
 * agent nodes whose entity ids are in `keep`, every edge touching a kept
 * agent (agent→skill `associated`, agent→forge `origin` — only relations
 * the descriptors really declared), and both endpoints of those edges.
 * The sources/availability strip is preserved verbatim — a stub skill
 * node stays unverified, exactly as in the full graph. No edges are
 * synthesized; kinds/counts are recomputed from the kept set.
 */
export function agentSubgraph(fed: FedGraph, keep: ReadonlySet<string>): FedGraph {
  const isKeptAgent = (nodeId: string): boolean =>
    nodeId.startsWith('agent:') && keep.has(nodeId.slice('agent:'.length));
  const nodeIds = new Set<string>();
  const edges: FedEdge[] = fed.edges.filter((e) => {
    if (!isKeptAgent(e.source) && !isKeptAgent(e.target)) return false;
    nodeIds.add(e.source);
    nodeIds.add(e.target);
    return true;
  });
  const nodes = fed.nodes.filter((n) =>
    n.kind === 'agent' ? keep.has(n.id.slice(6)) : nodeIds.has(n.id),
  );
  const counts = Object.fromEntries(FED_NODE_KINDS.map((k) => [k, 0])) as Record<
    FedNodeKind,
    number
  >;
  for (const n of nodes) counts[n.kind] += 1;
  return { ...fed, nodes, edges, counts };
}
