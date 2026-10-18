import { GraphLayoutName } from './renderer';

/**
 * Portal 2.2 Cycle 3 §6.2 — adaptive layout strategy.
 *
 * Pure, deterministic policy module: given measured graph statistics
 * (size, density, connected components) and the user's explicit choice
 * (or `auto`), it returns which layout to run, whether that run is
 * known-expensive at this scale, the watchdog budget the guard should
 * arm, the bounded iteration count a forced cose gets, and whether
 * progressive rendering / clustering is advised.
 *
 * Environment capability (reduced-motion, headless) deliberately does
 * NOT enter the choice: reduced motion is an animation concern the
 * adapter already honours (cose stays async, positions apply once at
 * layoutstop — see cytoscape-adapter `runLayout`), and no device signal
 * was measured this cycle — thresholds are device-agnostic upper bounds
 * (see docs/perf/graph-scale-report.md, honest-limits section).
 *
 * Every threshold below was fixed by MEASUREMENT, not intuition —
 * `docs/perf/graph-scale-report.md` records the bench rows each bound
 * came from (`node scripts/graph-bench.mjs`). Do not retune without a
 * fresh row in that table.
 */

export interface GraphStats {
  nodes: number;
  edges: number;
  /** Mean incident edges per node (2·E/N) — density the layout feels. */
  density: number;
  /** Undirected connected components in the element set. */
  components: number;
  /** Share of nodes inside the largest component, 0..1. */
  largestShare: number;
}

/** Union-find component count over an element pair list — O(n+e),
 *  structural typing so both FedGraph and GraphViewModel feed it. */
export function graphStats(
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
): GraphStats {
  const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
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
  for (const e of edges) {
    if (!parent.has(e.source) || !parent.has(e.target)) continue;
    const ra = find(e.source);
    const rb = find(e.target);
    if (ra !== rb) parent.set(ra, rb);
  }
  const sizes = new Map<string, number>();
  for (const n of nodes) {
    const r = find(n.id);
    sizes.set(r, (sizes.get(r) ?? 0) + 1);
  }
  const largest = Math.max(0, ...sizes.values());
  return {
    nodes: nodes.length,
    edges: edges.length,
    density: nodes.length ? (2 * edges.length) / nodes.length : 0,
    components: sizes.size,
    largestShare: nodes.length ? largest / nodes.length : 0,
  };
}

/** Scale classes — bounds fixed by the cycle-3 headless bench
 *  (docs/perf/graph-scale-report.md §thresholds):
 *  - `small`: cose still finishes near-instantly (≤ ~2 s class).
 *  - `medium`: cose is viable but visibly slow — warn tier.
 *  - `large`: cose no longer finishes inside a usable budget — blocked
 *    from auto, confirm + watchdog when the user insists.
 *  - `very-large`: flat canvas stops being cheap to read — progressive
 *    hints + clustering advisory on top of `large` rules. */
export type ScaleClass = 'small' | 'medium' | 'large' | 'very-large';

export const SCALE_SMALL_MAX = 250;
export const SCALE_MEDIUM_MAX = 1200;
export const SCALE_LARGE_MAX = 6000;

export function scaleClass(stats: Pick<GraphStats, 'nodes'>): ScaleClass {
  if (stats.nodes <= SCALE_SMALL_MAX) return 'small';
  if (stats.nodes <= SCALE_MEDIUM_MAX) return 'medium';
  if (stats.nodes <= SCALE_LARGE_MAX) return 'large';
  return 'very-large';
}

/** Layouts that run as a cancellable async frame loop — the only kind
 *  the watchdog can actually interrupt mid-run. Synchronous layouts
 *  (grid/circle/concentric/breadthfirst) finish inside one call: the
 *  policy must avoid picking a slow one at scale instead. */
export const ASYNC_LAYOUTS: ReadonlySet<GraphLayoutName> = new Set(['cose']);

/**
 * Fallback order used by the safety guard: the measured-cheap universal
 * layout (grid stayed sub-second at every measured size including
 * 10 k/50 k — see the report table).
 */
export const FALLBACK_LAYOUT: GraphLayoutName = 'grid';

export interface LayoutChoice {
  /** The layout to actually run. */
  layout: GraphLayoutName;
  /** `auto` = picked by policy; `user` = explicit toolbar choice. */
  source: 'auto' | 'user';
  /** Cost class of the chosen layout at this scale: `ok` runs quietly;
   *  `warn` runs after an explicit confirm (watchdog armed) while the
   *  page surfaces the cheaper recommendation; `blocked` is above the
   *  measured safe limit — direct execution is refused and the caller
   *  substitutes `recommended` (never silently refused, never silently
   *  allowed to freeze: the block notice explains why). */
  cost: 'ok' | 'warn' | 'blocked';
  /** Measured-expensive at this scale (cost !== 'ok'). */
  expensive: boolean;
  /** What the policy would have picked — shown as the recommended
   *  alternative when `expensive` is true. */
  recommended: GraphLayoutName;
  /** Watchdog budget in ms for async layouts; 0 = no timeout (the
   *  layout is either synchronous or already measured-fast here). */
  timeoutMs: number;
  /** Bounded iteration count for a cose run at this scale — null for
   *  other layouts and `0` when cose gets its full default budget. */
  numIter: number;
  /** True when the stats say element creation should chunk — keeps
   *  the event loop breathing during initial render. */
  progressive: boolean;
  /** True when auto mode should advise pre-grouping (clustered
   *  overview) — the measured cut where the flat canvas stops being
   *  readable/cheap. */
  cluster: boolean;
}

