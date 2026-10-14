import {
  AgentDescriptor,
  HostDetection,
  McpServerDescriptor,
  PortalCapability,
  SkillDescriptor,
  TaskExecution,
} from '../api/api.models';

/**
 * §5.6 — Federated Graph Studio model builder.
 *
 * The portal never runs a graph engine (§7.2): each Forja's own engine
 * stays authoritative and ships `ForgeGraphView/v1` views through
 * `/graphs`. What the studio composes here is a *federation overlay* —
 * one deterministic graph where every node is a real entity observed on
 * a real adapter op and every edge is a relation a descriptor actually
 * declared (never inferred, never guessed):
 *
 *   forge → capability   `declares`   (serving Forja's own catalog)
 *   skill/agent → forge  `origin`     (descriptor-carried origin only)
 *   agent → skill        `associated` (agent's declared skills list)
 *   mcp → host           `bound_to`   (server's host binding)
 *   task → forge         `origin`     (descriptor-carried origin only)
 *
 * Forge nodes are mined from the graph views themselves — each view's
 * `descriptor.provider_id` and every node's `source_provider` name a
 * real producer. View payloads are not re-mapped: they stay rendered as
 * the per-Forja views list, the overlay only credits their providers.
 *
 * Honesty rules:
 * - `evidence` records which endpoint supplied/referenced the entity;
 *   the `sources` map resolves each to its `GET /api/v1/…` label.
 * - `unverified` marks entities no loaded endpoint could confirm (their
 *   source was unavailable/unverified) plus descriptors that self-report
 *   `state: 'unverified'`. Nodes render dashed/muted — never hidden.
 * - Edge endpoints that no endpoint described directly still get a node
 *   (the reference itself is real data) whose evidence names only the
 *   referring endpoint.
 * - Fully deterministic: sorted output, id dedupe, no clock, no random.
 */

export const FED_GRAPH_SCHEMA = 'forge/FederatedGraph/v1';

export type FedNodeKind = 'forge' | 'capability' | 'skill' | 'agent' | 'mcp' | 'host' | 'operation';

/** Canonical display/order for kinds — fixed, not alphabetical. */
export const FED_NODE_KINDS: readonly FedNodeKind[] = [
  'forge',
  'capability',
  'skill',
  'agent',
  'mcp',
  'host',
  'operation',
];

/** One builder input field (and one adapter op) per source. `bootstrap`
 *  covers the serving-Forja descriptor the store already loaded. */
export type FedSource =
  'bootstrap' | 'graphs' | 'capabilities' | 'skills' | 'agents' | 'mcp' | 'hosts' | 'tasks';

export const FED_SOURCES: readonly FedSource[] = [
  'bootstrap',
  'graphs',
  'capabilities',
  'skills',
  'agents',
  'mcp',
  'hosts',
  'tasks',
];

export const SOURCE_ENDPOINT: Record<FedSource, string> = {
  bootstrap: 'GET /api/v1/bootstrap',
  graphs: 'GET /api/v1/graphs',
  capabilities: 'GET /api/v1/capabilities',
  skills: 'GET /api/v1/skills',
  agents: 'GET /api/v1/agents',
  mcp: 'GET /api/v1/mcp/servers',
  hosts: 'GET /api/v1/hosts',
  tasks: 'GET /api/v1/tasks',
};

export type SourceAvailability = 'loaded' | 'unverified' | 'unavailable';

export interface FedNode {
  /** `${kind}:${entity id}` — kind namespaces the id so entities from
   *  different ops can never collide silently. */
  id: string;
  kind: FedNodeKind;
  label: string;
  /** Endpoints that supplied or referenced this entity — sorted. */
  evidence: FedSource[];
  /** True when no loaded endpoint supplied it, or the descriptor itself
   *  reports `state: 'unverified'`. Rendered dashed/muted in the studio. */
  unverified: boolean;
}

export type FedEdgeKind = 'declares' | 'origin' | 'associated' | 'bound_to';

export interface FedEdge {
  /** `${source}|${kind}|${target}` — same shape as ForgeGraphView edges. */
  id: string;
  source: string;
  target: string;
  kind: FedEdgeKind;
  /** The single endpoint that declared this relation. */
  evidence: FedSource;
}

export interface FedSourceInfo {
  state: SourceAvailability;
  endpoint: string;
}

export interface FedGraph {
  schema: typeof FED_GRAPH_SCHEMA;
  nodes: FedNode[]; // sorted by id, deduped
  edges: FedEdge[]; // sorted by id, deduped
  counts: Record<FedNodeKind, number>;
  sources: Record<FedSource, FedSourceInfo>;
}

