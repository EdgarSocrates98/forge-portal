import cytoscape from 'cytoscape';
import { createCytoscapeRenderer } from './cytoscape-adapter';
import { GraphSelection, GraphViewModel } from './renderer';

/**
 * Adapter-level tests. jsdom has no 2D rasterizer, so the engine runs
 * headless: layout positions, element data, classes, viewport and
 * selection are all real model state — only `cy.png()` is unavailable
 * and the adapter must honestly return null there.
 */

const VM: GraphViewModel = {
  nodes: [
    {
      id: 'forge:f1',
      label: 'f1',
      kind: 'forge',
      unverified: false,
      absent: false,
      failed: false,
      degree: 3,
      version: '1.0.0',
    },
    {
      id: 'skill:s1',
      label: 's1',
      kind: 'skill',
      unverified: false,
      absent: false,
      failed: false,
      degree: 1,
      state: 'available',
      origin: 'f1',
    },
    {
      id: 'agent:a1',
      label: 'a1',
      kind: 'agent',
      unverified: false,
      absent: false,
      failed: false,
      degree: 2,
      category: 'review',
    },
    {
      id: 'capability:c1',
      label: 'c1',
      kind: 'capability',
      unverified: true,
      absent: false,
      failed: false,
      degree: 1,
    },
    {
      id: 'host:h1',
      label: 'h1',
      kind: 'host',
      unverified: true,
      absent: true,
      failed: true,
      degree: 0,
      state: 'FAILED',
    },
  ],
  edges: [
    {
      id: 'e1',
      source: 'forge:f1',
      target: 'capability:c1',
      kind: 'declares',
      evidence: 'capabilities',
      evidenceState: 'loaded',
      evidenceEndpoint: 'GET /api/v1/capabilities',
    },
    {
      id: 'e2',
      source: 'agent:a1',
      target: 'skill:s1',
      kind: 'associated',
      evidence: 'agents',
      evidenceState: 'loaded',
      evidenceEndpoint: 'GET /api/v1/agents',
    },
    {
      id: 'e3',
      source: 'agent:a1',
      target: 'forge:f1',
      kind: 'origin',
      evidence: 'agents',
      evidenceState: 'unverified',
      evidenceEndpoint: 'GET /api/v1/agents',
    },
  ],
};

function make(): { r: ReturnType<typeof createCytoscapeRenderer>; cy: cytoscape.Core } {
  const r = createCytoscapeRenderer({ headless: true, animate: false });
  // jsdom divs report 0×0 — layouts that read the container box would
  // collapse every node to the origin. Fake a real viewport so grid /
  // circle / concentric compute genuine positions.
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { value: 800 });
  Object.defineProperty(host, 'clientHeight', { value: 600 });
  r.mount(host);
  r.setData(VM);
  return { r, cy: r.nativeHandle() as cytoscape.Core };
}

