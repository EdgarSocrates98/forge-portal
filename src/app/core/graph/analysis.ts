import { FedEdge, FedGraph, FedSource } from './federated';

/**
 * Graph Studio 2.1 §5.6 — multi-hop analysis over the canonical model.
 *
 * Pure functions over `FedGraph` — never over renderer elements — so
 * every result is deterministic, unit-testable and identical for the
 * list view, the canvas and the inspectors.
 *
 * Direction semantics follow the declared edge: `source → target` is
 * the direction the descriptor stated (`agent --associated→ skill`
 * means the agent uses the skill). `uses(x)` walks outgoing edges —
 * "what x depends on / points at"; `usedBy(x)` walks incoming edges —
 * "what points at / depends on x". Both are topological claims only:
 * no operational impact is ever inferred from topology alone.
 */

export type WalkDirection = 'out' | 'in' | 'both';

export interface Hop {
  id: string;
  /** Hop distance from the root (1 = direct neighbour). */
  dist: number;
}

export interface GraphPath {
  /** Ordered node ids, root first; null when no path exists. */
  nodes: string[] | null;
  /** Ordered edge ids parallel to nodes (one fewer). */
  edges: string[];
}

interface Adj {
  out: Map<string, FedEdge[]>;
  in: Map<string, FedEdge[]>;
  degree: Map<string, number>;
}

/** Adjacency memoized per graph instance — a rebuilt FedGraph (new
 *  identity) invalidates naturally; the page may chain several
 *  analyses over the same model and only pays the O(E) index once. */
const adjCache = new WeakMap<FedGraph, Adj>();

function adjacency(g: FedGraph): Adj {
  const cached = adjCache.get(g);
  if (cached) return cached;
  const out = new Map<string, FedEdge[]>();
  const into = new Map<string, FedEdge[]>();
  const degree = new Map<string, number>();
  for (const n of g.nodes) {
    out.set(n.id, []);
    into.set(n.id, []);
    degree.set(n.id, 0);
  }
  for (const e of g.edges) {
    out.get(e.source)?.push(e);
    into.get(e.target)?.push(e);
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const adj = { out, in: into, degree };
  adjCache.set(g, adj);
  return adj;
}

const next = (a: Adj, dir: WalkDirection, id: string): FedEdge[] =>
  dir === 'out'
    ? (a.out.get(id) ?? [])
    : dir === 'in'
      ? (a.in.get(id) ?? [])
      : [...(a.out.get(id) ?? []), ...(a.in.get(id) ?? [])];

const end = (e: FedEdge, dir: WalkDirection, from: string): string =>
  dir === 'out' ? e.target : dir === 'in' ? e.source : e.source === from ? e.target : e.source;

/**
 * Breadth-first walk from `start`. Returns the nodes in visit order
 * (root excluded) with their hop distance, and the edges traversed.
 * `maxDepth` bounds the walk; `direction` selects which edge end to
 * follow. Nodes the walk cannot reach simply never appear — absence
 * is reported, never filled in.
 */
export function bfs(
  g: FedGraph,
  start: string,
  direction: WalkDirection = 'out',
  maxDepth = Infinity,
): { nodes: Hop[]; edges: FedEdge[] } {
  const a = adjacency(g);
  const seen = new Map<string, number>([[start, 0]]);
  const used = new Map<string, FedEdge>();
  const queue: string[] = [start];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = seen.get(cur)!;
    if (d >= maxDepth) continue;
    for (const e of next(a, direction, cur)) {
      const other = end(e, direction, cur);
      if (seen.has(other)) continue;
      seen.set(other, d + 1);
      used.set(e.id, e);
      queue.push(other);
    }
  }
  seen.delete(start);
  const nodes: Hop[] = [...seen.entries()]
    .map(([id, dist]) => ({ id, dist }))
    .sort((x, y) => x.dist - y.dist || (x.id < y.id ? -1 : 1));
  const edges = [...used.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
  return { nodes, edges };
}

/** Unweighted shortest path `from → to` (BFS is optimal here — every
 *  edge has the same declared weight of one hop). Direction defaults
 *  to following declared edges; 'both' ignores direction. */
export function shortestPath(
  g: FedGraph,
  from: string,
  to: string,
  direction: WalkDirection = 'out',
): GraphPath {
  if (from === to) return { nodes: [from], edges: [] };
  const a = adjacency(g);
  const prev = new Map<string, { node: string; edge: string }>();
  const seen = new Set<string>([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const e of next(a, direction, cur)) {
      const other = end(e, direction, cur);
      if (seen.has(other)) continue;
      seen.add(other);
      prev.set(other, { node: cur, edge: e.id });
      if (other === to) {
        const nodes = [to];
        const edges: string[] = [];
        let at = to;
        while (at !== from) {
          const p = prev.get(at)!;
          edges.unshift(p.edge);
          nodes.unshift(p.node);
          at = p.node;
        }
        return { nodes, edges };
      }
      queue.push(other);
    }
  }
  return { nodes: null, edges: [] };
}

/** Undirected connected components (union-find), returned sorted by
 *  size desc then first id — deterministic regardless of input order. */
export function connectedComponents(g: FedGraph): string[][] {
  const parent = new Map<string, string>(g.nodes.map((n) => [n.id, n.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== x) {
      const p = parent.get(x)!;
      parent.set(x, r);
      x = p;
    }
    return r;
  };
  for (const e of g.edges) {
    const ra = find(e.source);
    const rb = find(e.target);
    if (ra !== rb) parent.set(ra, rb);
  }
  const comp = new Map<string, string[]>();
  for (const n of g.nodes) {
    const r = find(n.id);
    (comp.get(r) ?? comp.set(r, []).get(r)!).push(n.id);
  }
  return [...comp.values()]
    .map((c) => c.sort())
    .sort((a, b) => b.length - a.length || (a[0] < b[0] ? -1 : 1));
}

/**
 * Directed cycles as strongly connected components — iterative Tarjan
 * (no recursion, safe on deep graphs). A component reports as a cycle
 * when it has >1 node or a single node with a self-loop. Member lists
 * are sorted; the cycle list itself is sorted by first member.
 */
export function findCycles(g: FedGraph): string[][] {
  const a = adjacency(g);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;
  const selfLoop = new Set<string>();
  for (const e of g.edges) if (e.source === e.target) selfLoop.add(e.source);

  for (const root of g.nodes.map((n) => n.id)) {
    if (index.has(root)) continue;
    const work: { v: string; it: FedEdge[] }[] = [{ v: root, it: [...(a.out.get(root) ?? [])] }];
    index.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1];
      const e = top.it.shift();
      if (!e) {
        work.pop();
        if (low.get(top.v) === index.get(top.v)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== top.v);
          if (scc.length > 1 || selfLoop.has(scc[0])) cycles.push(scc.sort());
        }
        if (work.length) {
          const p = work[work.length - 1].v;
          low.set(p, Math.min(low.get(p)!, low.get(top.v)!));
        }
        continue;
      }
      const t = e.target;
      if (!index.has(t)) {
        index.set(t, counter);
        low.set(t, counter++);
        stack.push(t);
        onStack.add(t);
        work.push({ v: t, it: [...(a.out.get(t) ?? [])] });
      } else if (onStack.has(t)) {
        low.set(top.v, Math.min(low.get(top.v)!, index.get(t)!));
      }
    }
  }
  return cycles.sort((x, y) => (x[0] < y[0] ? -1 : 1));
}

