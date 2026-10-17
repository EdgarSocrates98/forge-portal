import { FedEdgeKind, FedGraph, FedNode, FedNodeKind } from './federated';
import { GraphEdgeView, GraphNodeShape, GraphNodeView, GraphViewModel } from './renderer';

/**
 * §5.6 — FedGraph → canvas view model.
 *
 * Pure presentation mapping: every node keeps the fields the honest
 * model carries (id, label, kind, evidence) plus two derived flags —
 * `unverified` straight from the node, `absent` when every endpoint
 * that references it stayed `unavailable` (a stronger dim, never a
 * new invented field). Kinds get a distinct color *and* shape so the
 * canvas never encodes meaning in color alone.
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

export const EDGE_STYLE: Record<FedEdgeKind, { color: string }> = {
  declares: { color: '#7d8894' },
  origin: { color: '#1d5fd1' },
  associated: { color: '#7c3aed' },
  bound_to: { color: '#0f8a4c' },
};

/** True when the node is unverified *and* every endpoint in its
 *  evidence stayed unavailable — the model's strongest "not there"
 *  signal. Unavailable sources emit no entities of their own, so this
 *  only fires for reference-only nodes whose referrers all failed. */
export function isAbsent(n: FedNode, g: FedGraph): boolean {
  return n.unverified && n.evidence.every((s) => g.sources[s]?.state === 'unavailable');
}

export function toViewModel(g: FedGraph): GraphViewModel {
  const nodes: GraphNodeView[] = g.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    kind: n.kind,
    unverified: n.unverified,
    absent: isAbsent(n, g),
  }));
  const edges: GraphEdgeView[] = g.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    kind: e.kind,
    evidence: e.evidence,
  }));
  return { nodes, edges };
}
