import { FedEdgeKind, FedNodeKind, FedSource, SourceAvailability } from './federated';

/**
 * §5.6 / Graph Studio 2.1 — canvas abstraction.
 *
 * The renderer boundary keeps the studio decoupled from any concrete
 * graph engine: business code (page, view-model) never imports the
 * rendering library — only this contract. Adapters live next to it
 * (`cytoscape-adapter.ts`) and are the only place an engine import is
 * allowed.
 *
 * Everything the renderer sees is presentation data: `GraphViewModel`
 * nodes/edges carry display fields derived from the honest `FedGraph`
 * model (`view-model.ts`). Canvas operations are visual only — no
 * mutation of the underlying model ever crosses this interface.
 */

/** Layouts the studio exposes. At least three must stay wired; five
 *  are shipped (cose force, concentric degree rings, grid, BFS
 *  breadthfirst hierarchy, circle). */
export type GraphLayoutName = 'cose' | 'concentric' | 'grid' | 'breadthfirst' | 'circle';

export const GRAPH_LAYOUTS: readonly GraphLayoutName[] = [
  'cose',
  'concentric',
  'grid',
  'breadthfirst',
  'circle',
];

/** Geometry vocab shared with adapters — engine-agnostic shape names. */
export type GraphNodeShape =
  'round-rectangle' | 'ellipse' | 'diamond' | 'hexagon' | 'triangle' | 'rectangle' | 'star';

/** Zoom-driven detail tiers: far = icon+label, mid = +state,
 *  near = +category/origin/degree. Adapters switch on zoom level. */
export type GraphDetailTier = 'far' | 'mid' | 'near';

export interface GraphNodeView {
  id: string;
  label: string;
  kind: FedNodeKind;
  /** No loaded endpoint could confirm the entity — render dashed. */
  unverified: boolean;
  /** Every endpoint that references it stayed unavailable — render
   *  extra dim (a stronger honesty signal than plain unverified). */
  absent: boolean;
  /** Descriptor-reported lifecycle state (verbatim, may be absent). */
  state?: string;
  /** Kind-scoped classification (domain/role/host/verb) when real. */
  category?: string;
  /** Declared origin Forja id when one exists. */
  origin?: string;
  /** Reported version when the source carries one. */
  version?: string;
  /** Incident edge count — real model degree, used for the near tier
   *  and the "connection count" cue. */
  degree: number;
  /** True when the descriptor reported a failure-shaped state
   *  (FAILED/DEGRADED/BLOCKED or a non-zero exit code). */
  failed: boolean;
}

export interface GraphEdgeView {
  id: string;
  source: string;
  target: string;
  kind: FedEdgeKind;
  /** The single endpoint that declared the relation. */
  evidence: FedSource;
  /** Availability of that endpoint — drives the line STYLE (solid /
   *  dashed / dotted), not a color-only cue. */
  evidenceState: SourceAvailability;
  /** `GET /api/v1/…` label of the evidence endpoint — hover/status
   *  text and inspector provenance. */
  evidenceEndpoint: string;
}

export interface GraphViewModel {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
}

export type GraphSelection = { type: 'node' | 'edge'; id: string };

/** Named grouping over the canvas. `members` lists node ids per group;
 *  `collapsed` names groups rendered folded (members hidden). Groups
 *  come straight from real model fields (kind, declared origin Forja,
 *  bound host) — never clusters inferred by shape alone. */
export interface GraphGrouping {
  groups: { id: string; label: string; members: string[] }[];
  collapsed: ReadonlySet<string>;
}

/** Canvas camera state — zoom level plus pan offset in model coords. */
export interface GraphViewport {
  zoom: number;
  panX: number;
  panY: number;
}

/** Diff overlay marks — computed upstream (snapshot.ts), rendered as
 *  element classes ('added'/'changed'). Removed elements have no
 *  canvas presence: the current canvas always shows current truth. */
export interface GraphDiffMarks {
  nodes: ReadonlyMap<string, 'added' | 'changed'>;
  edges: ReadonlyMap<string, 'added' | 'changed'>;
}

/**
 * A pluggable canvas engine. `exportPng`/`exportSvg` return `null`
 * when the running host cannot rasterize (e.g. headless test envs) —
 * callers must treat `null` as "export unavailable", never as data.
 */
export interface GraphRenderer {
  /** Attach to a container. Called once per mount. */
  mount(container: HTMLElement): void;
  /** Replace the whole dataset (already sorted/deduped upstream). */
  setData(view: GraphViewModel): void;
  /** Visually select one element (node or edge id); null clears. */
  select(id: string | null): void;
  /** Neighborhood emphasis: keep these ids lit, dim the rest. */
  highlight(nodeIds: ReadonlySet<string>, edgeIds: ReadonlySet<string>): void;
  /** Dim every node outside `nodeIds`; null clears the dim. */
  dimExcept(nodeIds: ReadonlySet<string> | null): void;
  /** Re-run a named layout. Selection is preserved. */
  layout(name: GraphLayoutName): void;
  /** Fit the whole graph into the viewport. */
  fit(): void;
  /** Center + zoom on one element. */
  zoomTo(id: string): void;
  /** Apply/remove compound group containers. Null clears grouping. */
  setGrouping(grouping: GraphGrouping | null): void;
  /** Apply/remove diff overlay classes. Null clears. */
  setDiff(marks: GraphDiffMarks | null): void;
  /** Current camera state, or null before mount. */
  viewport(): GraphViewport | null;
  /** Restore a previously captured camera state. */
  setViewport(v: GraphViewport): void;
  /** Subscribe to camera changes (zoom/pan), throttled by the adapter. */
  onViewport(cb: (v: GraphViewport) => void): void;
  /** Subscribe to pointer hover over elements — status-line provenance,
   *  not tooltips (canvas has no DOM tooltips). */
  onHover(cb: (sel: GraphSelection | null) => void): void;
  /** PNG data URI of the canvas, or null when raster is unavailable. */
  exportPng(): string | null;
  /** SVG markup projected from node positions, or null. */
  exportSvg(): string | null;
  /** Subscribe to pointer selection on the canvas. */
  onSelect(cb: (sel: GraphSelection | null) => void): void;
  /** The underlying engine instance (cytoscape `Core` for the shipped
   *  adapter) — read-only escape hatch for tests and advanced hosts;
   *  business logic must stay on this contract. Null before mount /
   *  after destroy. */
  nativeHandle(): unknown;
  /** Release the engine and its DOM. */
  destroy(): void;
}
