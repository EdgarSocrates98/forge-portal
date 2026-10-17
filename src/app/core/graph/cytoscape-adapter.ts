import cytoscape from 'cytoscape';
import { EDGE_STYLE, KIND_STYLE } from './view-model';
import {
  GraphLayoutName,
  GraphNodeShape,
  GraphRenderer,
  GraphSelection,
  GraphViewModel,
} from './renderer';

/**
 * §5.6 — Cytoscape.js adapter for the GraphRenderer contract.
 *
 * The only file allowed to import `cytoscape` — everything upstream
 * (view model, page) speaks the engine-agnostic contract in
 * `renderer.ts`. The adapter carries no business logic: it projects
 * `GraphViewModel` elements, maps honesty flags to visual states
 * (`unverified` → dashed border, `absent` → extra dim), and reports
 * pointer selection back through `onSelect`.
 *
 * Hosts without a 2D canvas (jsdom tests) run headless: layout,
 * selection and the SVG projection still work; `exportPng` returns
 * null because no rasterizer exists — an honest "unavailable", not a
 * failure.
 */

export interface CytoscapeRendererOptions {
  /** Force headless mode (no canvas renderer). Auto-detected when unset. */
  headless?: boolean;
  /** Animate layout transitions. Caller passes false under
   *  `prefers-reduced-motion`; viewport ops stay instant either way. */
  animate?: boolean;
}

const NODE_SIZE = 46;
const SVG_PAD = 48;

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

export function createCytoscapeRenderer(opts: CytoscapeRendererOptions = {}): GraphRenderer {
  const headless = opts.headless ?? !canRaster();
  // Headless hosts have nothing to animate (and cytoscape's animated
  // refresh loop dereferences the absent renderer) — force instant.
  const animate = (opts.animate ?? true) && !headless;
  const listeners: ((sel: GraphSelection | null) => void)[] = [];

  let cy: cytoscape.Core | null = null;
  // Honesty/emphasis state survives setData rebuilds.
  let fadedNodes = new Set<string>();
  let fadedEdges = new Set<string>();
  let fadedOn = false;
  let dimSet: Set<string> | null = null;
  let selectedId: string | null = null;
  let currentLayout: GraphLayoutName = 'cose';

  const emit = (sel: GraphSelection | null): void => {
    for (const cb of listeners) cb(sel);
  };

  function stylesheet(labelColor: string, accent: string): cytoscape.StylesheetJson {
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
          label: 'data(label)',
          'font-size': 10,
          color: labelColor,
          'text-valign': 'bottom',
          'text-halign': 'center',
          'text-margin-y': 5,
          'text-wrap': 'ellipsis',
          'text-max-width': '110px',
          'border-width': 1.5,
          'border-color': 'data(color)',
          'border-opacity': 0.9,
          'background-opacity': 0.92,
        },
      },
      ...kindRules,
      {
        selector: 'edge',
        style: {
          width: 1.6,
          'curve-style': 'bezier',
          'target-arrow-shape': 'triangle',
          'target-arrow-fill': 'filled',
          'arrow-scale': 0.9,
          label: 'data(kind)',
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

  function applyStates(): void {
    if (!cy) return;
    const nodes = cy.nodes();
    const edges = cy.edges();
    nodes.removeClass('nh faded dimmed');
    edges.removeClass('nh faded');
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
    if (selectedId) cy.getElementById(selectedId).select();
  }

  function runLayout(name: GraphLayoutName): void {
    if (!cy) return;
    const options: cytoscape.LayoutOptions = { name, animate, fit: false };
    if (name === 'concentric') {
      (options as cytoscape.ConcentricLayoutOptions).concentric = (n) => n.degree(false);
      (options as cytoscape.ConcentricLayoutOptions).levelWidth = () => 2;
    }
    const layout = cy.layout(options);
    layout.one('layoutstop', () => cy?.fit(undefined, 36));
    layout.run();
  }

  /** Deterministic SVG projection of node positions — not a raster
   *  trace, so it works headless and stays diffable. */
  function svgProjection(): string | null {
    if (!cy) return null;
    const nodes = cy.nodes();
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
    cy.edges().forEach((e) => {
      const s = e.source().position();
      const t = e.target().position();
      const color = EDGE_STYLE[e.data('kind') as keyof typeof EDGE_STYLE]?.color ?? '#7d8894';
      parts.push(
        `<line x1="${(s.x + ox).toFixed(1)}" y1="${(s.y + oy).toFixed(1)}" x2="${(t.x + ox).toFixed(1)}" y2="${(t.y + oy).toFixed(1)}" stroke="${color}" stroke-width="1.5" opacity="0.8"/>`,
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
      const attrs = `fill="${style.color}" stroke="${style.color}" stroke-width="1.5"${dash} opacity="${op}"`;
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
        const sides = shape === 'triangle' ? 3 : shape === 'diamond' || shape === 'hexagon' ? 0 : 6;
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
      });
      cy.on('tap', 'node', (evt) => emit({ type: 'node', id: evt.target.id() }));
      cy.on('tap', 'edge', (evt) => emit({ type: 'edge', id: evt.target.id() }));
      cy.on('tap', (evt) => {
        if (evt.target === cy) emit(null);
      });
    },

    setData(view: GraphViewModel): void {
      if (!cy) return;
      cy.elements().remove();
      cy.add([
        ...view.nodes.map((n) => ({
          data: {
            id: n.id,
            label: n.label,
            kind: n.kind,
            color: KIND_STYLE[n.kind].color,
            unverified: n.unverified,
            absent: n.absent,
          },
          classes: `${n.unverified ? 'unverified' : ''}${n.absent ? ' absent' : ''}`.trim(),
        })),
        ...view.edges.map((e) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            kind: e.kind,
            evidence: e.evidence,
          },
        })),
      ]);
      applyStates();
      runLayout(currentLayout);
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
      currentLayout = name;
      runLayout(name);
    },

    fit(): void {
      cy?.fit(undefined, 36);
    },

    zoomTo(id: string): void {
      if (!cy) return;
      const el = cy.getElementById(id);
      if (el.empty()) return;
      const target = Math.max(cy.zoom(), 1.3);
      if (animate) {
        cy.animate({ center: { eles: el }, zoom: target }, { duration: 180 });
      } else {
        cy.center(el);
        const pos = el.isNode() ? el.position() : (el as cytoscape.EdgeSingular).midpoint();
        cy.zoom({ level: target, position: pos });
      }
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
      cy?.destroy();
      cy = null;
      listeners.length = 0;
      fadedOn = false;
      fadedNodes = new Set();
      fadedEdges = new Set();
      dimSet = null;
      selectedId = null;
    },
  };
}