export interface FederatedInput {
  capabilities?: readonly PortalCapability[] | null;
  skills?: readonly SkillDescriptor[] | null;
  agents?: readonly AgentDescriptor[] | null;
  mcp?: readonly McpServerDescriptor[] | null;
  hosts?: readonly HostDetection[] | null;
  tasks?: readonly TaskExecution[] | null;
  /** `ForgeGraphView/v1` documents from `GET /api/v1/graphs`. */
  graphViews?: readonly Record<string, unknown>[] | null;
  /** `descriptor.forge_id` of the serving Forja (bootstrap payload). */
  servingForge?: string | null;
  /** Per-source availability observed while loading; absent keys fall
   *  back to `'loaded'` when data is present, `'unavailable'` otherwise. */
  availability?: Partial<Record<FedSource, SourceAvailability>>;
}

/** Direct neighbors of `id` — the simple impact view: the node itself,
 *  every node one edge away, and those edges (already sorted). */
export function nodeNeighbors(
  graph: FedGraph,
  id: string,
): { nodes: Set<string>; edges: FedEdge[] } {
  const edges = graph.edges.filter((e) => e.source === id || e.target === id);
  const nodes = new Set<string>([id]);
  for (const e of edges) {
    nodes.add(e.source);
    nodes.add(e.target);
  }
  return { nodes, edges };
}

// ------------------------------------------------------------------
// internals
// ------------------------------------------------------------------

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The ForgeId union as runtime data — lets an ambiguous `source:`
 *  field resolve to a forge only when it really names one. */
const KNOWN_FORGE_IDS: ReadonlySet<string> = new Set([
  'the-forge',
  'api-forge',
  'spark-forge-aws',
  'spark-forge-azure',
  'platform-forge',
  'forge-doctor-data',
  'forge-doctor-api',
]);

/** Raw keys that unambiguously mean "the Forja this entity came from". */
const ORIGIN_KEYS = ['origin', 'forge', 'forge_id', 'provider', 'source_provider'] as const;

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** The descriptor's declared origin Forja — or null. `source:` is only
 *  accepted when it names a forge we already know (an observed provider
 *  or a catalog id); 'catalog'-style provenance labels never become
 *  forges — that would be guessing. */
function originOf(raw: Record<string, unknown>, knownForges: ReadonlySet<string>): string | null {
  for (const key of ORIGIN_KEYS) {
    const v = text(raw[key]);
    if (v) return v;
  }
  const src = text(raw['source']);
  if (src && (KNOWN_FORGE_IDS.has(src) || knownForges.has(src))) return src;
  return null;
}

interface NodeAcc {
  label: string;
  kind: FedNodeKind;
  evidence: Set<FedSource>;
  /** Descriptor-level `state === 'unverified'`. */
  flagged: boolean;
}

