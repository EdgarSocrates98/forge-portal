import { FedNode, FedNodeKind } from './federated';

/**
 * Contextual navigation from a federated-graph entity to the feature
 * page that actually owns it.
 *
 * Every mapping here is backed by a real route plus a real binding —
 * `?q=`/`?task=`/`?server=` route inputs (withComponentInputBinding)
 * or a `#host-*` fragment rendered by the Hosts page. Kinds with no
 * owning surface (today: `capability`, whose catalog already lives
 * under its declaring forge) return null rather than a pretend link.
 *
 * Nothing is inferred: the link target names the entity id exactly as
 * the source descriptor reported it — filtering/scrolling resolves it
 * on the destination page.
 */
export interface EntityLink {
  /** RouterLink commands. */
  readonly commands: readonly string[];
  /** Optional query params (deep-link filters/selectors). */
  readonly queryParams?: Record<string, string>;
  /** Optional fragment (Hosts page `#host-<id>` anchors). */
  readonly fragment?: string;
  /** `nav.*` i18n key naming the destination page. */
  readonly navKey: string;
}

const LINKS: Record<FedNodeKind, (id: string) => EntityLink | null> = {
  forge: (id) => ({ commands: ['/forges', id], navKey: 'nav.forges' }),
  capability: () => null, // no dedicated surface — the declaring forge carries it
  skill: (id) => ({ commands: ['/skills'], queryParams: { q: id }, navKey: 'nav.skills' }),
  agent: (id) => ({ commands: ['/agents'], queryParams: { q: id }, navKey: 'nav.agents' }),
  mcp: (id) => ({ commands: ['/mcp'], queryParams: { server: id }, navKey: 'nav.mcp' }),
  host: (id) => ({ commands: ['/hosts'], fragment: `host-${id}`, navKey: 'nav.hosts' }),
  operation: (id) => ({
    commands: ['/tasks'],
    queryParams: { task: id },
    navKey: 'nav.tasks',
  }),
};

/** Deep link for a raw `kind:entityId` node id — splits on the first
 *  colon so entity ids may contain ':' without breaking the parse. */
export function entityLinkForId(nodeId: string): EntityLink | null {
  const cut = nodeId.indexOf(':');
  if (cut < 0) return null;
  const kind = nodeId.slice(0, cut) as FedNodeKind;
  const mapper = LINKS[kind];
  return mapper ? mapper(nodeId.slice(cut + 1)) : null;
}

/** Deep link for a FedNode — same rules as `entityLinkForId`. */
export function entityLink(node: Pick<FedNode, 'kind' | 'id'>): EntityLink | null {
  return entityLinkForId(node.id.startsWith(`${node.kind}:`) ? node.id : `${node.kind}:${node.id}`);
}
