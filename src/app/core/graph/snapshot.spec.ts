import { FED_GRAPH_SCHEMA, FedGraph, FedNode } from './federated';
import {
  GRAPH_SNAPSHOT_KEY,
  captureSnapshot,
  diffMarks,
  diffSnapshots,
  loadSnapshot,
  saveSnapshot,
} from './snapshot';

const node = (id: string, over: Partial<FedNode> = {}): FedNode => ({
  id,
  kind: 'skill',
  label: id,
  evidence: ['skills'],
  unverified: false,
  ...over,
});

function g(nodes: FedNode[], edges: FedGraph['edges'] = []): FedGraph {
  return {
    schema: FED_GRAPH_SCHEMA,
    nodes: [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1)),
    edges: [...edges].sort((a, b) => (a.id < b.id ? -1 : 1)),
    counts: {} as FedGraph['counts'],
    sources: {} as FedGraph['sources'],
  };
}

const EDGE = {
  id: 'skill:a|associated|skill:b',
  source: 'skill:a',
  target: 'skill:b',
  kind: 'associated' as const,
  evidence: 'agents' as const,
};

describe('graph snapshot — capture and diff', () => {
  it('captures the canonical model fields that matter for diffing', () => {
    const snap = captureSnapshot(
      g([node('skill:a', { state: 'available', origin: 'the-forge' })], [EDGE]),
      '2026-10-20T00:00:00Z',
    );
    expect(snap.schema).toBe('forge-portal/GraphSnapshot/v1');
    expect(snap.capturedAt).toBe('2026-10-20T00:00:00Z');
    expect(snap.nodes[0]).toMatchObject({ id: 'skill:a', state: 'available', origin: 'the-forge' });
    expect(snap.edges[0].kind).toBe('associated');
  });

  it('diffs added/removed/changed nodes and edges', () => {
    const before = g(
      [node('skill:a'), node('skill:b', { state: 'available' }), node('skill:gone')],
      [EDGE],
    );
    const snap = captureSnapshot(before, '2026-10-20T00:00:00Z');
    const after = g(
      [
        node('skill:a'),
        node('skill:b', { state: 'installed' }), // changed
        node('skill:new'), // added
      ],
      [{ ...EDGE, evidence: 'skills' }],
    );
    const d = diffSnapshots(snap, after);
    expect(d.unchanged).toBe(false);
    expect(d.addedNodes.map((n) => n.id)).toEqual(['skill:new']);
    expect(d.removedNodes.map((n) => n.id)).toEqual(['skill:gone']);
    expect(d.changedNodes.map((c) => c.id)).toEqual(['skill:b']);
    expect(d.changedNodes[0].before.state).toBe('available');
    expect(d.changedNodes[0].after.state).toBe('installed');
    expect(d.changedEdges.map((c) => c.id)).toEqual([EDGE.id]);
    expect(d.addedEdges).toEqual([]);
    expect(d.removedEdges).toEqual([]);
  });

  it('identical graphs produce an unchanged diff with no marks', () => {
    const cur = g([node('skill:a'), node('skill:b')], [EDGE]);
    const snap = captureSnapshot(cur, '2026-10-20T00:00:00Z');
    const d = diffSnapshots(snap, cur);
    expect(d.unchanged).toBe(true);
    const marks = diffMarks(d);
    expect(marks.nodes.size).toBe(0);
    expect(marks.edges.size).toBe(0);
  });

  it('marks added/changed on the canvas — removed never reach it', () => {
    const snap = captureSnapshot(g([node('skill:a')]), 't0');
    const after = g([node('skill:a', { unverified: true }), node('skill:new')]);
    const marks = diffMarks(diffSnapshots(snap, after));
    expect(marks.nodes.get('skill:new')).toBe('added');
    expect(marks.nodes.get('skill:a')).toBe('changed');
    // nothing removed existed → nothing ghost-painted
    expect(marks.nodes.size).toBe(2);
  });

  it('storage round-trip and tolerant reads', () => {
    const store = new Map<string, string>();
    const s = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const snap = captureSnapshot(g([node('skill:a')]), 't0');
    expect(saveSnapshot(s, snap)).toBe(true);
    expect(loadSnapshot(s)?.capturedAt).toBe('t0');
    store.set(GRAPH_SNAPSHOT_KEY, '{"schema":"other"}');
    expect(loadSnapshot(s)).toBeNull();
    store.set(GRAPH_SNAPSHOT_KEY, 'not json');
    expect(loadSnapshot(s)).toBeNull();
    expect(loadSnapshot(null)).toBeNull();
  });
});
