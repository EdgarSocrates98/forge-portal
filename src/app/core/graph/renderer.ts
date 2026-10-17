import { FedEdgeKind, FedNodeKind, FedSource } from './federated';

/**
 * §5.6 — Graph Studio canvas abstraction.
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

/** Layouts the studio exposes. At least three must stay wired. */
export type GraphLayoutName = 'cose' | 'concentric' | 'grid' | 'breadthfirst';

export const GRAPH_LAYOUTS: readonly GraphLayoutName[] = [
  'cose',
  'concentric',
  'grid',
  'breadthfirst',
];

/** Geometry vocab shared with adapters — engine-agnostic shape names. */
export type GraphNodeShape =
  'round-rectangle' | 'ellipse' | 'diamond' | 'hexagon' | 'triangle' | 'rectangle' | 'star';

export interface GraphNodeView {
  id: string;
  label: string;
  kind: FedNodeKind;
  /** No loaded endpoint could confirm the entity — render dashed. */
  unverified: boolean;
  /** Every endpoint that references it stayed unavailable — render
   *  extra dim (a stronger honesty signal than plain unverified). */
  absent: boolean;
}

export interface GraphEdgeView {
  id: string;
  source: string;
  target: string;
  kind: FedEdgeKind;
  /** The single endpoint that declared the relation. */
  evidence: FedSource;
}

export interface GraphViewModel {
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
}

export type GraphSelection = { type: 'node' | 'edge'; id: string };

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
