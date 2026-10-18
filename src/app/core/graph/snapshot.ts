import { FedEdge, FedGraph, FedNode } from './federated';
import { GraphDiffMarks } from './renderer';

/**
 * Graph Studio 2.1 §5.10 — topology snapshots and diff.
 *
 * The adapter/backend exposes no historical graph states, so the only
 * honest second sample is one the user took: `captureSnapshot` freezes
 * the canonical FedGraph (real state at a real user action time) into
 * localStorage; `diffSnapshots` compares it against the live model.
 *
 * Diff semantics, all derived — never invented:
 *  - added / removed   — id presence delta
 *  - changed           — same id, different kind/label/unverified/
 *    evidence/state (edges: kind or evidence)
 * Removed elements have no canvas presence — the canvas always shows
 * current truth; removals are listed in the diff panel only.
 */

export const GRAPH_SNAPSHOT_KEY = 'forge-portal/graph-snapshot/v1';
export const GRAPH_SNAPSHOT_SCHEMA = 'forge-portal/GraphSnapshot/v1';

interface SnapNode {
  id: string;
  kind: string;
  label: string;
  unverified: boolean;
  evidence: string[];
  state?: string;
  origin?: string;
}

interface SnapEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  evidence: string;
}

export interface GraphSnapshot {
  schema: typeof GRAPH_SNAPSHOT_SCHEMA;
  /** ISO stamp of the user action that took the snapshot — real. */
  capturedAt: string;
  nodes: SnapNode[];
  edges: SnapEdge[];
}

export interface GraphDiff {
  snapshot: string; // capturedAt of the compared snapshot
  addedNodes: SnapNode[];
  removedNodes: SnapNode[];
  changedNodes: { id: string; before: SnapNode; after: SnapNode }[];
  addedEdges: SnapEdge[];
  removedEdges: SnapEdge[];
  changedEdges: { id: string; before: SnapEdge; after: SnapEdge }[];
  unchanged: boolean;
}

const snapNode = (n: FedNode): SnapNode => ({
  id: n.id,
  kind: n.kind,
  label: n.label,
  unverified: n.unverified,
  evidence: [...n.evidence],
  ...(n.state !== undefined ? { state: n.state } : {}),
  ...(n.origin !== undefined ? { origin: n.origin } : {}),
});

const snapEdge = (e: FedEdge): SnapEdge => ({
  id: e.id,
  source: e.source,
  target: e.target,
  kind: e.kind,
  evidence: e.evidence,
});

/** Freeze the live model. `at` is passed in by the caller — the action
 *  timestamp is real event data, so it is the caller's clock, taken at
 *  click time, not a hidden side channel. */
export function captureSnapshot(g: FedGraph, at: string): GraphSnapshot {
  return {
    schema: GRAPH_SNAPSHOT_SCHEMA,
    capturedAt: at,
    nodes: g.nodes.map(snapNode),
    edges: g.edges.map(snapEdge),
  };
}

const eq = (a: SnapNode, b: SnapNode): boolean =>
  a.kind === b.kind &&
  a.label === b.label &&
  a.unverified === b.unverified &&
  a.state === b.state &&
  a.origin === b.origin &&
  a.evidence.join(',') === b.evidence.join(',');

const eqEdge = (a: SnapEdge, b: SnapEdge): boolean =>
  a.kind === b.kind && a.evidence === b.evidence;

export function diffSnapshots(prev: GraphSnapshot, cur: FedGraph): GraphDiff {
  const curNodes = new Map(cur.nodes.map((n) => [n.id, snapNode(n)]));
  const curEdges = new Map(cur.edges.map((e) => [e.id, snapEdge(e)]));
  const prevNodes = new Map(prev.nodes.map((n) => [n.id, n]));
  const prevEdges = new Map(prev.edges.map((e) => [e.id, e]));

  const addedNodes = [...curNodes.values()].filter((n) => !prevNodes.has(n.id));
  const removedNodes = [...prevNodes.values()].filter((n) => !curNodes.has(n.id));
  const changedNodes = [...curNodes.values()]
    .filter((n) => prevNodes.has(n.id) && !eq(prevNodes.get(n.id)!, n))
    .map((n) => ({ id: n.id, before: prevNodes.get(n.id)!, after: n }));
  const addedEdges = [...curEdges.values()].filter((e) => !prevEdges.has(e.id));
  const removedEdges = [...prevEdges.values()].filter((e) => !curEdges.has(e.id));
  const changedEdges = [...curEdges.values()]
    .filter((e) => prevEdges.has(e.id) && !eqEdge(prevEdges.get(e.id)!, e))
    .map((e) => ({ id: e.id, before: prevEdges.get(e.id)!, after: e }));

  return {
    snapshot: prev.capturedAt,
    addedNodes,
    removedNodes,
    changedNodes,
    addedEdges,
    removedEdges,
    changedEdges,
    unchanged:
      !addedNodes.length &&
      !removedNodes.length &&
      !changedNodes.length &&
      !addedEdges.length &&
      !removedEdges.length &&
      !changedEdges.length,
  };
}

/** Canvas overlay marks — only added/changed elements still exist on
 *  the canvas, so only they get marks. */
export function diffMarks(d: GraphDiff): GraphDiffMarks {
  const nodes = new Map<string, 'added' | 'changed'>();
  for (const n of d.addedNodes) nodes.set(n.id, 'added');
  for (const n of d.changedNodes) nodes.set(n.id, 'changed');
  const edges = new Map<string, 'added' | 'changed'>();
  for (const e of d.addedEdges) edges.set(e.id, 'added');
  for (const e of d.changedEdges) edges.set(e.id, 'changed');
  return { nodes, edges };
}

/** Tolerant storage read — foreign/corrupt payloads return null. */
export function loadSnapshot(storage: Pick<Storage, 'getItem'> | null): GraphSnapshot | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GRAPH_SNAPSHOT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o?.['schema'] !== GRAPH_SNAPSHOT_SCHEMA) return null;
    if (!Array.isArray(o['nodes']) || !Array.isArray(o['edges'])) return null;
    if (typeof o['capturedAt'] !== 'string') return null;
    return o as unknown as GraphSnapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(
  storage: Pick<Storage, 'setItem'> | null,
  snap: GraphSnapshot,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(GRAPH_SNAPSHOT_KEY, JSON.stringify(snap));
    return true;
  } catch {
    return false;
  }
}

export function clearSnapshot(storage: Pick<Storage, 'removeItem'> | null): void {
  try {
    storage?.removeItem(GRAPH_SNAPSHOT_KEY);
  } catch {
    /* best-effort */
  }
}
