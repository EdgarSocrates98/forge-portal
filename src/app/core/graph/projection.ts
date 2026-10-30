import {
  FedGraph,
  FedNode,
  FedEdge,
  FedSource,
  FedSourceInfo,
  SourceAvailability,
  SOURCE_ENDPOINT,
  FED_GRAPH_SCHEMA,
} from './federated';

/**
 * lf-0023 — ForgeGraphView/v1 → FedGraph projection model.
 *
 * The CLI `graph ui` renders the raw `forge/ForgeGraphView/v1` document
 * each Forge serves; the portal must show the SAME vertex/edge set —
 * same ids, same relations, same provenance — never a re-modelled
 * approximation. This module is a pure, deterministic map of the
 * contract document onto the studio's render model (`FedGraph`):
 *
 *   node.id       = document node id            (verbatim — parity)
 *   node.kind     = document node kind          (verbatim — open space)
 *   node.origin   = node.source_provider        (per-element forge)
 *   node.meta     = attributes + epistemic_state + provider + refs
 *   edge.*        = verbatim id/source/target/kind/provenance/
 *                   epistemic_state/attributes
 *
 * A view that is already a `federated_merge` product (the-forge's
 * `/graphs` serves exactly that, provider-namespaced, domain
 * 'federated') flows through unchanged — per-element `source_provider`
 * IS the forge provenance, and each provider's subgraph stays a
 * separate component (cross-forge relations are never inferred, per
 * the contract).
 *
 * When a bundle carries >1 unmerged view, `mergeViews` composes them
 * exactly like `theforge.graphview.federated_merge` (provider-namespaced
 * ids, `{provider}/{provenance}` edge provenance, no cross-forge edges)
 * — the portal composes data, it never invents relations.
 */

export const VIEW_SCHEMA = 'forge/ForgeGraphView/v1';
export const MERGED_PROVIDER = 'the-forge';
export const MERGED_DOMAIN = 'federated';

export interface ViewInfo {
  /** descriptor.graph_id — the selector's stable label. */
  graphId: string;
  providerId: string;
  domain: string;
  nodeCount: number;
  edgeCount: number;
  /** descriptor.capabilities — which explorer affordances the producer
   *  declared real (search/filter/inspect…). */
  capabilities: string[];
  /** descriptor.limitations — truncation/notes the producer declared. */
  limitations: string[];
  /** Present only on the-forge's merged view: per-provider notes the
   *  server collected while gathering views. */
  federationNotes: string[];
  /** True when the document is a federated_merge product. */
  merged: boolean;
}

const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Meta values render as text — scalars pass through; nested values are
 *  kept as their JSON text (still the real data, never dropped). */
const scalar = (v: unknown): string | number | boolean | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return v;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

/** Parse the descriptor block of a view document — null when it is not
 *  a ForgeGraphView/v1 document (never silently accepted). */
export function viewInfo(view: unknown): ViewInfo | null {
  const v = obj(view);
  if (!v || v['schema'] !== VIEW_SCHEMA) return null;
  const d = obj(v['descriptor']);
  const nodes = Array.isArray(v['nodes']) ? v['nodes'] : [];
  const edges = Array.isArray(v['edges']) ? v['edges'] : [];
  const providerId = txt(d?.['provider_id']) ?? 'unknown';
  const domain = txt(d?.['domain']) ?? '';
  const info: ViewInfo = {
    graphId: txt(d?.['graph_id']) ?? providerId,
    providerId,
    domain,
    nodeCount: typeof d?.['node_count'] === 'number' ? (d['node_count'] as number) : nodes.length,
    edgeCount: typeof d?.['edge_count'] === 'number' ? (d['edge_count'] as number) : edges.length,
    capabilities: Array.isArray(d?.['capabilities'])
      ? (d!['capabilities'] as unknown[]).map((x) => String(x))
      : [],
    limitations: Array.isArray(d?.['limitations'])
      ? (d!['limitations'] as unknown[]).map((x) => String(x))
      : [],
    federationNotes: Array.isArray(v['federation_notes'])
      ? (v['federation_notes'] as unknown[]).map((x) => String(x))
      : [],
    merged: domain === MERGED_DOMAIN,
  };
  return info;
}