describe('cytoscape adapter — GraphRenderer contract (headless)', () => {
  it('setData creates typed nodes with kind, color, icon and honesty classes', () => {
    const { cy } = make();
    expect(cy.nodes().length).toBe(VM.nodes.length);
    expect(cy.edges().length).toBe(VM.edges.length);
    const skill = cy.getElementById('skill:s1');
    expect(skill.data('kind')).toBe('skill');
    expect(skill.data('color')).toBe('#7c3aed');
    expect(skill.data('icon')).toContain('data:image/svg+xml');
    expect(skill.data('degree')).toBe(1);
    expect(skill.data('label')).toBe('s1');
    expect(skill.data('dlabel')).toContain('s1'); // tier label from the field
    const unverified = cy.getElementById('capability:c1');
    expect(unverified.hasClass('unverified')).toBe(true);
    const absent = cy.getElementById('host:h1');
    expect(absent.hasClass('unverified')).toBe(true);
    expect(absent.hasClass('absent')).toBe(true);
    expect(absent.hasClass('failed')).toBe(true);
    const edge = cy.getElementById('e1');
    expect(edge.data('kind')).toBe('declares');
    expect(edge.data('evidence')).toBe('capabilities');
    expect(edge.data('line')).toBe('solid');
    expect(cy.getElementById('e3').data('line')).toBe('dashed'); // unverified source
  });

  it('positions exist after mount — a layout ran', () => {
    const { cy } = make();
    const p = cy.getElementById('forge:f1').position();
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });

  it('select() marks exactly one element and onSelect reports taps', () => {
    const { r, cy } = make();
    r.select('skill:s1');
    expect(cy.$(':selected').length).toBe(1);
    expect(cy.getElementById('skill:s1').selected()).toBe(true);
    r.select('e2');
    expect(cy.$(':selected').length).toBe(1);
    expect(cy.getElementById('e2').selected()).toBe(true);
    r.select(null);
    expect(cy.$(':selected').length).toBe(0);

    const seen: (GraphSelection | null)[] = [];
    r.onSelect((s) => seen.push(s));
    cy.getElementById('agent:a1').emit('tap');
    cy.getElementById('e1').emit('tap');
    cy.emit('tap');
    expect(seen).toEqual([{ type: 'node', id: 'agent:a1' }, { type: 'edge', id: 'e1' }, null]);
  });

  it('highlight() lights the neighborhood and fades the rest', () => {
    const { r, cy } = make();
    r.select('forge:f1');
    r.highlight(new Set(['forge:f1', 'capability:c1']), new Set(['e1']));
    expect(cy.getElementById('capability:c1').hasClass('nh')).toBe(true);
    expect(cy.getElementById('skill:s1').hasClass('faded')).toBe(true);
    expect(cy.getElementById('e1').hasClass('nh')).toBe(true);
    expect(cy.getElementById('e2').hasClass('faded')).toBe(true);
    // selected node stays lit without the neighbor halo
    expect(cy.getElementById('forge:f1').hasClass('faded')).toBe(false);
    r.highlight(new Set(), new Set());
    expect(cy.$('.faded').length).toBe(0);
    expect(cy.$('.nh').length).toBe(0);
  });

  it('dimExcept() dims non-matching nodes and null restores them', () => {
    const { r, cy } = make();
    r.dimExcept(new Set(['skill:s1']));
    expect(cy.getElementById('forge:f1').hasClass('dimmed')).toBe(true);
    expect(cy.getElementById('skill:s1').hasClass('dimmed')).toBe(false);
    r.dimExcept(null);
    expect(cy.$('.dimmed').length).toBe(0);
  });

  it('all five layouts reposition nodes and keep the selection', () => {
    const { r, cy } = make();
    r.select('agent:a1');
    r.layout('grid');
    // grid applies positions synchronously over the real container box —
    // a 0×0 host collapses everything to the origin, so assert real spread
    const after = cy.getElementById('agent:a1').position();
    expect(cy.getElementById('agent:a1').selected()).toBe(true);
    const xs = cy.nodes().map((n) => n.position().x);
    const ys = cy.nodes().map((n) => n.position().y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0);
    expect(Number.isFinite(after.x) && Number.isFinite(after.y)).toBe(true);
    for (const name of ['cose', 'concentric', 'breadthfirst', 'circle'] as const) {
      expect(() => r.layout(name)).not.toThrow();
    }
  });

  it('setData rebuild preserves selection, highlight and dim state', () => {
    const { r, cy } = make();
    r.select('agent:a1');
    r.highlight(new Set(['agent:a1', 'skill:s1']), new Set(['e2']));
    r.dimExcept(new Set(['agent:a1']));
    r.setData(VM);
    expect(cy.getElementById('agent:a1').selected()).toBe(true);
    expect(cy.getElementById('skill:s1').hasClass('nh')).toBe(true);
    expect(cy.getElementById('forge:f1').hasClass('dimmed')).toBe(true);
    expect(cy.getElementById('forge:f1').hasClass('faded')).toBe(true);
  });

  it('exports an SVG projection and honestly declines PNG headless', () => {
    const { r } = make();
    const svg = r.exportSvg();
    expect(svg).toBeTruthy();
    expect(svg).toContain('<svg');
    expect(svg).toContain('>s1<'); // node label projected as text
    expect(svg).toContain('stroke-dasharray'); // unverified dashed + evidence line style
    expect(r.exportPng()).toBeNull();
  });

  it('zoomTo ignores unknown ids and destroy releases the engine', () => {
    const { r, cy } = make();
    expect(() => r.zoomTo('nope')).not.toThrow();
    r.zoomTo('skill:s1');
    expect(cy.getElementById('skill:s1').position()).toBeTruthy();
    r.destroy();
    expect(r.nativeHandle()).toBeNull();
  });
});