/** Nodes with no incident edge — declared entities no descriptor ever
 *  related to anything else. */
export function orphans(g: FedGraph): string[] {
  const a = adjacency(g);
  return g.nodes.map((n) => n.id).filter((id) => (a.degree.get(id) ?? 0) === 0);
}

/** Every node reachable from `id` following declared direction. */
export function reachable(g: FedGraph, id: string): string[] {
  return bfs(g, id, 'out').nodes.map((h) => h.id);
}

/** What `id` uses / points at, bounded by `depth`. */
export function dependencies(
  g: FedGraph,
  id: string,
  depth: number,
): { nodes: Hop[]; edges: FedEdge[] } {
  return bfs(g, id, 'out', depth);
}

/** What depends on / points at `id`, bounded by `depth`. */
export function dependents(
  g: FedGraph,
  id: string,
  depth: number,
): { nodes: Hop[]; edges: FedEdge[] } {
  return bfs(g, id, 'in', depth);
}

export interface ImpactReport {
  root: string;
  depth: number;
  /** Nodes reachable via outgoing edges within depth — "what it uses". */
  uses: Hop[];
  /** Nodes reaching it via incoming edges — "what depends on it". */
  usedBy: Hop[];
  /** Edges traversed by either walk (deduped, sorted). */
  edges: FedEdge[];
  /** Undirected component size containing the root. */
  componentSize: number;
  /** Directed cycles (SCCs) that intersect the impacted node set. */
  cycles: string[][];
  /** True when the root has no incident edge at all. */
  orphan: boolean;
  /** Impacted nodes flagged unverified in the model. */
  unverifiedNodes: string[];
  /** Traversed edges whose evidence source did not load, or whose
   *  endpoints are unverified — "unverified relations", named. */
  unverifiedEdges: FedEdge[];
  /** Sources that did not load — the coverage gaps this report cannot
   *  see beyond (missing data, reported honestly). */
  missingSources: FedSource[];
  /** loaded sources / total sources — data coverage of the report. */
  coverage: { loaded: number; total: number };
}

/** Multi-hop topological impact around `id`. Everything is derived
 *  from declared relations only — the report carries no operational
 *  claim; callers must label it "topological". */
export function impactReport(g: FedGraph, id: string, depth = 2): ImpactReport {
  const uses = dependencies(g, id, depth);
  const usedBy = dependents(g, id, depth);
  const touched = new Map<string, FedEdge>();
  for (const e of [...uses.edges, ...usedBy.edges]) touched.set(e.id, e);
  const edges = [...touched.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const nodeSet = new Set<string>([
    id,
    ...uses.nodes.map((h) => h.id),
    ...usedBy.nodes.map((h) => h.id),
  ]);
  const comp = connectedComponents(g).find((c) => c.includes(id));
  const a = adjacency(g);
  const allCycles = findCycles(g);
  const cycles = allCycles.filter((c) => c.some((n) => nodeSet.has(n)));
  const unverifiedNodes = new Set(g.nodes.filter((n) => n.unverified).map((n) => n.id));
  const unverifiedEdges = edges.filter(
    (e) =>
      g.sources[e.evidence]?.state !== 'loaded' ||
      unverifiedNodes.has(e.source) ||
      unverifiedNodes.has(e.target),
  );
  const missingSources = (Object.keys(g.sources) as FedSource[]).filter(
    (s) => g.sources[s].state !== 'loaded',
  );
  return {
    root: id,
    depth,
    uses: uses.nodes,
    usedBy: usedBy.nodes,
    edges,
    componentSize: comp?.length ?? 1,
    cycles,
    orphan: (a.degree.get(id) ?? 0) === 0,
    unverifiedNodes: [...nodeSet].filter((n) => unverifiedNodes.has(n)).sort(),
    unverifiedEdges,
    missingSources,
    coverage: {
      loaded: (Object.keys(g.sources) as FedSource[]).length - missingSources.length,
      total: Object.keys(g.sources).length,
    },
  };
}
