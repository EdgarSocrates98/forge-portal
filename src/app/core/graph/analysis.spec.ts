import {
  bfs,
  connectedComponents,
  dependents,
  dependencies,
  findCycles,
  impactReport,
  orphans,
  reachable,
  shortestPath,
} from './analysis';
import { FED_GRAPH_SCHEMA, FedGraph } from './federated';

/**
 * Pure multi-hop analysis over the canonical FedGraph — the same
 * functions drive the list, the canvas highlight and the inspector,
 * so the contract is "one implementation, one truth".
 */

function graph(nodes: string[], edges: [string, string][]): FedGraph {
  const kinds = new Map(nodes.map((id) => [id, id.split(':')[0]]));
  return {
    schema: FED_GRAPH_SCHEMA,
    nodes: nodes.sort().map((id) => ({
      id,
      kind: kinds.get(id) as FedGraph['nodes'][number]['kind'],
      label: id,
      evidence: ['agents'],
      unverified: false,
    })),
    edges: edges
      .map(([source, target]) => ({
        id: `${source}|associated|${target}`,
        source,
        target,
        kind: 'associated' as const,
        evidence: 'agents' as const,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
    counts: {} as FedGraph['counts'],
    sources: {
      bootstrap: { state: 'loaded', endpoint: 'GET /api/v1/bootstrap' },
      graphs: { state: 'loaded', endpoint: 'GET /api/v1/graphs' },
      capabilities: { state: 'loaded', endpoint: 'GET /api/v1/capabilities' },
      skills: { state: 'loaded', endpoint: 'GET /api/v1/skills' },
      agents: { state: 'loaded', endpoint: 'GET /api/v1/agents' },
      mcp: { state: 'loaded', endpoint: 'GET /api/v1/mcp/servers' },
      hosts: { state: 'loaded', endpoint: 'GET /api/v1/hosts' },
      tasks: { state: 'loaded', endpoint: 'GET /api/v1/tasks' },
    },
  };
}

// a→b→c chain, a→d side branch, lone orphan, x↔y cycle with y→z tail
const G = graph(
  ['a', 'b', 'c', 'd', 'lone', 'x', 'y', 'z'],
  [
    ['a', 'b'],
    ['b', 'c'],
    ['a', 'd'],
    ['x', 'y'],
    ['y', 'x'],
    ['y', 'z'],
  ],
);

describe('graph analysis — traversal', () => {
  it('bfs returns hop distances in visit order and respects direction', () => {
    const out = bfs(G, 'a', 'out');
    expect(out.nodes).toEqual([
      { id: 'b', dist: 1 },
      { id: 'd', dist: 1 },
      { id: 'c', dist: 2 },
    ]);
    expect(out.edges.map((e) => e.id)).toEqual([
      'a|associated|b',
      'a|associated|d',
      'b|associated|c',
    ]);
    // incoming walk from c reaches b then a
    const back = bfs(G, 'c', 'in');
    expect(back.nodes).toEqual([
      { id: 'b', dist: 1 },
      { id: 'a', dist: 2 },
    ]);
  });

  it('bfs honours maxDepth and treats both direction as undirected', () => {
    expect(bfs(G, 'a', 'out', 1).nodes.map((h) => h.id)).toEqual(['b', 'd']);
    expect(bfs(G, 'a', 'out', 0).nodes).toEqual([]);
    const both = bfs(G, 'b', 'both');
    expect(both.nodes.map((h) => h.id).sort()).toEqual(['a', 'c', 'd']);
  });

  it('shortestPath finds the minimal hop chain or reports none', () => {
    const p = shortestPath(G, 'a', 'c');
    expect(p.nodes).toEqual(['a', 'b', 'c']);
    expect(p.edges).toEqual(['a|associated|b', 'b|associated|c']);
    // unreachable downstream-only: c has no outgoing edges
    expect(shortestPath(G, 'c', 'a').nodes).toBeNull();
    // undirected finds the way back
    expect(shortestPath(G, 'c', 'a', 'both').nodes).toEqual(['c', 'b', 'a']);
    // identity path
    expect(shortestPath(G, 'a', 'a')).toEqual({ nodes: ['a'], edges: [] });
    // across components
    expect(shortestPath(G, 'a', 'lone').nodes).toBeNull();
  });

  it('connectedComponents groups by reachability, largest first', () => {
    const comps = connectedComponents(G);
    expect(comps.length).toBe(3);
    expect(comps[0].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(comps[1].sort()).toEqual(['x', 'y', 'z']);
    expect(comps[2]).toEqual(['lone']);
  });

  it('findCycles reports strongly connected components, not tails', () => {
    const cycles = findCycles(G);
    expect(cycles).toEqual([['x', 'y']]);
    // self-loop counts as a cycle
    const loop = graph(['s'], [['s', 's']]);
    expect(findCycles(loop)).toEqual([['s']]);
    // a pure DAG has none
    expect(findCycles(graph(['p', 'q'], [['p', 'q']]))).toEqual([]);
  });

  it('dependencies/dependents follow declared direction, reachable covers all hops', () => {
    expect(dependencies(G, 'a', 1).nodes.map((h) => h.id)).toEqual(['b', 'd']);
    expect(dependents(G, 'c', 10).nodes.map((h) => h.id)).toEqual(['b', 'a']);
    expect(reachable(G, 'x').sort()).toEqual(['y', 'z']);
    expect(reachable(G, 'lone')).toEqual([]);
  });

  it('orphans lists degree-0 nodes only', () => {
    expect(orphans(G)).toEqual(['lone']);
  });
});

describe('graph analysis — impactReport', () => {
  it('composes uses/usedBy/component/coverage honestly', () => {
    const r = impactReport(G, 'b', 2);
    expect(r.uses.map((h) => h.id)).toEqual(['c']);
    expect(r.usedBy.map((h) => h.id)).toEqual(['a']);
    expect(r.componentSize).toBe(4);
    expect(r.orphan).toBe(false);
    expect(r.coverage).toEqual({ loaded: 8, total: 8 });
    expect(r.missingSources).toEqual([]);
    expect(r.cycles).toEqual([]);
  });

  it('names unverified relations and missing sources without hiding them', () => {
    const g = graph(['a', 'b', 'c'], [['a', 'b']]);
    g.nodes = g.nodes.map((n) => (n.id === 'b' ? { ...n, unverified: true } : n));
    g.sources = {
      ...g.sources,
      tasks: { state: 'unavailable', endpoint: 'GET /api/v1/tasks' },
    };
    const r = impactReport(g, 'a', 2);
    expect(r.unverifiedNodes).toEqual(['b']);
    expect(r.unverifiedEdges.map((e) => e.id)).toEqual(['a|associated|b']);
    expect(r.missingSources).toEqual(['tasks']);
    expect(r.coverage).toEqual({ loaded: 7, total: 8 });
  });

  it('marks orphans and edges with unverified evidence honestly', () => {
    const r = impactReport(G, 'lone', 3);
    expect(r.orphan).toBe(true);
    expect(r.componentSize).toBe(1);
    expect(r.uses).toEqual([]);
    expect(r.usedBy).toEqual([]);
    // cycles touching the impacted set surface — x/y cycle does not
    expect(r.cycles).toEqual([]);
  });

  it('includes cycles that intersect the impacted node set', () => {
    const r = impactReport(G, 'x', 2);
    expect(r.cycles).toEqual([['x', 'y']]);
  });
});