describe('cytoscape adapter — 2.1 detail tiers, groups, diff, viewport', () => {
  it('zoom tiers enrich node labels and reveal edge labels near-in', async () => {
    const { cy } = make();
    // far: label only, no edge labels
    cy.zoom(0.4);
    cy.emit('viewport');
    await vi.waitFor(() => expect(cy.getElementById('skill:s1').data('dlabel')).toBe('s1'));
    expect(cy.getElementById('e1').data('elabel')).toBe('');
    cy.zoom(2); // near
    cy.emit('viewport');
    await vi.waitFor(() =>
      expect(cy.getElementById('skill:s1').data('dlabel')).toContain('available'),
    );
    // near tier adds state + relation count lines — all real fields
    const label = cy.getElementById('skill:s1').data('dlabel') as string;
    expect(label).toContain('s1');
    expect(label).toContain('1 rel');
    expect(cy.getElementById('e1').data('elabel')).toBe('declares');
    // node without state keeps its label line only
    expect(cy.getElementById('capability:c1').data('dlabel')).toContain('c1');
  });

  it('mid tier adds the state+origin line only when fields are real', async () => {
    const { cy } = make();
    cy.zoom(0.9); // mid
    cy.emit('viewport');
    // s1 carries state 'available' + origin 'f1' — both real, both shown
    await vi.waitFor(() =>
      expect(cy.getElementById('skill:s1').data('dlabel')).toBe('s1\navailable · f1'),
    );
    expect(cy.getElementById('capability:c1').data('dlabel')).toBe('c1');
    expect(cy.getElementById('e1').data('elabel')).toBe('declares');
  });

  it('setGrouping adds compound parents and collapse hides members', () => {
    const { r, cy } = make();
    r.setGrouping({
      groups: [
        { id: 'grp:kind:skill', label: 'skill', members: ['skill:s1'] },
        { id: 'grp:forge:f1', label: 'f1', members: ['agent:a1', 'capability:c1'] },
      ],
      collapsed: new Set(),
    });
    expect(cy.getElementById('grp:kind:skill').hasClass('grp')).toBe(true);
    expect(cy.getElementById('skill:s1').data('parent')).toBe('grp:kind:skill');
    expect(cy.getElementById('agent:a1').data('parent')).toBe('grp:forge:f1');
    // collapse → members + their edges hidden, parent shows the count
    r.setGrouping({
      groups: [
        { id: 'grp:kind:skill', label: 'skill', members: ['skill:s1'] },
        { id: 'grp:forge:f1', label: 'f1', members: ['agent:a1', 'capability:c1'] },
      ],
      collapsed: new Set(['grp:forge:f1']),
    });
    expect(cy.getElementById('agent:a1').hasClass('g-hidden')).toBe(true);
    expect(cy.getElementById('e2').hasClass('g-hidden')).toBe(true);
    expect(cy.getElementById('grp:forge:f1').data('dlabel')).toBe('f1 (2)');
    expect(cy.getElementById('skill:s1').hasClass('g-hidden')).toBe(false);
    r.setGrouping(null);
    expect(cy.getElementById('grp:kind:skill').empty()).toBe(true);
    expect(cy.getElementById('agent:a1').hasClass('g-hidden')).toBe(false);
  });

  it('setDiff marks added/changed on live elements only', () => {
    const { r, cy } = make();
    r.setDiff({
      nodes: new Map([
        ['skill:s1', 'added'],
        ['agent:a1', 'changed'],
      ]),
      edges: new Map([['e2', 'added']]),
    });
    expect(cy.getElementById('skill:s1').hasClass('diff-added')).toBe(true);
    expect(cy.getElementById('agent:a1').hasClass('diff-changed')).toBe(true);
    expect(cy.getElementById('e2').hasClass('diff-added')).toBe(true);
    r.setDiff(null);
    expect(cy.$('.diff-added').length).toBe(0);
    expect(cy.$('.diff-changed').length).toBe(0);
  });

  it('viewport get/set round-trips and onViewport reports camera moves', async () => {
    const { r, cy } = make();
    const seen: { zoom: number; panX: number; panY: number }[] = [];
    r.onViewport((v) => seen.push(v));
    r.setViewport({ zoom: 1.7, panX: 40, panY: -25 });
    const v = r.viewport();
    expect(v).not.toBeNull();
    expect(v!.zoom).toBeCloseTo(1.7);
    expect(v!.panX).toBeCloseTo(40);
    expect(v!.panY).toBeCloseTo(-25);
    cy.emit('viewport');
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[seen.length - 1].zoom).toBeCloseTo(1.7);
  });

  it('onHover reports element ids and ignores group containers', () => {
    const { r, cy } = make();
    const seen: (GraphSelection | null)[] = [];
    r.onHover((s) => seen.push(s));
    cy.getElementById('forge:f1').emit('mouseover');
    cy.getElementById('e1').emit('mouseover');
    cy.getElementById('e1').emit('mouseout');
    expect(seen).toEqual([{ type: 'node', id: 'forge:f1' }, { type: 'edge', id: 'e1' }, null]);
  });

  it('destroy() while a continuous layout is in flight tears down cleanly', async () => {
    const { r, cy } = make();
    // cose is intentionally run async (see runLayout) — it is almost
    // always still in flight here, which is the case under test
    r.destroy();
    // let the stopped layout's queued frame land, then the deferred
    // engine teardown — before the fix this crashed inside cytoscape
    await new Promise((res) => setTimeout(res, 700));
    expect(r.nativeHandle()).toBeNull();
    expect(cy.destroyed()).toBe(true);
  });
});

