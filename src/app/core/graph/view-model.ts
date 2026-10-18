import { FedEdgeKind, FedGraph, FedNode, FedNodeKind, SOURCE_ENDPOINT } from './federated';
import {
  GraphDetailTier,
  GraphEdgeView,
  GraphGrouping,
  GraphNodeShape,
  GraphNodeView,
  GraphViewModel,
} from './renderer';

/**
 * §5.6 / Graph Studio 2.1 — FedGraph → canvas view model.
 *
 * Pure presentation mapping: every node keeps the fields the honest
 * model carries (id, label, kind, evidence, state, category, origin,
 * version) plus derived flags — `unverified` straight from the node,
 * `absent` when every endpoint that references it stayed `unavailable`,
 * `failed` when the descriptor state is failure-shaped, `degree` as
 * the real incident-edge count. Edge `evidenceState` mirrors the
 * declaring endpoint's availability so relation confidence is drawn
 * as line style, never a color-only cue.
 */

export const KIND_STYLE: Record<FedNodeKind, { color: string; shape: GraphNodeShape }> = {
  forge: { color: '#e8611c', shape: 'round-rectangle' },
  capability: { color: '#1d5fd1', shape: 'diamond' },
  skill: { color: '#7c3aed', shape: 'ellipse' },
  agent: { color: '#0f8a4c', shape: 'hexagon' },
  mcp: { color: '#c026d3', shape: 'triangle' },
  host: { color: '#64748b', shape: 'rectangle' },
  operation: { color: '#b45309', shape: 'star' },
};

/** Per-kind icon names — resolved through `iconPath` (icon.ts), the
 *  same set the DOM icon component paints. */
export const KIND_ICON: Record<FedNodeKind, string> = {
  forge: 'gem',
  capability: 'shield-check',
  skill: 'skills',
  agent: 'agents',
  mcp: 'mcp',
  host: 'hosts',
  operation: 'tasks',
};

export const EDGE_STYLE: Record<FedEdgeKind, { color: string }> = {
  declares: { color: '#7d8894' },
  origin: { color: '#1d5fd1' },
  associated: { color: '#7c3aed' },
  bound_to: { color: '#0f8a4c' },
};

/** Relation confidence → line style. The model only carries declared
 *  relations (evidence = the endpoint that declared them); what varies
 *  is whether that endpoint loaded. 'derived' edges do not exist in
 *  this model — nothing is inferred. */
export const EDGE_LINE: Record<string, 'solid' | 'dashed' | 'dotted'> = {
  loaded: 'solid',
  unverified: 'dashed',
  unavailable: 'dotted',
};

/** States that read as failures — verbatim descriptor states plus the
 *  task exit-code signal. Everything else stays neutral, never
 *  "probably broken" guessing. */
const FAILED_STATES = new Set(['FAILED', 'DEGRADED', 'BLOCKED', 'failed', 'error']);

export function isFailed(n: FedNode): boolean {
  if (n.state && FAILED_STATES.has(n.state)) return true;
  const code = n.meta?.['exit_code'];
  return typeof code === 'number' && code !== 0;
}

/** True when the node is unverified *and* every endpoint in its
 *  evidence stayed unavailable — the model's strongest "not there"
 *  signal. Unavailable sources emit no entities of their own, so this
 *  only fires for reference-only nodes whose referrers all failed. */
export function isAbsent(n: FedNode, g: FedGraph): boolean {
  return n.unverified && n.evidence.every((s) => g.sources[s]?.state === 'unavailable');
}

export function toViewModel(g: FedGraph): GraphViewModel {
  const degree = new Map<string, number>();
  for (const e of g.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes: GraphNodeView[] = g.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    unverified: n.unverified,
    absent: isAbsent(n, g),
    failed: isFailed(n),
    degree: degree.get(n.id) ?? 0,
    ...(n.state !== undefined ? { state: n.state } : {}),
    ...(n.category !== undefined ? { category: n.category } : {}),
    ...(n.origin !== undefined ? { origin: n.origin } : {}),
    ...(n.version !== undefined ? { version: n.version } : {}),
  }));
  const edges: GraphEdgeView[] = g.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    kind: e.kind,
    evidence: e.evidence,
    evidenceState: g.sources[e.evidence]?.state ?? 'unverified',
    evidenceEndpoint: SOURCE_ENDPOINT[e.evidence],
  }));
  return { nodes, edges };
}

/**
 * Zoom-tier label composition. Canvas paint, not template text — kept
 * out of i18n on purpose (glyph density, not prose). Each tier only
 * ever adds REAL fields; absent data leaves the line out entirely.
 */
export function tierLabel(n: GraphNodeView, tier: GraphDetailTier): string {
  if (tier === 'far') return n.label;
  const l2 = [n.state, n.category ?? n.origin, n.version]
    .filter((x): x is string => typeof x === 'string' && x !== '')
    .join(' · ');
  if (tier === 'mid') return l2 ? `${n.label}\n${l2}` : n.label;
  const l3 = `${n.degree} rel`;
  return l2 ? `${n.label}\n${l2}\n${l3}` : `${n.label}\n${l3}`;
}

export type GraphGroupBy = 'kind' | 'forge' | 'host';

/**
 * Compound-group spec over the canonical model. Membership comes only
 * from declared fields — `origin`/`bound_to`/kind — so a group is
 * provenance, not a guess. 'unscoped' buckets nodes with no declared
 * membership; it is labelled as such, never silently attached.
 */
export function groupingFor(g: FedGraph, by: GraphGroupBy): GraphGrouping {
  const groups = new Map<string, string[]>();
  const put = (gid: string, id: string) => {
    const l = groups.get(gid);
    if (l) l.push(id);
    else groups.set(gid, [id]);
  };
  for (const n of g.nodes) {
    if (by === 'kind') {
      put(`grp:kind:${n.kind}`, n.id);
    } else if (by === 'forge') {
      if (n.kind === 'forge') continue; // forges are the anchors
      put(`grp:forge:${n.origin ?? 'unscoped'}`, n.id);
    } else {
      // host grouping: only real bindings — mcp category is the bound
      // host id; host nodes are the anchors, everything else ungrouped.
      if (n.kind === 'mcp' && n.category) put(`grp:host:${n.category}`, n.id);
    }
  }
  const label = (gid: string): string => gid.slice(gid.indexOf(':', 4) + 1);
  return {
    groups: [...groups.entries()]
      .map(([id, members]) => ({ id, label: label(id), members: members.sort() }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    collapsed: new Set<string>(),
  };
}