export function buildFederatedGraph(input: FederatedInput): FedGraph {
  const availability = {} as Record<FedSource, SourceAvailability>;
  for (const s of FED_SOURCES) {
    const declared = input.availability?.[s];
    if (declared) {
      availability[s] = declared;
    } else if (s === 'bootstrap') {
      availability[s] = text(input.servingForge) ? 'loaded' : 'unverified';
    } else {
      const data =
        s === 'capabilities'
          ? input.capabilities
          : s === 'skills'
            ? input.skills
            : s === 'agents'
              ? input.agents
              : s === 'mcp'
                ? input.mcp
                : s === 'hosts'
                  ? input.hosts
                  : s === 'tasks'
                    ? input.tasks
                    : input.graphViews;
      availability[s] = data != null ? 'loaded' : 'unavailable';
    }
  }

  const nodes = new Map<string, NodeAcc>();
  const edges = new Map<string, FedEdge>();
  const knownForges = new Set<string>();

  function addNode(
    kind: FedNodeKind,
    entityId: string,
    label: string,
    evidence: FedSource,
    flagged = false,
  ): string {
    const id = `${kind}:${entityId}`;
    const acc = nodes.get(id);
    if (acc) {
      acc.evidence.add(evidence);
      acc.flagged ||= flagged;
    } else {
      nodes.set(id, { label, kind, evidence: new Set([evidence]), flagged });
    }
    return id;
  }

  function addForge(forgeId: string, evidence: FedSource): string {
    knownForges.add(forgeId);
    return addNode('forge', forgeId, forgeId, evidence);
  }

  /** Referenced-but-undescribed endpoint still gets a node — the
   *  reference is real data; its evidence names only the referrer.
   *  When the node already exists the referrer joins its evidence. */
  function ensureNode(id: string, evidence: FedSource): void {
    if (nodes.has(id)) {
      nodes.get(id)!.evidence.add(evidence);
      return;
    }
    const cut = id.indexOf(':');
    const kind = id.slice(0, cut) as FedNodeKind;
    addNode(kind, id.slice(cut + 1), id.slice(cut + 1), evidence);
  }

  function addEdge(source: string, target: string, kind: FedEdgeKind, evidence: FedSource): void {
    ensureNode(source, evidence);
    ensureNode(target, evidence);
    const id = `${source}|${kind}|${target}`;
    if (!edges.has(id)) edges.set(id, { id, source, target, kind, evidence });
  }

  // -- forges: serving Forja first (bootstrap), then every provider a
  //    real graph view credits (descriptor.provider_id + per-node
  //    source_provider). Populates `knownForges` before origin probes.
  const serving = text(input.servingForge);
  if (serving) addForge(serving, 'bootstrap');

  for (const view of input.graphViews ?? []) {
    if (!view || typeof view !== 'object') continue;
    const desc = view['descriptor'];
    const pid =
      desc && typeof desc === 'object'
        ? text((desc as Record<string, unknown>)['provider_id'])
        : null;
    if (pid) addForge(pid, 'graphs');
    const vnodes = view['nodes'];
    if (Array.isArray(vnodes)) {
      for (const n of vnodes) {
        const sp =
          n && typeof n === 'object'
            ? text((n as Record<string, unknown>)['source_provider'])
            : null;
        if (sp) addForge(sp, 'graphs');
      }
    }
  }

  // -- capabilities: the serving Forja's own catalog → declares edges.
  for (const c of input.capabilities ?? []) {
    const id = text(c?.id);
    if (!id) continue;
    addNode('capability', id, id, 'capabilities', c.state === 'unverified');
    if (serving) addEdge(`forge:${serving}`, `capability:${id}`, 'declares', 'capabilities');
  }

  // -- skills
  for (const s of input.skills ?? []) {
    const id = text(s?.id) ?? text(s?.name);
    if (!id) continue;
    addNode('skill', id, text(s?.name) ?? id, 'skills', s.state === 'unverified');
    const origin = originOf(s as unknown as Record<string, unknown>, knownForges);
    if (origin) addEdge(`skill:${id}`, `forge:${origin}`, 'origin', 'skills');
  }

  // -- agents: own node, origin edge, and one edge per declared skill.
  const skillByName = new Map<string, string[]>();
  for (const s of input.skills ?? []) {
    const name = text(s?.name);
    const id = text(s?.id);
    if (name && id) {
      const list = skillByName.get(name) ?? [];
      list.push(id);
      skillByName.set(name, list);
    }
  }
  const skillRef = (ref: string): string => {
    if (nodes.has(`skill:${ref}`)) return `skill:${ref}`;
    const candidates = skillByName.get(ref);
    if (candidates?.length) return `skill:${[...candidates].sort(cmp)[0]}`;
    return `skill:${ref}`; // stub — resolved or not, the reference is real
  };
  for (const a of input.agents ?? []) {
    const id = text(a?.id) ?? text(a?.name);
    if (!id) continue;
    addNode('agent', id, text(a?.name) ?? id, 'agents', a.state === 'unverified');
    const origin = originOf(a as unknown as Record<string, unknown>, knownForges);
    if (origin) addEdge(`agent:${id}`, `forge:${origin}`, 'origin', 'agents');
    const seen = new Set<string>();
    for (const ref of a.skills ?? []) {
      const name = text(ref);
      if (!name || seen.has(name)) continue;
      seen.add(name);
      addEdge(`agent:${id}`, skillRef(name), 'associated', 'agents');
    }
  }

  // -- mcp servers → host binding when the descriptor carries one.
  for (const m of input.mcp ?? []) {
    const id = text(m?.id);
    if (!id) continue;
    addNode('mcp', id, id, 'mcp');
    const host = text(m.host);
    if (host) addEdge(`mcp:${id}`, `host:${host}`, 'bound_to', 'mcp');
  }

  // -- hosts
  for (const h of input.hosts ?? []) {
    const id = text(h?.host);
    if (!id) continue;
    addNode('host', id, id, 'hosts');
  }

  // -- tasks (operations) → origin forge when declared.
  for (const t of input.tasks ?? []) {
    const id = text(t?.id);
    if (!id) continue;
    const label = text(t?.label) ?? text(t?.verb) ?? id;
    addNode('operation', id, label, 'tasks');
    const origin = originOf(t as unknown as Record<string, unknown>, knownForges);
    if (origin) addEdge(`operation:${id}`, `forge:${origin}`, 'origin', 'tasks');
  }

  // -- finalize: sorted, deduped, unverified resolved from evidence.
  const outNodes: FedNode[] = [...nodes.entries()]
    .map(([id, acc]) => {
      const evidence = [...acc.evidence].sort(cmp);
      return {
        id,
        kind: acc.kind,
        label: acc.label,
        evidence,
        unverified: acc.flagged || !evidence.some((s) => availability[s] === 'loaded'),
      };
    })
    .sort((a, b) => cmp(a.id, b.id));

  const outEdges: FedEdge[] = [...edges.values()].sort((a, b) => cmp(a.id, b.id));

  const counts = Object.fromEntries(FED_NODE_KINDS.map((k) => [k, 0])) as Record<
    FedNodeKind,
    number
  >;
  for (const n of outNodes) counts[n.kind] += 1;

  const sources = {} as Record<FedSource, FedSourceInfo>;
  for (const s of FED_SOURCES)
    sources[s] = { state: availability[s], endpoint: SOURCE_ENDPOINT[s] };

  return { schema: FED_GRAPH_SCHEMA, nodes: outNodes, edges: outEdges, counts, sources };
}