describe('cytoscape adapter — 2.2 cycle 3 layout guard + incremental render', () => {
  it('emits started→done for a synchronous layout and skipped on a no-op refresh', async () => {
    const { r } = make();
    const events: string[] = [];
    r.onLayoutStatus((e) => events.push(`${e.type}:${e.layout}`));
    r.layout('grid');
    // sync layout finishes inside the call
    expect(events).toContain('started:grid');
    expect(events).toContain('done:grid');
    // second setData of the SAME view — positions kept, layout skipped
    events.length = 0;
    r.setData(VM);
    expect(events).toEqual(['skipped:grid']);
  });

  it('kept elements hold position across setData; newcomers are seeded', () => {
    const { r, cy } = make();
    r.layout('grid'); // deterministic positions
    const before = { ...cy.getElementById('forge:f1').position() };
    const bigger: GraphViewModel = {
      nodes: [
        ...VM.nodes,
        {
          id: 'skill:new',
          label: 'new',
          kind: 'skill',
          unverified: false,
          absent: false,
          failed: false,
          degree: 1,
        },
      ],
      edges: [
        ...VM.edges,
        {
          id: 'e-new',
          source: 'skill:new',
          target: 'forge:f1',
          kind: 'associated',
          evidence: 'skills',
          evidenceState: 'loaded',
          evidenceEndpoint: 'GET /api/v1/skills',
        },
      ],
    };
    r.setData(bigger); // 1 of 6 nodes fresh — below the relayout fraction
    const after = cy.getElementById('forge:f1').position();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    const seeded = cy.getElementById('skill:new').position();
    expect(Number.isFinite(seeded.x)).toBe(true);
    expect(Number.isFinite(seeded.y)).toBe(true);
    // seeded next to its positioned neighbour, not the origin
    expect(Math.hypot(seeded.x - before.x, seeded.y - before.y)).toBeLessThan(400);
  });

  it('cancelLayout() stops an in-flight cose and reports cancelled — canvas keeps positions', async () => {
    const { r, cy } = make();
    const events: string[] = [];
    r.onLayoutStatus((e) => events.push(`${e.type}:${e.layout}`));
    r.layout('cose'); // async — stays in flight at least one frame
    r.cancelLayout();
    await new Promise((res) => setTimeout(res, 60));
    expect(events).toContain('cancelled:cose');
    // positions are still finite — cancelling never blanks the view
    const p = cy.getElementById('forge:f1').position();
    expect(Number.isFinite(p.x)).toBe(true);
    // a second cancel with nothing running is a no-op, not an error
    r.cancelLayout();
    expect(events.filter((e) => e === 'cancelled:cose')).toHaveLength(1);
    r.destroy();
    await new Promise((res) => setTimeout(res, 700));
  });

  it('supersedes a running layout instead of stacking it', async () => {
    const { r } = make();
    const events: string[] = [];
    r.onLayoutStatus((e) => events.push(`${e.type}:${e.layout}`));
    r.layout('cose');
    r.layout('grid');
    await new Promise((res) => setTimeout(res, 60));
    // ≥1 superseded: the make() setData cose may already have finished;
    // each killed run emits exactly one superseded, the newest wins
    const superseded = events.filter((e) => e.startsWith('superseded'));
    expect(superseded.length).toBeGreaterThanOrEqual(1);
    expect(events).toContain('done:grid');
    // no cose ever finishes after being superseded — stacking prevented
    const lastSup = events.lastIndexOf(superseded[superseded.length - 1]);
    expect(events.indexOf('done:cose')).toBeLessThan(lastSup);
    r.destroy();
    await new Promise((res) => setTimeout(res, 700));
  });
});
