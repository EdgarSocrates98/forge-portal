import {
  FALLBACK_LAYOUT,
  GraphStats,
  SCALE_LARGE_MAX,
  SCALE_MEDIUM_MAX,
  SCALE_SMALL_MAX,
  boundedIterations,
  chooseLayout,
  effectiveCost,
  graphStats,
  layoutTimeoutMs,
  scaleClass,
} from './layout-policy';

/**
 * §6.2 adaptive layout policy — the measured scale classes, cost
 * classes, watchdog budgets and clustering advisory. Thresholds are
 * pinned to bench rows (docs/perf/graph-scale-report.md); retuning
 * requires a fresh measurement, so these tests lock the CURRENT
 * policy constants.
 */

const mk = (nodes: number, edges = nodes * 3, extra: Partial<GraphStats> = {}): GraphStats => ({
  nodes,
  edges,
  density: nodes ? (2 * edges) / nodes : 0,
  components: 1,
  largestShare: 1,
  ...extra,
});

describe('graphStats', () => {
  it('counts undirected components and the largest share', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ];
    const s = graphStats(nodes, edges);
    expect(s.nodes).toBe(4);
    expect(s.edges).toBe(2);
    expect(s.density).toBe(1);
    expect(s.components).toBe(2);
    expect(s.largestShare).toBe(0.5);
  });

  it('tolerates edges pointing outside the node set', () => {
    const s = graphStats([{ id: 'a' }], [{ source: 'a', target: 'ghost' }]);
    expect(s.components).toBe(1);
    expect(s.edges).toBe(1);
  });

  it('reports zero-share on an empty graph', () => {
    const s = graphStats([], []);
    expect(s.components).toBe(0);
    expect(s.largestShare).toBe(0);
  });
});

describe('scaleClass', () => {
  it('pins the measured class boundaries', () => {
    expect(scaleClass(mk(0))).toBe('small');
    expect(scaleClass(mk(SCALE_SMALL_MAX))).toBe('small');
    expect(scaleClass(mk(SCALE_SMALL_MAX + 1))).toBe('medium');
    expect(scaleClass(mk(SCALE_MEDIUM_MAX))).toBe('medium');
    expect(scaleClass(mk(SCALE_MEDIUM_MAX + 1))).toBe('large');
    expect(scaleClass(mk(SCALE_LARGE_MAX))).toBe('large');
    expect(scaleClass(mk(SCALE_LARGE_MAX + 1))).toBe('very-large');
  });
});

describe('chooseLayout — auto picks', () => {
  it('keeps cose on small graphs (measured ≤ ~2 s there)', () => {
    const c = chooseLayout(mk(100));
    expect(c.layout).toBe('cose');
    expect(c.source).toBe('auto');
    expect(c.cost).toBe('ok');
    expect(c.expensive).toBe(false);
  });

  it('picks a structural layout at medium (cose warned, never auto)', () => {
    const c = chooseLayout(mk(500));
    expect(c.layout).not.toBe('cose');
    expect(c.layout).toBe('concentric');
    expect(c.cost).toBe('ok');
  });

  it('picks grid at large and flags progressive/cluster at very-large', () => {
    const big = chooseLayout(mk(2000));
    expect(big.layout).toBe('grid');
    expect(big.progressive).toBe(false);
    expect(big.cluster).toBe(false);
    const huge = chooseLayout(mk(9000));
    expect(huge.layout).toBe('grid');
    expect(huge.progressive).toBe(true);
    expect(huge.cluster).toBe(true);
  });

  it('suppresses the cluster advisory when the view already groups', () => {
    const c = chooseLayout(mk(9000), { env: { grouped: true } });
    expect(c.cluster).toBe(false);
    expect(c.progressive).toBe(true);
  });

  it('avoids cose on dense small graphs (edge forces dominate)', () => {
    const c = chooseLayout(mk(120, 1200)); // density 20 > DENSE_SMALL
    expect(c.layout).toBe('concentric');
  });

  it('avoids cose on fragmented graphs (many components)', () => {
    const c = chooseLayout(mk(200, 0, { components: 60, largestShare: 0.1 }));
    expect(c.layout).toBe('grid');
  });
});

describe('chooseLayout — user picks + guard fields', () => {
  it('marks a user pick expensive at large scale and names the auto alternative', () => {
    const c = chooseLayout(mk(2000), { preferred: 'cose' });
    expect(c.layout).toBe('cose');
    expect(c.source).toBe('user');
    expect(c.cost).toBe('blocked');
    expect(c.expensive).toBe(true);
    expect(c.recommended).toBe('grid');
  });

  it('warns (not blocks) cose at medium scale', () => {
    const c = chooseLayout(mk(500), { preferred: 'cose' });
    expect(c.cost).toBe('warn');
    expect(c.expensive).toBe(true);
    expect(c.recommended).toBe('concentric');
  });

  it('never blocks structural layouts at any measured scale', () => {
    for (const n of [50, 500, 2000, 9000]) {
      for (const l of ['concentric', 'grid', 'circle'] as const) {
        const c = chooseLayout(mk(n), { preferred: l });
        expect(c.cost).toBe('ok');
      }
    }
  });

  it('arms a watchdog only on async layouts', () => {
    expect(chooseLayout(mk(2000), { preferred: 'cose' }).timeoutMs).toBeGreaterThan(0);
    expect(chooseLayout(mk(2000), { preferred: 'grid' }).timeoutMs).toBe(0);
  });

  it('shrinks the cose iteration budget with scale', () => {
    expect(boundedIterations(mk(50))).toBe(0);
    expect(boundedIterations(mk(500))).toBe(300);
    expect(boundedIterations(mk(2000))).toBe(150);
    expect(boundedIterations(mk(9000))).toBe(100);
  });
});

describe('layoutTimeoutMs / effectiveCost / FALLBACK_LAYOUT', () => {
  it('returns 0 for synchronous layouts (a timer cannot interrupt them)', () => {
    expect(layoutTimeoutMs('grid', mk(9000))).toBe(0);
    expect(layoutTimeoutMs('breadthfirst', mk(9000))).toBe(0);
    expect(layoutTimeoutMs('cose', mk(9000))).toBeGreaterThan(0);
  });

  it('effectiveCost matches the chooseLayout cost table', () => {
    const s = mk(2000);
    expect(effectiveCost('cose', s)).toBe('blocked');
    expect(effectiveCost('grid', s)).toBe('ok');
    expect(effectiveCost('breadthfirst', mk(9000))).toBe('warn');
  });

  it('the fallback is a synchronous layout that stayed sub-second at 10k/50k', () => {
    expect(FALLBACK_LAYOUT).toBe('grid');
  });
});
