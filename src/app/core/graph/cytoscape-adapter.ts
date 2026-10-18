import cytoscape from 'cytoscape';
import { iconPath } from '../../shared/icon-paths';
import {
  FALLBACK_LAYOUT,
  GraphStats,
  boundedIterations,
  graphStats,
  layoutTimeoutMs,
} from './layout-policy';
import { EDGE_LINE, EDGE_STYLE, KIND_ICON, KIND_STYLE, tierLabel } from './view-model';
import {
  GraphDetailTier,
  GraphDiffMarks,
  GraphGrouping,
  GraphLayoutEvent,
  GraphLayoutName,
  GraphNodeShape,
  GraphRenderer,
  GraphSelection,
  GraphViewport,
  GraphViewModel,
} from './renderer';

/**
 * §5.6 / Graph Studio 2.1 — Cytoscape.js adapter for GraphRenderer.
 *
 * The only file allowed to import `cytoscape` — everything upstream
 * (view model, page) speaks the engine-agnostic contract in
 * `renderer.ts`. The adapter carries no business logic: it projects
 * `GraphViewModel` elements, maps honesty flags to visual states
 * (`unverified` → dashed border, `absent` → extra dim, `failed` →
 * error-colored border), evidence availability to edge line style
 * (loaded → solid, unverified → dashed, unavailable → dotted), zoom
 * level to label detail tiers, and reports pointer selection, hover
 * and camera changes back through the contract callbacks.
 *
 * Hosts without a 2D canvas (jsdom tests, headless benchmarks) run
 * headless: layout, selection, classes, viewport and the SVG
 * projection still work; `exportPng` returns null because no
 * rasterizer exists — an honest "unavailable", not a failure.
 */

export interface CytoscapeRendererOptions {
  /** Force headless mode (no canvas renderer). Auto-detected when unset. */
  headless?: boolean;
  /** Animate layout transitions. Caller passes false under
   *  `prefers-reduced-motion`; viewport ops stay instant either way. */
  animate?: boolean;
  /** Pan/zoom perf hints (edge hiding + texture cache during viewport
   *  moves). Default true — raster-only, honest: no data is dropped,
   *  edges reappear the moment the camera settles. */
  perfHints?: boolean;
  /** Layout watchdog (§6.3). Default on; benchmarks measuring the
   *  UNguarded baseline pass `guard: false` — the page never does. */
  guard?: boolean;
  /** Incremental reconcile on setData (default true — §6.4). `false`
   *  restores the pre-cycle-3 full wipe + unconditional relayout; the
   *  benchmark's baseline mode uses it, the page never does. */
  incremental?: boolean;
}

const NODE_SIZE = 46;
const SVG_PAD = 48;
/** Zoom-tier boundaries — model-space zoom factors, not pixels. */
const TIER_FAR = 0.6;
const TIER_NEAR = 1.35;
/** Per-zoom class churn is skipped past this size — far-tier labels
 *  stay (documented in the benchmark doc). */
const TIER_MAX_NODES = 4000;
/** Element count above which the initial render chunks `cy.add` across
 *  event-loop turns — measured ~0.4 s per 25 k elements, so past 8 k
 *  the single-call add becomes a visible freeze (§6.4). */
const PROGRESSIVE_MIN = 8000;
const PROGRESSIVE_CHUNK = 2000;
/** A refresh relayouts only when the share of never-positioned nodes
 *  exceeds this — below it, deterministic seeding keeps the canvas
 *  stable instead of re-running a (possibly expensive) layout. */
const RELAYOUT_FRACTION = 0.1;
const RELAYOUT_MIN = 8;

/** Why a running layout ended — the terminal event the guard emits. */
type Halt = 'natural' | 'cancel' | 'superseded' | 'timeout';

interface ActiveLayout {
  layout: cytoscape.Layouts;
  name: GraphLayoutName;
  t0: number;
  halt: Halt;
  timer: ReturnType<typeof setTimeout> | null;
}

const monotime = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

function canRaster(): boolean {
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return false;
  try {
    const c = document.createElement('canvas');
    return c.getContext('2d') !== null;
  } catch {
    return false;
  }
}

function cssVar(name: string, fallback: string): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Per-kind white-stroke SVG data URIs — the same lucide paths the
 *  DOM `<ui-icon>` paints, rasterized by the canvas renderer. */
const KIND_ICON_URI: Record<string, string> = Object.fromEntries(
  Object.entries(KIND_ICON).map(([kind, name]) => {
    const d = iconPath(name);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"` +
      ` stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    return [kind, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`];
  }),
);

/** Regular polygon points (for SVG export) centered at (cx, cy). */
function polygon(cx: number, cy: number, r: number, sides: number, rot = -Math.PI / 2): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function starPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

const GROUP_KIND = 'grp:';
const isGroupId = (id: string): boolean => id.startsWith(GROUP_KIND);