/** A node's declared producing forge — `source_provider` when present,
 *  falling back to the document's provider (a node with no explicit
 *  provenance was still emitted by that document's engine). */
function nodeProvider(n: Record<string, unknown>, docProvider: string): string {
  return txt(n['source_provider']) ?? docProvider;
}

/**
 * Faithful port of `theforge.graphview.federated_merge`: node/edge ids
 * gain a `<provider_id>:` prefix so identically-named entities across
 * forges never silently unify. Cross-forge relations are NOT inferred —
 * only native edges survive. Nodes already carrying the provider prefix
 * (a merged doc re-processed) keep their id, so the merge is idempotent
 * for `federated` documents fed back through.
 */
export function mergeViews(views: readonly unknown[]): Record<string, unknown> | null {
  const parsed = views
    .map((v) => ({ doc: obj(v), info: viewInfo(v) }))
    .filter((x) => x.doc !== null && x.info !== null);
  if (!parsed.length) return null;
  if (parsed.length === 1) return parsed[0].doc;

  const nodes: unknown[] = [];
  const edges: unknown[] = [];
  for (const { doc, info } of parsed) {
    const pid = info!.providerId;
    for (const raw of (doc!['nodes'] as unknown[]) ?? []) {
      const n = obj(raw);
      if (!n) continue;
      const id = txt(n['id']);
      if (!id) continue;
      // an element's OWN source_provider namespaces it — in a merged
      // doc that is the original producer, so re-merging stays
      // idempotent (never `the-forge:spark-forge-aws:x`).
      const sp = txt(n['source_provider']) ?? pid;
      const already = id.startsWith(`${sp}:`);
      nodes.push({
        ...n,
        id: already ? id : `${sp}:${id}`,
        source_provider: sp,
        attributes: {
          ...(obj(n['attributes']) ?? {}),
          ...(already ? {} : { provider_node_id: id }),
        },
      });
    }
    for (const raw of (doc!['edges'] as unknown[]) ?? []) {
      const e = obj(raw);
      if (!e) continue;
      const id = txt(e['id']);
      const src = txt(e['source']);
      const tgt = txt(e['target']);
      if (!id || !src || !tgt) continue;
      // the edge's producer = provenance prefix when declared
      // (`{provider}/{provenance}` in a merged doc), else the view's.
      const prov = txt(e['provenance']);
      const sp = prov?.includes('/') ? prov.split('/')[0] : pid;
      const already = id.startsWith(`${sp}:`);
      edges.push({
        ...e,
        id: already ? id : `${sp}:${id}`,
        source: already || src.startsWith(`${sp}:`) ? src : `${sp}:${src}`,
        target: already || tgt.startsWith(`${sp}:`) ? tgt : `${sp}:${tgt}`,
        provenance: `${sp}/${prov?.includes('/') ? prov.slice(prov.indexOf('/') + 1) : (prov ?? 'unknown')}`,
      });
    }
  }
  return {
    schema: VIEW_SCHEMA,
    descriptor: {
      graph_schema: 'forge/GraphDescriptor/v1',
      graph_id: 'federated',
      provider_id: MERGED_PROVIDER,
      domain: MERGED_DOMAIN,
      node_count: nodes.length,
      edge_count: edges.length,
      capabilities: ['node_inspect', 'edge_inspect', 'search', 'filter', 'export'],
      limitations: [
        'cross-forge relations are not inferred; each subgraph keeps ' +
          'its own provenance and namespace',
      ],
    },
    nodes,
    edges,
  };
}

/** Per-element forge counts — `{provider: nodes}` over the model's
 *  `origin` field (== the document's `source_provider`). Only providers
 *  that actually emitted elements appear. */
