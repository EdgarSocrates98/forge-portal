import cytoscape from 'cytoscape';
import { createCytoscapeRenderer } from './cytoscape-adapter';
import { GraphSelection, GraphViewModel } from './renderer';

/**
 * Adapter-level tests. jsdom has no 2D rasterizer, so the engine runs
 * headless: layout positions, element data, classes and selection are
 * all real model state — only `cy.png()` is unavailable and the
 * adapter must honestly return null there.
 */

const VM: GraphViewModel = {
  nodes: [
    { id: 'forge:f1', label: 'f1', kind: 'forge', unverified: false, absent: false },
    { id: 'skill:s1', label: 's1', kind: 'skill', unverified: false, absent: false },
    { id: 'agent:a1', label: 'a1', kind: 'agent', unverified: false, absent: false },
    { id: 'capability:c1', label: 'c1', kind: 'capability', unverified: true, absent: false },
    { id: 'host:h1', label: 'h1', kind: 'host', unverified: true, absent: true },
  ],
  edges: [
    {
      id: 'e1',
      source: 'forge:f1',
      target: 'capability:c1',
      kind: 'declares',
      evidence: 'capabilities',
    },
    { id: 'e2', source: 'agent:a1', target: 'skill:s1', kind: 'associated', evidence: 'agents' },
    { id: 'e3', source: 'agent:a1', target: 'forge:f1', kind: 'origin', evidence: 'agents' },
  ],
};

function make(): { r: ReturnType<typeof createCytoscapeRenderer>; cy: cytoscape.Core } {
  const r = createCytoscapeRenderer({ headless: true, animate: false });
  r.mount(document.createElement('div'));
  r.setData(VM);
  return { r, cy: r.nativeHandle() as cytoscape.Core };
}

describe('cytoscape adapter — GraphRenderer contract (headless)', () => {
  it('setData creates typed nodes with kind, color and honesty classes', () => {
    const { cy } = make();
    expect(cy.nodes().length).toBe(VM.nodes.length);
    expect(cy.edges().length).toBe(VM.edges.length);
    const skill = cy.getElementById('skill:s1');
    expect(skill.data('kind')).toBe('skill');
    expect(skill.data('color')).toBe('#7c3aed');
    const unverified = cy.getElementById('capability:c1');
    expect(unverified.hasClass('unverified')).toBe(true);
    const absent = cy.getElementById('host:h1');
    expect(absent.hasClass('unverified')).toBe(true);
    expect(absent.hasClass('absent')).toBe(true);
    const edge = cy.getElementById('e1');
    expect(edge.data('kind')).toBe('declares');
    expect(edge.data('evidence')).toBe('capabilities');
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

  it('switching layouts repositions nodes and keeps the selection', () => {
    const { r, cy } = make();
    r.select('agent:a1');
    const before = { ...cy.getElementById('agent:a1').position() };
    r.layout('grid');
    const after = cy.getElementById('agent:a1').position();
    expect(cy.getElementById('agent:a1').selected()).toBe(true);
    expect(after.x !== before.x || after.y !== before.y).toBe(true);
    for (const name of ['cose', 'concentric', 'breadthfirst'] as const) {
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
    expect(svg).toContain('stroke-dasharray'); // unverified dashed
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