export function createCytoscapeRenderer(opts: CytoscapeRendererOptions = {}): GraphRenderer {
  const headless = opts.headless ?? !canRaster();
  // Headless hosts have nothing to animate (and cytoscape's animated
  // refresh loop dereferences the absent renderer) — force instant.
  const animate = (opts.animate ?? true) && !headless;
  const perfHints = opts.perfHints ?? true;
  const guard = opts.guard !== false;
  const incremental = opts.incremental !== false;
  const listeners: ((sel: GraphSelection | null) => void)[] = [];
  const hoverListeners: ((sel: GraphSelection | null) => void)[] = [];
  const viewportListeners: ((v: GraphViewport) => void)[] = [];
  const layoutListeners: ((e: GraphLayoutEvent) => void)[] = [];

  let cy: cytoscape.Core | null = null;
  // Honesty/emphasis state survives setData rebuilds.
  let fadedNodes = new Set<string>();
  let fadedEdges = new Set<string>();
  let fadedOn = false;
  let dimSet: Set<string> | null = null;
  let selectedId: string | null = null;
  let currentLayout: GraphLayoutName = 'cose';
  let lastView: GraphViewModel | null = null;
  let grouping: GraphGrouping | null = null;
  let diff: GraphDiffMarks | null = null;
  let tier: GraphDetailTier = 'far';
  let vpTimer: ReturnType<typeof setTimeout> | null = null;
  let viewNodes = new Map<string, GraphViewModel['nodes'][number]>();
  /** The in-flight layout — superseded runs are stopped, never stacked. */
  let activeLayout: ActiveLayout | null = null;
  /** Stopped continuous layouts that still owe one final frame. Cose
   *  keeps a queued frame past stop(); that frame runs done()→refresh()
   *  on the next tick, so the engine may only be torn down after every
   *  stopped layout has emitted its last layoutstop (see destroy). */
  let inFlightLayoutFrames = 0;
  /** Invalidates an async progressive render when a newer one starts. */
  let renderSeq = 0;
  /** Model stats of the last setData — feeds the layout watchdog. */
  let lastStats: GraphStats | null = null;

  function stopLayout(layout: cytoscape.Layouts): void {
    inFlightLayoutFrames++;
    layout.stop(); // emits layoutstop synchronously — flag set, frame pending
    // attached after stop() so it only counts the PENDING frame's emit
    layout.one('layoutstop', () => {
      inFlightLayoutFrames--;
    });
  }

  const emit = (sel: GraphSelection | null): void => {
    for (const cb of listeners) cb(sel);
  };
  const emitHover = (sel: GraphSelection | null): void => {
    for (const cb of hoverListeners) cb(sel);
  };
  const emitLayout = (e: GraphLayoutEvent): void => {
    for (const cb of layoutListeners) cb(e);
  };

  /** Stop the in-flight layout with a reason — its layoutstop handler
   *  emits the matching terminal event (never silently dropped). */
  function haltLayout(reason: Halt): void {
    const a = activeLayout;
    if (!a) return;
    a.halt = reason;
    stopLayout(a.layout);
  }

  function currentViewport(): GraphViewport | null {
    if (!cy) return null;
    const p = cy.pan();
    return { zoom: cy.zoom(), panX: p.x, panY: p.y };
  }

  /** Debounced zoom+pan handler: recomputes the detail tier (label
   *  density) and notifies camera subscribers for saved views. */
  function onViewport(): void {
    if (vpTimer) clearTimeout(vpTimer);
    vpTimer = setTimeout(() => {
      vpTimer = null;
      if (!cy) return;
      applyTier();
      const v = currentViewport();
      if (v) for (const cb of viewportListeners) cb(v);
    }, 90);
  }

  function applyTier(): void {
    if (!cy) return;
    const z = cy.zoom();
    const next: GraphDetailTier = z < TIER_FAR ? 'far' : z < TIER_NEAR ? 'mid' : 'near';
    if (next === tier) return;
    tier = next;
    if (cy.nodes().length > TIER_MAX_NODES) return; // churn guard
    cy.batch(() => {
      cy!
        .nodes()
        .filter((n) => !isGroupId(n.id()))
        .forEach((n) => {
          const v = viewNodes.get(n.id());
          if (v) n.data('dlabel', tierLabel(v, tier));
        });
      cy!.edges().forEach((e) => {
        e.data('elabel', tier === 'far' ? '' : (e.data('kind') as string));
      });
    });
  }

  function stylesheet(labelColor: string, accent: string): cytoscape.StylesheetJson {
    const ok = cssVar('--fg-success', '#0b7a42');
    const warn = cssVar('--fg-warning', '#a35c00');
    const err = cssVar('--fg-error', '#c0392b');
    const kindRules = Object.entries(KIND_STYLE).map(([kind, st]) => ({
      selector: `node[kind = "${kind}"]`,
      style: { 'background-color': st.color, shape: st.shape as cytoscape.Css.Node['shape'] },
    }));
    const edgeRules = Object.entries(EDGE_STYLE).map(([kind, st]) => ({
      selector: `edge[kind = "${kind}"]`,
      style: { 'line-color': st.color, 'target-arrow-color': st.color },
    }));
    return [
      {
        selector: 'node',
        style: {
          width: NODE_SIZE,
          height: NODE_SIZE,
          label: 'data(dlabel)',
          'font-size': 10,
          color: labelColor,
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 5,
          'text-wrap': 'wrap',
          'text-max-width': '130px',
          'border-width': 1.5,
          'border-color': 'data(color)',
          'border-opacity': 0.9,
          'background-opacity': 0.92,
          'background-image': 'data(icon)',
          'background-width': '52%',
          'background-height': '52%',
          'background-image-opacity': 0.95,
          'background-clip': 'none',
        },
      },
      ...kindRules,
      {
        selector: 'node.grp',
        style: {
          shape: 'round-rectangle',
          'background-opacity': 0.06,
          'background-color': labelColor,
          'border-width': 1.4,
          'border-style': 'dashed',
          'border-color': labelColor,
          'border-opacity': 0.55,
          label: 'data(dlabel)',
          'font-size': 11,
          'font-weight': 'bold',
          color: labelColor,
          'text-valign': 'top',
          'text-halign': 'center',
          'text-margin-y': -4,
          padding: '14px',
          'background-image': 'none',
          events: 'yes',
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1.6,
          'curve-style': 'bezier',
          'line-style': (e: cytoscape.EdgeSingular) =>
            (e.data('line') as 'solid' | 'dashed' | 'dotted' | 'double' | undefined) ?? 'solid',
          'target-arrow-shape': 'triangle',
          'target-arrow-fill': 'filled',
          'arrow-scale': 0.9,
          label: 'data(elabel)',
          'font-size': 8,
          color: labelColor,
          'text-rotation': 'autorotate',
          'text-margin-y': -6,
          opacity: 0.85,
        },
      },
      ...edgeRules,
      { selector: 'node.unverified', style: { 'border-style': 'dashed', opacity: 0.7 } },
      { selector: 'node.absent', style: { opacity: 0.35 } },
      {
        selector: 'node.failed',
        style: { 'border-color': err, 'border-width': 3, 'border-style': 'solid' },
      },
      {
        selector: '.diff-added',
        style: {
          'border-color': ok,
          'line-color': ok,
          'target-arrow-color': ok,
          'border-width': 3,
        },
      },
      {
        selector: '.diff-changed',
        style: {
          'border-color': warn,
          'line-color': warn,
          'target-arrow-color': warn,
          'border-width': 3,
          'border-style': 'double',
        },
      },
      { selector: '.g-hidden', style: { display: 'none', events: 'no' } },
      { selector: '.faded', style: { opacity: 0.12, events: 'yes' } },
      { selector: '.dimmed', style: { opacity: 0.15 } },
      {
        selector: 'node.nh',
        style: { 'border-width': 3, 'border-color': accent, 'border-opacity': 1 },
      },
      { selector: 'edge.nh', style: { width: 2.6, opacity: 1 } },
      {
        selector: ':selected',
        style: {
          'overlay-color': accent,
          'overlay-opacity': 0.18,
          'overlay-padding': 6,
        },
      },
    ];
  }

  /** Elements hidden by a collapsed group: members plus every edge
   *  touching one. The current canvas stays honest — hidden members
   *  still exist in the model, the group box shows their count. */
  function hiddenByCollapse(): Set<string> {
    const hidden = new Set<string>();
    if (!grouping || !lastView) return hidden;
    const memberOf = new Map<string, string>();
    for (const g of grouping.groups) for (const m of g.members) memberOf.set(m, g.id);
    for (const g of grouping.groups) {
      if (!grouping.collapsed.has(g.id)) continue;
      for (const m of g.members) hidden.add(m);
    }
    if (!hidden.size) return hidden;
    for (const e of lastView.edges) {
      if (hidden.has(e.source) || hidden.has(e.target)) hidden.add(e.id);
    }
    return hidden;
  }

  function applyStates(): void {
    if (!cy) return;
    const nodes = cy.nodes().filter((n) => !isGroupId(n.id()));
    const edges = cy.edges();
    nodes.removeClass('nh faded dimmed diff-added diff-changed g-hidden');
    edges.removeClass('nh faded diff-added diff-changed g-hidden');
    const hidden = hiddenByCollapse();
    if (hidden.size) {
      cy.elements().forEach((el) => {
        if (hidden.has(el.id())) el.addClass('g-hidden');
      });
    }
    if (fadedOn) {
      nodes.forEach((n) => {
        if (!fadedNodes.has(n.id())) n.addClass('faded');
        else if (n.id() !== selectedId) n.addClass('nh');
      });
      edges.forEach((e) => {
        if (!fadedEdges.has(e.id())) e.addClass('faded');
        else e.addClass('nh');
      });
    }
    const dim = dimSet;
    if (dim) {
      nodes.forEach((n) => {
        if (!dim.has(n.id())) n.addClass('dimmed');
      });
    }
    if (diff) {
      diff.nodes.forEach((mark, id) => cy!.getElementById(id).addClass(`diff-${mark}`));
      diff.edges.forEach((mark, id) => cy!.getElementById(id).addClass(`diff-${mark}`));
    }
    if (selectedId) cy.getElementById(selectedId).select();
  }

  /**
   * Run a layout under the safety guard (§6.3):
   * - a still-running layout is stopped first ('superseded') — layouts
   *   never stack;
   * - async layouts (cose) run under a watchdog sized by the measured
   *   scale — `layout-policy.ts` owns the budget; on expiry the run is
   *   stopped ('timeout') and the safe FALLBACK_LAYOUT runs instead;
   * - every terminal state emits a GraphLayoutEvent so callers can
   *   render progress + honesty notices;
   * - positions fit() only on a natural finish — a cancelled or killed
   *   run leaves the last stable camera alone.
   */
  function runLayout(name: GraphLayoutName, opts: { guarded?: boolean } = {}): void {
    if (!cy) return;
    if (activeLayout) haltLayout('superseded');
    currentLayout = name;
    const options: cytoscape.LayoutOptions = {
      name,
      animate,
      fit: false,
      // collapsed members stay where they were — the layout flows over
      // what is actually visible, so folds never leave ghost space
      eles: cy.elements().not('.g-hidden'),
    } as cytoscape.LayoutOptions;
    if (name === 'concentric') {
      (options as cytoscape.ConcentricLayoutOptions).concentric = (n) => n.degree(false);
      (options as cytoscape.ConcentricLayoutOptions).levelWidth = () => 2;
    }
    if (name === 'cose') {
      // cytoscape cose runs its whole simulation in ONE synchronous
      // while-loop whenever animate !== true — uncancellable, timers
      // starve, and a big graph freezes the tab for minutes (measured:
      // >15 min at 5k/20k). Keeping animate:true preserves the async
      // frame loop (stop() still lands between frames); pushing
      // animationThreshold past any runtime means positions are only
      // applied once at layoutstop — no visible motion, so reduced-
      // motion users keep a still canvas AND a responsive page.
      const coseOpts = options as cytoscape.CoseLayoutOptions;
      coseOpts.animate = true;
      coseOpts.animationThreshold = Number.MAX_SAFE_INTEGER;
      // bounded iteration budget at scale — the policy's measured
      // cap; small graphs keep the engine default (real convergence).
      // Guarded only: bench 'off' mode reproduces the 2.1 baseline.
      const it = boundedIterations(stats());
      if (guard && it > 0) coseOpts.numIter = it;
    }
    emitLayout({ type: 'started', layout: name });
    const layout = cy.layout(options);
    const rec: ActiveLayout = { layout, name, t0: monotime(), halt: 'natural', timer: null };
    activeLayout = rec;
    layout.one('layoutstop', () => {
      if (rec.timer) {
        clearTimeout(rec.timer);
        rec.timer = null;
      }
      if (activeLayout === rec) activeLayout = null;
      const elapsedMs = Math.round(monotime() - rec.t0);
      if (rec.halt === 'natural') {
        emitLayout({ type: 'done', layout: name, elapsedMs });
        cy?.fit(undefined, 36);
      } else if (rec.halt === 'cancel') {
        emitLayout({ type: 'cancelled', layout: name, elapsedMs });
      } else if (rec.halt === 'superseded') {
        emitLayout({ type: 'superseded', layout: name, elapsedMs });
      } else {
        emitLayout({ type: 'timeout', layout: name, elapsedMs, fallback: FALLBACK_LAYOUT });
      }
      applyTier();
    });
    // the watchdog only guards async layouts — synchronous ones can't
    // be interrupted mid-block anyway, so no timer is armed for them
    const budget = !guard || opts.guarded === false ? 0 : layoutTimeoutMs(name, stats());
    if (budget > 0) {
      rec.timer = setTimeout(() => {
        rec.timer = null;
        if (activeLayout !== rec) return;
        haltLayout('timeout');
        runLayout(FALLBACK_LAYOUT, { guarded: false });
      }, budget);
    }
    try {
      layout.run();
    } catch {
      // a layout that throws before starting must not wedge the guard —
      // fall back to the safe layout and report HONESTLY (an error is
      // not a timeout — different cause, same safe recovery)
      if (activeLayout === rec) {
        if (rec.timer) {
          clearTimeout(rec.timer);
          rec.timer = null;
        }
        activeLayout = null;
        emitLayout({ type: 'error', layout: name, elapsedMs: 0, fallback: FALLBACK_LAYOUT });
        runLayout(FALLBACK_LAYOUT, { guarded: false });
      }
    }
  }

  /** Stats of the current model — the watchdog's scale input. */
  function stats(): GraphStats {
    if (lastStats) return lastStats;
    const nodes = cy?.nodes().length ?? 0;
    const edges = cy?.edges().length ?? 0;
    return {
      nodes,
      edges,
      density: nodes ? (2 * edges) / nodes : 0,
      components: 0,
      largestShare: 1,
    };
  }

  // -- element construction -------------------------------------------

  type EleDef = { data: Record<string, unknown>; classes?: string };

  function groupDefs(): EleDef[] {
    const spec = grouping;
    if (!spec) return [];
    return spec.groups.map((g) => ({
      data: {
        id: g.id,
        label: g.label,
        kind: 'group',
        dlabel: spec.collapsed.has(g.id) ? `${g.label} (${g.members.length})` : g.label,
        members: g.members.length,
      },
      classes: 'grp',
    }));
  }

  function nodeDefs(memberOf: Map<string, string>): EleDef[] {
    return lastView!.nodes.map((n) => ({
      data: {
        id: n.id,
        label: n.label,
        dlabel: tierLabel(n, tier),
        kind: n.kind,
        color: KIND_STYLE[n.kind].color,
        icon: KIND_ICON_URI[n.kind] ?? '',
        unverified: n.unverified,
        absent: n.absent,
        failed: n.failed,
        degree: n.degree,
        state: n.state,
        category: n.category,
        origin: n.origin,
        version: n.version,
        ...(memberOf.has(n.id) ? { parent: memberOf.get(n.id) } : {}),
      },
      classes:
        `${n.unverified ? 'unverified' : ''}${n.absent ? ' absent' : ''}` +
        `${n.failed ? ' failed' : ''}`,
    }));
  }

  function edgeDefs(): EleDef[] {
    return lastView!.edges.map((e) => ({
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        kind: e.kind,
        evidence: e.evidence,
        evidenceState: e.evidenceState,
        endpoint: e.evidenceEndpoint,
        line: EDGE_LINE[e.evidenceState] ?? 'solid',
        elabel: tier === 'far' ? '' : e.kind,
      },
    }));
  }

  /** Sync mutable fields on a kept element — refresh honesty: labels,
   *  flags and line styles track the newest model without a rebuild.
   *  `id`/`source`/`target` are engine-immutable; `parent` moves via
   *  `ele.move()`, never `data()`. The shallow diff skips the write
   *  when nothing changed — a collapse toggle must not dirty 60 k
   *  elements' styles for nothing. */
  function refreshElement(d: EleDef): void {
    const el = cy!.getElementById(d.data['id'] as string);
    if (el.empty()) return;
    const { id: _id, source: _s, target: _t, parent: _p, ...fields } = d.data;
    let dirty = false;
    for (const k of Object.keys(fields)) {
      if (el.data(k) !== fields[k]) {
        dirty = true;
        break;
      }
    }
    if (dirty) el.data(fields);
    if (el.isNode()) {
      const want = (d.data['parent'] as string | undefined) ?? null;
      if ((el.data('parent') ?? null) !== want) el.move({ parent: want });
      if ('unverified' in d.data) {
        el.toggleClass('unverified', !!d.data['unverified']);
        el.toggleClass('absent', !!d.data['absent']);
        el.toggleClass('failed', !!d.data['failed']);
      }
    }
  }

  /**
   * Deterministic position for a node the canvas has never placed:
   * the centroid of its already-positioned neighbours, or a golden-angle
   * ring around the placed centroid when no neighbour is placed yet.
   * Refresh keeps the canvas stable — a new node lands near its
   * relations instead of re-shuffling the whole picture (§6.4).
   */
  function seedPositions(ids: string[]): void {
    if (!ids.length || !cy || !lastView) return;
    const fresh = new Set(ids);
    const placed = new Map<string, { x: number; y: number }>();
    let cx = 0,
      cyy = 0,
      pn = 0;
    cy.nodes().forEach((n) => {
      const id = n.id();
      if (isGroupId(id) || fresh.has(id)) return;
      const p = n.position();
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      placed.set(id, p);
      cx += p.x;
      cyy += p.y;
      pn++;
    });
    const center = pn ? { x: cx / pn, y: cyy / pn } : { x: 0, y: 0 };
    const radius = Math.max(240, Math.sqrt(Math.max(1, lastView.nodes.length)) * 30);
    const adj = new Map<string, string[]>();
    for (const e of lastView.edges) {
      (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
      (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
    }
    const seeded = new Map<string, { x: number; y: number }>();
    let i = 0;
    for (const id of ids) {
      const el = cy.getElementById(id);
      if (el.empty()) continue;
      const nb = (adj.get(id) ?? [])
        .map((x) => placed.get(x) ?? seeded.get(x))
        .filter((p): p is { x: number; y: number } => p !== undefined);
      let p: { x: number; y: number };
      if (nb.length) {
        p = {
          x: nb.reduce((a, b) => a + b.x, 0) / nb.length,
          y: nb.reduce((a, b) => a + b.y, 0) / nb.length,
        };
      } else {
        const a = i * 2.399963229728653; // golden angle — even scatter
        p = { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
      }
      i++;
      el.position(p);
      seeded.set(id, p);
    }
  }

  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  /** Chunked element creation for very large graphs: the event loop
   *  breathes between chunks, progress is reported honestly, and a
   *  superseding render aborts the walk (the newer diff reconciles). */
  async function progressiveAdd(lists: EleDef[][], seq: number, total: number): Promise<void> {
    let done = 0;
    for (const list of lists) {
      for (let i = 0; i < list.length; i += PROGRESSIVE_CHUNK) {
        if (seq !== renderSeq || !cy) return;
        cy.add(list.slice(i, i + PROGRESSIVE_CHUNK));
        done += Math.min(PROGRESSIVE_CHUNK, list.length - i);
        emitLayout({ type: 'progress', layout: currentLayout, done, total });
        await tick();
      }
    }
  }

  /** End of a render pass: seed newcomers, restyle, then layout only
   *  when the canvas genuinely needs one — a refresh that kept ≥90% of
   *  positions skips it entirely (the measured cost driver). */
  function finishRender(addedNodeIds: string[], seq: number, firstRender: boolean): void {
    if (seq !== renderSeq || !cy) return;
    seedPositions(addedNodeIds);
    applyStates();
    const needLayout =
      firstRender ||
      addedNodeIds.length >
        Math.max(RELAYOUT_MIN, Math.ceil(lastView!.nodes.length * RELAYOUT_FRACTION));
    if (needLayout) {
      runLayout(currentLayout);
    } else {
      emitLayout({ type: 'skipped', layout: currentLayout });
      applyTier();
    }
  }

  /** Reconcile the canvas with the stored view + grouping spec —
   *  incremental: kept elements hold position and are field-synced,
   *  removals/inserts are minimal, and a full element wipe only ever
   *  happens on the very first render (§6.4 measured optimisation). */
  function render(): void {
    if (!cy || !lastView) return;
    const seq = ++renderSeq;
    viewNodes = new Map(lastView.nodes.map((n) => [n.id, n]));
    lastStats = graphStats(lastView.nodes, lastView.edges);
    const memberOf = new Map<string, string>();
    if (grouping) {
      for (const g of grouping.groups) for (const m of g.members) memberOf.set(m, g.id);
    }
    const groups = groupDefs();
    const nodes = nodeDefs(memberOf);
    const edges = edgeDefs();
    if (!incremental) {
      // pre-cycle-3 path — full wipe + bulk add + unconditional
      // relayout; kept so the benchmark's baseline mode measures the
      // real 2.1 cost, not a re-implementation of it.
      cy.elements().remove();
      const all = [...groups, ...nodes, ...edges];
      if (all.length) cy.add(all);
      applyStates();
      runLayout(currentLayout);
      return;
    }
    const wanted = new Set<string>([
      ...groups.map((d) => d.data['id'] as string),
      ...nodes.map((d) => d.data['id'] as string),
      ...edges.map((d) => d.data['id'] as string),
    ]);
    const firstRender = cy.elements().empty();
    if (!firstRender) {
      // removals first — incident edges of removed nodes go with them
      cy.elements()
        .filter((el) => !wanted.has(el.id()))
        .remove();
    }
    const missing = (d: EleDef) => cy!.getElementById(d.data['id'] as string).empty();
    const addG = groups.filter(missing);
    const addN = nodes.filter(missing);
    const addE = edges.filter(missing);
    // group containers land first so `move({parent})` below always finds
    // its target
    if (addG.length) cy.add(addG);
    if (!firstRender) {
      // field-sync what stays — cheap vs a rebuild and keeps honesty
      for (const d of groups) refreshElement(d);
      for (const d of nodes) refreshElement(d);
      for (const d of edges) refreshElement(d);
    }
    const addTotal = addG.length + addN.length + addE.length;
    if (addTotal > PROGRESSIVE_MIN) {
      void progressiveAdd([addN, addE], seq, addTotal).then(() =>
        finishRender(
          addN.map((d) => d.data['id'] as string),
          seq,
          firstRender,
        ),
      );
      return;
    }
    if (addN.length) cy.add(addN);
    if (addE.length) cy.add(addE);
    finishRender(
      addN.map((d) => d.data['id'] as string),
      seq,
      firstRender,
    );
  }

  /** Deterministic SVG projection of node positions — not a raster
   *  trace, so it works headless and stays diffable. */
  function svgProjection(): string | null {
    if (!cy) return null;
    const nodes = cy.nodes().filter((n) => !isGroupId(n.id()) && n.visible());
    if (!nodes.length) return null;
    const r = NODE_SIZE / 2;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    nodes.forEach((n) => {
      const p = n.position();
      minX = Math.min(minX, p.x - r);
      minY = Math.min(minY, p.y - r);
      maxX = Math.max(maxX, p.x + r);
      maxY = Math.max(maxY, p.y + r);
    });
    const w = maxX - minX + SVG_PAD * 2;
    const h = maxY - minY + SVG_PAD * 2 + 16; // room for labels
    const ox = SVG_PAD - minX;
    const oy = SVG_PAD - minY;
    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(w)}" height="${Math.ceil(h)}" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}">`,
      '<rect width="100%" height="100%" fill="white"/>',
    ];
    cy.edges()
      .filter((e) => e.visible())
      .forEach((e) => {
        const s = e.source().position();
        const t = e.target().position();
        const color = EDGE_STYLE[e.data('kind') as keyof typeof EDGE_STYLE]?.color ?? '#7d8894';
        const dash =
          e.data('line') === 'dashed' ? '5 3' : e.data('line') === 'dotted' ? '2 3' : null;
        parts.push(
          `<line x1="${(s.x + ox).toFixed(1)}" y1="${(s.y + oy).toFixed(1)}" x2="${(t.x + ox).toFixed(1)}" y2="${(t.y + oy).toFixed(1)}" stroke="${color}" stroke-width="1.5" opacity="0.8"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
        );
      });
    const byId = (a: cytoscape.NodeSingular, b: cytoscape.NodeSingular) =>
      a.id() < b.id() ? -1 : a.id() > b.id() ? 1 : 0;
    [...nodes].sort(byId).forEach((n) => {
      const kind = n.data('kind') as keyof typeof KIND_STYLE;
      const style = KIND_STYLE[kind];
      const p = n.position();
      const cx = p.x + ox;
      const cyv = p.y + oy;
      const dash = n.data('unverified') ? ' stroke-dasharray="4 3"' : '';
      const op = n.data('absent') ? 0.35 : n.data('unverified') ? 0.7 : 1;
      const stroke = n.data('failed') ? '#c0392b' : style.color;
      const attrs = `fill="${style.color}" stroke="${stroke}" stroke-width="1.5"${dash} opacity="${op}"`;
      const shape = style.shape as GraphNodeShape;
      if (shape === 'ellipse') {
        parts.push(
          `<ellipse cx="${cx.toFixed(1)}" cy="${cyv.toFixed(1)}" rx="${r}" ry="${r}" ${attrs}/>`,
        );
      } else if (shape === 'rectangle' || shape === 'round-rectangle') {
        const rx = shape === 'round-rectangle' ? ' rx="8"' : '';
        parts.push(
          `<rect x="${(cx - r).toFixed(1)}" y="${(cyv - r * 0.72).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 1.44).toFixed(1)}"${rx} ${attrs}/>`,
        );
      } else if (shape === 'star') {
        parts.push(`<polygon points="${starPoints(cx, cyv, r)}" ${attrs}/>`);
      } else {
        const sides =
          shape === 'triangle'
            ? 3
            : shape === 'pentagon'
              ? 5
              : shape === 'diamond' || shape === 'hexagon'
                ? 0
                : 6;
        const pts =
          shape === 'diamond'
            ? `${cx.toFixed(1)},${(cyv - r).toFixed(1)} ${(cx + r).toFixed(1)},${cyv.toFixed(1)} ${cx.toFixed(1)},${(cyv + r).toFixed(1)} ${(cx - r).toFixed(1)},${cyv.toFixed(1)}`
            : polygon(cx, cyv, r, sides);
        parts.push(`<polygon points="${pts}" ${attrs}/>`);
      }
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${(cyv + r + 13).toFixed(1)}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#4b5563">${esc(n.data('label') as string)}</text>`,
      );
    });
    parts.push('</svg>');
    return parts.join('\n');
  }

  return {
    mount(container: HTMLElement): void {
      cy = cytoscape({
        container,
        headless,
        elements: [],
        style: stylesheet(cssVar('--fg-text-2', '#4b5563'), cssVar('--fg-accent', '#e8611c')),
        boxSelectionEnabled: false,
        autoungrabify: false,
        userZoomingEnabled: true,
        userPanningEnabled: true,
        // viewport-move perf hints: edges/labels reappear when the
        // camera settles — raster-only, never a data change
        textureOnViewport: perfHints,
        hideEdgesOnViewport: perfHints,
        pixelRatio: 'auto',
      } as cytoscape.CytoscapeOptions);
      cy.on('tap', 'node', (evt) => {
        const id: string = evt.target.id();
        if (isGroupId(id)) return; // group boxes are containers, not data
        emit({ type: 'node', id });
      });
      cy.on('tap', 'edge', (evt) => emit({ type: 'edge', id: evt.target.id() }));
      cy.on('tap', (evt) => {
        if (evt.target === cy) emit(null);
      });
      cy.on('mouseover', 'node, edge', (evt) => {
        const el = evt.target;
        const id: string = el.id();
        if (isGroupId(id)) return;
        emitHover({ type: el.isNode() ? 'node' : 'edge', id });
      });
      cy.on('mouseout', 'node, edge', () => emitHover(null));
      cy.on('viewport', () => onViewport());
    },

    setData(view: GraphViewModel, opts?: { layout?: GraphLayoutName }): void {
      lastView = view;
      // a policy decision can ride with the data — the upcoming render
      // runs it directly instead of re-laying out the outgoing set
      if (opts?.layout) currentLayout = opts.layout;
      render();
    },

    select(id: string | null): void {
      selectedId = id;
      if (!cy) return;
      cy.$(':selected').unselect();
      if (id) cy.getElementById(id).select();
    },

    highlight(nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string>): void {
      fadedOn = nodeIds.size > 0;
      fadedNodes = new Set(nodeIds);
      fadedEdges = new Set(edgeIds);
      applyStates();
    },

    dimExcept(nodeIds: ReadonlySet<string> | null): void {
      dimSet = nodeIds ? new Set(nodeIds) : null;
      applyStates();
    },

    layout(name: GraphLayoutName): void {
      runLayout(name);
    },

    cancelLayout(): void {
      haltLayout('cancel');
    },

    onLayoutStatus(cb: (e: GraphLayoutEvent) => void): void {
      layoutListeners.push(cb);
    },

    fit(): void {
      cy?.fit(undefined, 36);
    },

    zoomTo(id: string): void {
      if (!cy) return;
      const el = cy.getElementById(id);
      if (el.empty() || !el.visible()) return;
      const target = Math.max(cy.zoom(), 1.3);
      if (animate) {
        cy.animate({ center: { eles: el }, zoom: target }, { duration: 180 });
      } else {
        cy.center(el);
        const pos = el.isNode() ? el.position() : (el as cytoscape.EdgeSingular).midpoint();
        cy.zoom({ level: target, position: pos });
      }
    },

    setGrouping(spec: GraphGrouping | null): void {
      grouping = spec;
      render();
    },

    setDiff(marks: GraphDiffMarks | null): void {
      diff = marks;
      applyStates();
    },

    viewport(): GraphViewport | null {
      return currentViewport();
    },

    setViewport(v: GraphViewport): void {
      if (!cy) return;
      cy.viewport({ zoom: v.zoom, pan: { x: v.panX, y: v.panY } });
      applyTier();
    },

    onViewport(cb: (v: GraphViewport) => void): void {
      viewportListeners.push(cb);
    },

    onHover(cb: (sel: GraphSelection | null) => void): void {
      hoverListeners.push(cb);
    },

    exportPng(): string | null {
      if (!cy) return null;
      try {
        return cy.png({ full: true, scale: 2, bg: cssVar('--fg-surface', '#ffffff') });
      } catch {
        return null; // headless hosts can't rasterize — honest null
      }
    },

    exportSvg(): string | null {
      return svgProjection();
    },

    onSelect(cb: (sel: GraphSelection | null) => void): void {
      listeners.push(cb);
    },

    nativeHandle(): unknown {
      return cy;
    },

    destroy(): void {
      if (vpTimer) clearTimeout(vpTimer);
      vpTimer = null;
      renderSeq++;
      const engine = cy;
      cy = null;
      if (activeLayout) {
        if (activeLayout.timer) {
          clearTimeout(activeLayout.timer);
          activeLayout.timer = null;
        }
        stopLayout(activeLayout.layout);
        activeLayout = null;
      }
      // A stopped layout's queued frame still calls cy methods on its
      // last tick — cy.destroy() before that lands crashes endBatch on
      // the null renderer (hit in the 10k benchmark). Poll briefly so
      // the engine dies only after in-flight frames settle; the 500 ms
      // cap bounds teardown when a frame never fires (≫ one 16 ms raf).
      const finish = (budget = 25): void => {
        if (!engine) return;
        if (inFlightLayoutFrames <= 0 || budget <= 0) {
          try {
            engine.destroy();
          } catch {
            /* engine already torn down */
          }
          return;
        }
        setTimeout(() => finish(budget - 1), 20);
      };
      finish();
      listeners.length = 0;
      hoverListeners.length = 0;
      viewportListeners.length = 0;
      layoutListeners.length = 0;
      fadedOn = false;
      fadedNodes = new Set();
      fadedEdges = new Set();
      dimSet = null;
      selectedId = null;
      lastView = null;
      lastStats = null;
      viewNodes = new Map();
      grouping = null;
      diff = null;
      tier = 'far';
    },
  };
}
