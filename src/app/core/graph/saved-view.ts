import { FedNodeKind } from './federated';
import { GraphLayoutName, GraphViewport } from './renderer';
import { GraphGroupBy } from './view-model';

/**
 * Graph Studio 2.1 §5.9 — saved view state.
 *
 * One schema-versioned localStorage record (`forge-portal/graph-view/v1`)
 * carrying only view preferences: mode, layout, camera, filters,
 * selection ids, grouping. No secrets, no entity data — the graph
 * itself is always rebuilt live; a restored selection that no longer
 * exists simply does not resolve.
 *
 * Corrupt or foreign payloads return null — never a partial apply.
 */

export const GRAPH_VIEW_KEY = 'forge-portal/graph-view/v1';
export const GRAPH_VIEW_SCHEMA = 'forge-portal/GraphView/v1';

export interface GraphViewState {
  schema: typeof GRAPH_VIEW_SCHEMA;
  mode: 'list' | 'canvas';
  layout: GraphLayoutName;
  /** Cycle 3: adaptive-layout mode — optional; absent ⇒ auto, the
   *  honest default for records written before the policy shipped. */
  layoutAuto?: boolean;
  query: string;
  kind: FedNodeKind | null;
  selectedNode: string | null;
  selectedEdge: string | null;
  viewport: GraphViewport | null;
  groupBy: GraphGroupBy | null;
  collapsedGroups: string[];
  /** lf-0023 explorer plane: which model the page renders and which
   *  view inside the bundle. Optional — records written before the
   *  explorer shipped simply leave them absent (federation overlay). */
  scope?: 'federation' | 'views';
  viewIdx?: number;
  provider?: string | null;
}

const LAYOUTS = new Set(['cose', 'concentric', 'grid', 'breadthfirst', 'circle']);
const GROUPS = new Set(['kind', 'forge', 'host']);

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Strict parse — every field validated; anything unexpected → null. */
export function parseViewState(raw: unknown): GraphViewState | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o['schema'] !== GRAPH_VIEW_SCHEMA) return null;
  const mode = o['mode'] === 'list' || o['mode'] === 'canvas' ? o['mode'] : null;
  const layout = LAYOUTS.has(o['layout'] as string) ? (o['layout'] as GraphLayoutName) : null;
  if (!mode || !layout) return null;
  const vp = o['viewport'];
  const viewport =
    vp && typeof vp === 'object'
      ? ((): GraphViewport | null => {
          const p = vp as Record<string, unknown>;
          const zoom = num(p['zoom']);
          const panX = num(p['panX']);
          const panY = num(p['panY']);
          return zoom !== null && panX !== null && panY !== null ? { zoom, panX, panY } : null;
        })()
      : null;
  const groupBy = GROUPS.has(o['groupBy'] as string) ? (o['groupBy'] as GraphGroupBy) : null;
  return {
    schema: GRAPH_VIEW_SCHEMA,
    mode,
    layout,
    layoutAuto: o['layoutAuto'] === false ? false : true,
    query: str(o['query']) ?? '',
    // open kind space — any declared kind string is a valid filter
    // (overlay kinds + engine projection kinds)
    kind: typeof o['kind'] === 'string' ? (o['kind'] as FedNodeKind) : null,
    selectedNode: str(o['selectedNode']),
    selectedEdge: str(o['selectedEdge']),
    viewport,
    groupBy,
    collapsedGroups: Array.isArray(o['collapsedGroups'])
      ? o['collapsedGroups'].filter((x): x is string => typeof x === 'string')
      : [],
    scope:
      o['scope'] === 'federation' || o['scope'] === 'views'
        ? (o['scope'] as 'federation' | 'views')
        : undefined,
    viewIdx: num(o['viewIdx']) ?? undefined,
    provider: str(o['provider']),
  };
}

/** Storage-shaped read — returns null on absence, corruption or a
 *  foreign schema. Storage failures (private mode, quota) degrade to
 *  null: a saved view is a convenience, never a requirement. */
export function loadViewState(storage: Pick<Storage, 'getItem'> | null): GraphViewState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GRAPH_VIEW_KEY);
    if (!raw) return null;
    return parseViewState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveViewState(
  storage: Pick<Storage, 'setItem'> | null,
  state: GraphViewState,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(GRAPH_VIEW_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearViewState(storage: Pick<Storage, 'removeItem'> | null): void {
  try {
    storage?.removeItem(GRAPH_VIEW_KEY);
  } catch {
    /* storage may be blocked — clearing is best-effort */
  }
}
