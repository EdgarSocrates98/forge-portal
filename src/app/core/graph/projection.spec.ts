import {
  VIEW_SCHEMA,
  buildProjectionGraph,
  mergeViews,
  providerCounts,
  viewInfo,
} from './projection';
import { FED_GRAPH_SCHEMA } from './federated';
import { connectedComponents } from './analysis';
import { toViewModel } from './view-model';

/**
 * lf-0023 — Explorer ↔ `graph ui` parity.
 *
 * The CLI `graph ui` hands the raw `forge/ForgeGraphView/v1` document to
 * the Python studio; the portal maps the same document onto the canvas
 * model via `buildProjectionGraph`. PARITY = the model's vertex/edge id
 * set is byte-identical to the document's — nothing dropped, nothing
 * renamed, nothing invented. These tests pin that contract.
 */

const AWS_VIEW = {
  schema: VIEW_SCHEMA,
  descriptor: {
    graph_schema: 'forge/GraphDescriptor/v1',
    graph_id: 'codeintel-graph',
    provider_id: 'spark-forge-aws',
    domain: 'code',
    node_count: 4,
    edge_count: 3,
    capabilities: ['node_inspect', 'edge_inspect', 'neighbors', 'search', 'filter', 'export'],
    limitations: ['view truncated to 4 of 4000 nodes (--limit)'],
  },
  nodes: [
    {
      id: 'n1',
      kind: 'function',
      label: 'job.main',
      domain: 'code',
      source_provider: 'spark-forge-aws',
      epistemic_state: 'observed',
      attributes: { file: 'jobs/main.py', line: 12 },
    },
    {
      id: 'n2',
      kind: 'function',
      label: 'job.helper',
      domain: 'code',
      source_provider: 'spark-forge-aws',
      epistemic_state: 'observed',
      attributes: { file: 'jobs/main.py', line: 40 },
    },
    {
      id: 'n3',
      kind: 'module',
      label: 'jobs.utils',
      domain: 'code',
      source_provider: 'spark-forge-aws',
      epistemic_state: 'declared',
    },
    {
      // isolated node — no edges anywhere; must survive in the model
      id: 'n4',
      kind: 'table',
      label: 'aws_glue_catalog',
      domain: 'code',
      source_provider: 'spark-forge-aws',
      epistemic_state: 'observed',
    },
  ],
  edges: [
    {
      id: 'n1|calls|n2',
      source: 'n1',
      target: 'n2',
      kind: 'calls',
      provenance: 'observed',
      epistemic_state: 'observed',
    },
    {
      id: 'n1|imports|n3',
      source: 'n1',
      target: 'n3',
      kind: 'imports',
      provenance: 'observed',
      epistemic_state: 'observed',
    },
    {
      id: 'n2|imports|n3',
      source: 'n2',
      target: 'n3',
      kind: 'imports',
      provenance: 'observed',
      epistemic_state: 'observed',
      attributes: { weight: 2 },
      confidence: 0.9,
    },
  ],
};

const FORGE_VIEW = {
  schema: VIEW_SCHEMA,
  descriptor: {
    graph_schema: 'forge/GraphDescriptor/v1',
    graph_id: 'capability-graph',
    provider_id: 'the-forge',
    domain: 'capabilities',
    node_count: 2,
    edge_count: 1,
    capabilities: ['node_inspect', 'edge_inspect', 'neighbors', 'search', 'filter', 'export'],
    limitations: [],
  },
  nodes: [
    // deliberately reuses the aws view's node id — the merge must keep
    // both entities distinct via provider namespacing
    {
      id: 'n1',
      kind: 'capability',
      label: 'graph',
      domain: 'capabilities',
      source_provider: 'the-forge',
      epistemic_state: 'declared',
    },
    {
      id: 'm1',
      kind: 'skill',
      label: 'graph-studio',
      domain: 'capabilities',
      source_provider: 'the-forge',
      epistemic_state: 'observed',
    },
  ],
  edges: [
    {
      id: 'n1|declares|m1',
      source: 'n1',
      target: 'm1',
      kind: 'declares',
      provenance: 'declared',
      epistemic_state: 'declared',
    },
  ],
};

describe('viewInfo — contract parse', () => {
  it('reads descriptor fields and counts', () => {
    const i = viewInfo(AWS_VIEW);
    expect(i).not.toBeNull();
    expect(i!.graphId).toBe('codeintel-graph');
    expect(i!.providerId).toBe('spark-forge-aws');
    expect(i!.nodeCount).toBe(4);
    expect(i!.edgeCount).toBe(3);
    expect(i!.limitations).toEqual(['view truncated to 4 of 4000 nodes (--limit)']);
    expect(i!.merged).toBe(false);
  });

  it('rejects non-view documents instead of guessing', () => {
    expect(viewInfo(null)).toBeNull();
    expect(viewInfo({})).toBeNull();
    expect(viewInfo({ schema: 'forge/Other/v1' })).toBeNull();
    expect(viewInfo({ nodes: [] })).toBeNull();
  });
});