export function providerCounts(g: FedGraph): { provider: string; count: number }[] {
  const m = new Map<string, number>();
  for (const n of g.nodes) {
    const p = n.origin ?? 'unknown';
    m.set(p, (m.get(p) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
}

/**
 * Map one view document onto the render model. `graphsAvail` is the
 * availability of `/api/v1/graphs` observed by the page — the model's
 * only evidence source (the projection never credits endpoints it did
 * not read).
 */
export function buildProjectionGraph(
  view: Record<string, unknown>,
  graphsAvail: SourceAvailability,
): FedGraph {
  const info = viewInfo(view);
  const docProvider = info?.providerId ?? 'unknown';

  const nodes: FedNode[] = [];
  const edges: FedEdge[] = [];

  for (const raw of (view['nodes'] as unknown[]) ?? []) {
    const n = obj(raw);
    if (!n) continue;
    const id = txt(n['id']);
    if (!id) continue;
    const epistemic = txt(n['epistemic_state']) ?? 'unknown';
    const provider = nodeProvider(n, docProvider);
    const meta: Record<string, string | number | boolean | null> = {};
    const attrs = obj(n['attributes']);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        const s = scalar(v);
        if (s !== undefined) meta[k] = s;
      }
    }
    meta['epistemic'] = epistemic;
    meta['provider'] = provider;
    const snap = txt(n['snapshot_ref']);
    if (snap) meta['snapshot_ref'] = snap;
    const evRefs = n['evidence_refs'];
    if (Array.isArray(evRefs) && evRefs.length) {
      meta['evidence_refs'] = evRefs.map((x) => String(x)).join(' ');
    }
    nodes.push({
      id,
      kind: txt(n['kind']) ?? 'unknown',
      label: txt(n['label']) ?? id,
      evidence: ['graphs'],
      // 'unknown' epistemic is the model's honest "not confirmed" flag;
      // every other declared state stays visible in meta.epistemic.
      unverified: epistemic === 'unknown',
      category: txt(n['domain']) ?? undefined,
      origin: provider,
      meta,
    });
  }

  for (const raw of (view['edges'] as unknown[]) ?? []) {
    const e = obj(raw);
    if (!e) continue;
    const id = txt(e['id']);
    const src = txt(e['source']);
    const tgt = txt(e['target']);
    if (!id || !src || !tgt) continue;
    const meta: Record<string, string | number | boolean | null> = {};
    const attrs = obj(e['attributes']);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        const s = scalar(v);
        if (s !== undefined) meta[k] = s;
      }
    }
    const conf = e['confidence'];
    if (typeof conf === 'number') meta['confidence'] = conf;
    const temporal = obj(e['temporal']);
    if (temporal) {
      for (const [k, v] of Object.entries(temporal)) {
        const s = scalar(v);
        if (s !== undefined) meta[`t.${k}`] = s;
      }
    }
    const evRefs = e['evidence_refs'];
    if (Array.isArray(evRefs) && evRefs.length) {
      meta['evidence_refs'] = evRefs.map((x) => String(x)).join(' ');
    }
    const edge: FedEdge = {
      id,
      source: src,
      target: tgt,
      kind: txt(e['kind']) ?? 'unknown',
      evidence: 'graphs',
      prov: txt(e['provenance']) ?? undefined,
      epistemic: txt(e['epistemic_state']) ?? undefined,
    };
    if (Object.keys(meta).length) edge.meta = meta;
    edges.push(edge);
  }

  const counts = {} as Record<string, number>;
  for (const n of nodes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;

  const sources = {} as Record<FedSource, FedSourceInfo>;
  for (const s of Object.keys(SOURCE_ENDPOINT) as FedSource[]) {
    sources[s] = {
      state: s === 'graphs' ? graphsAvail : 'unavailable',
      endpoint: SOURCE_ENDPOINT[s],
    };
  }

  return {
    schema: FED_GRAPH_SCHEMA,
    nodes,
    edges,
    counts: counts as FedGraph['counts'],
    sources,
  };
}