/**
 * Measured cost class per layout at each scale — see the report table.
 * `ok` = auto-eligible; `warn` = runs with explicit confirm + watchdog
 * while flagged expensive; `blocked` = auto never picks it and the
 * page refuses direct execution (§2.2.1: a timer cannot interrupt a
 * synchronous frame block, so above this bound the only honest guard
 * is not running it — the caller substitutes `recommended`).
 */
type Cost = 'ok' | 'warn' | 'blocked';

const COST: Record<ScaleClass, Record<GraphLayoutName, Cost>> = {
  small: { cose: 'ok', concentric: 'ok', grid: 'ok', breadthfirst: 'ok', circle: 'ok' },
  medium: { cose: 'warn', concentric: 'ok', grid: 'ok', breadthfirst: 'ok', circle: 'ok' },
  large: { cose: 'blocked', concentric: 'ok', grid: 'ok', breadthfirst: 'ok', circle: 'ok' },
  'very-large': {
    cose: 'blocked',
    concentric: 'ok',
    grid: 'ok',
    breadthfirst: 'warn',
    circle: 'ok',
  },
};

/** Auto pick per scale — the best READABLE cheap layout measured:
 *  cose at small (it is the nicest and ≲2 s there), concentric at
 *  medium (degree rings stay legible in <100 ms), grid at large+.
 *  Dense small graphs skip cose — edge forces dominate and the force
 *  pass stops being the cheap option. */
const AUTO: Record<ScaleClass, GraphLayoutName> = {
  small: 'cose',
  medium: 'concentric',
  large: 'grid',
  'very-large': 'grid',
};

/** Watchdog budgets for async layouts — ~2–3× the measured settle time
 *  of a bounded-iteration cose at each boundary, so only a genuinely
 *  stuck run is killed. At large+ a confirmed cose still cannot
 *  converge: the budget is a partial-run allowance before fallback. */
const TIMEOUT_MS: Record<ScaleClass, number> = {
  small: 15000,
  medium: 60000,
  large: 30000,
  'very-large': 30000,
};

/** Bounded cose iterations per scale — cytoscape's default is 1000;
 *  each iteration costs O(n+e) work, so the budget shrinks with scale.
 *  0 = full default budget (small graphs deserve real convergence). */
const COSE_NUM_ITER: Record<ScaleClass, number> = {
  small: 0,
  medium: 300,
  large: 150,
  'very-large': 100,
};

/** Cose iteration budget at `stats` — 0 means "engine default". */
export function boundedIterations(stats: GraphStats): number {
  return COSE_NUM_ITER[scaleClass(stats)];
}

/** Density above which cose's edge forces dominate at small scale —
 *  concentric rings stay the cheap legible pick instead. */
export const DENSE_SMALL = 14;

/** Environment inputs to the policy — deliberately minimal. The
 *  reduced-motion flag is recorded for audit/documentation but does
 *  NOT change the pick: animation is the adapter's concern (cose stays
 *  async-cancellable with positions applied once — see runLayout).
 *  `grouped` tells the policy the view already groups, so the
 *  cluster advisory need not fire again. */
export interface LayoutEnv {
  reducedMotion?: boolean;
  grouped?: boolean;
}

export function chooseLayout(
  stats: GraphStats,
  opts: { preferred?: GraphLayoutName | null; env?: LayoutEnv } = {},
): LayoutChoice {
  const cls = scaleClass(stats);
  const auto = pickAuto(stats, cls);
  const preferred = opts.preferred ?? null;
  const layout = preferred ?? auto;
  const cost = COST[cls][layout];
  return {
    layout,
    source: preferred ? 'user' : 'auto',
    cost,
    expensive: cost !== 'ok',
    recommended: auto,
    timeoutMs: ASYNC_LAYOUTS.has(layout) ? TIMEOUT_MS[cls] : 0,
    numIter: layout === 'cose' ? COSE_NUM_ITER[cls] : 0,
    progressive: cls === 'very-large',
    cluster: cls === 'very-large' && opts.env?.grouped !== true,
  };
}

/** Cost class of `layout` at `stats` — what the page's guard consults
 *  before running an explicit user pick (`blocked` ⇒ never run it:
 *  show the block strip and keep the recommended layout on the
 *  canvas). */
export function effectiveCost(layout: GraphLayoutName, stats: GraphStats): Cost {
  return COST[scaleClass(stats)][layout];
}

function pickAuto(stats: GraphStats, cls: ScaleClass): GraphLayoutName {
  if (cls === 'small' && stats.density > DENSE_SMALL) return 'concentric';
  // many disconnected pieces → breadthfirst's single-root tree reads
  // badly; grid/concentric lay out every component evenly.
  if (stats.components > Math.max(8, stats.nodes * 0.2)) return 'grid';
  return AUTO[cls];
}

/** The watchdog budget a guard should arm for `layout` at `stats` —
 *  0 when the layout is synchronous (a timer cannot interrupt one
 *  synchronous block; policy avoids slow sync layouts at scale
 *  instead). */
export function layoutTimeoutMs(layout: GraphLayoutName, stats: GraphStats): number {
  if (!ASYNC_LAYOUTS.has(layout)) return 0;
  return TIMEOUT_MS[scaleClass(stats)];
}