describe('buildProjectionGraph — vertex/edge parity with `graph ui`', () => {
  const g = buildProjectionGraph(AWS_VIEW as never, 'loaded');

  it('emits the identical node id set — every document vertex present', () => {
    expect(g.schema).toBe(FED_GRAPH_SCHEMA);
    expect(new Set(g.nodes.map((n) => n.id))).toEqual(
      new Set((AWS_VIEW.nodes as { id: string }[]).map((n) => n.id)),
    );
    expect(g.nodes.length).toBe(AWS_VIEW.nodes.length);
  });

  it('emits the identical edge id set — every document relation present', () => {
    expect(new Set(g.edges.map((e) => e.id))).toEqual(
      new Set((AWS_VIEW.edges as { id: string }[]).map((e) => e.id)),
    );
    expect(g.edges.length).toBe(AWS_VIEW.edges.length);
    for (const e of g.edges) {
      const src = (AWS_VIEW.edges as { id: string; source: string; target: string }[]).find(
        (x) => x.id === e.id,
      )!;
      expect(e.source).toBe(src.source);
      expect(e.target).toBe(src.target);
    }
  });

  it('keeps verbatim kind/label/provider provenance and attributes in meta', () => {
    const n1 = g.nodes.find((n) => n.id === 'n1')!;
    expect(n1.kind).toBe('function');
    expect(n1.label).toBe('job.main');
    expect(n1.origin).toBe('spark-forge-aws');
    expect(n1.meta?.['file']).toBe('jobs/main.py');
    expect(n1.meta?.['line']).toBe(12);
    expect(n1.meta?.['epistemic']).toBe('observed');
    expect(n1.meta?.['provider']).toBe('spark-forge-aws');
    const e = g.edges.find((x) => x.id === 'n2|imports|n3')!;
    expect(e.prov).toBe('observed');
    expect(e.epistemic).toBe('observed');
    expect(e.meta?.['confidence']).toBe(0.9);
    expect(e.meta?.['weight']).toBe(2);
  });

  it('keeps isolated nodes — lone vertices are real data, never dropped', () => {
    const n4 = g.nodes.find((n) => n.id === 'n4');
    expect(n4).toBeTruthy();
    const comps = connectedComponents(g);
    // n4 is its own component; {n1,n2,n3} is the other
    expect(comps.length).toBe(2);
    expect(comps.some((c) => c.length === 1 && c[0] === 'n4')).toBe(true);
  });

  it('flags epistemic=unknown as unverified and nothing else', () => {
    const view = {
      ...AWS_VIEW,
      nodes: [
        { id: 'a', kind: 'x', label: 'a', epistemic_state: 'unknown' },
        { id: 'b', kind: 'x', label: 'b', epistemic_state: 'inferred' },
        { id: 'c', kind: 'x', label: 'c', epistemic_state: 'observed' },
      ],
      edges: [],
    };
    const gg = buildProjectionGraph(view as never, 'loaded');
    const flag = (id: string) => gg.nodes.find((n) => n.id === id)!.unverified;
    expect(flag('a')).toBe(true);
    expect(flag('b')).toBe(false);
    expect(flag('c')).toBe(false);
  });

  it('credits only /graphs as evidence — honest single source', () => {
    expect(g.sources['graphs'].state).toBe('loaded');
    for (const n of g.nodes) expect(n.evidence).toEqual(['graphs']);
    for (const e of g.edges) expect(e.evidence).toBe('graphs');
    const vm = toViewModel(g);
    expect(vm.nodes.length).toBe(g.nodes.length);
    expect(vm.edges.length).toBe(g.edges.length);
  });
});

describe('mergeViews — federated_merge semantics (FederatedGraph/v1)', () => {
  const merged = mergeViews([FORGE_VIEW, AWS_VIEW])!;
  const g = buildProjectionGraph(merged, 'loaded');

  it('single view passes through unmodified', () => {
    const v = mergeViews([AWS_VIEW]);
    expect(v).toBe(AWS_VIEW);
  });

  it('namespaces ids per provider — same-named entities never unify', () => {
    const ids = new Set(g.nodes.map((n) => n.id));
    // both docs carry an 'n1' — the merge must keep them distinct
    expect(ids.has('spark-forge-aws:n1')).toBe(true);
    expect(ids.has('the-forge:n1')).toBe(true);
    expect(g.nodes.length).toBe(6);
    const e = g.edges.find((x) => x.id === 'the-forge:n1|declares|m1')!;
    expect(e.source).toBe('the-forge:n1');
    expect(e.target).toBe('the-forge:m1');
    expect(e.prov).toBe('the-forge/declared');
  });

  it('per-element forge provenance — origin names the emitting forge', () => {
    const counts = providerCounts(g);
    expect(counts).toEqual([
      { provider: 'spark-forge-aws', count: 4 },
      { provider: 'the-forge', count: 2 },
    ]);
  });

  it('isolated components stay isolated — no cross-forge edges invented', () => {
    const comps = connectedComponents(g);
    // one component per provider subgraph (aws has 2: {n1,n2,n3} + {n4})
    expect(comps.length).toBe(3);
    for (const e of g.edges) {
      // every edge stays inside one provider namespace
      const sp = e.source.split(':')[0];
      expect(e.target.startsWith(`${sp}:`)).toBe(true);
    }
  });

  it('is idempotent on already-namespaced ids — no double prefix', () => {
    // a merged doc re-composed with a fresh view keeps its prefixed ids
    const again = mergeViews([merged, FORGE_VIEW])!;
    const g2 = buildProjectionGraph(again, 'loaded');
    const ids = new Set(g2.nodes.map((n) => n.id));
    expect(ids.has('spark-forge-aws:n1')).toBe(true);
    expect(ids.has('the-forge:n1')).toBe(true);
    // no `the-forge:the-forge:` or `the-forge:spark-forge-aws:` leakage
    for (const id of ids) expect(id.startsWith('the-forge:the-forge:')).toBe(false);
    expect(ids.has('the-forge:spark-forge-aws:n1')).toBe(false);
  });
});
