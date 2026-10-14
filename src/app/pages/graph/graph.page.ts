import { Component, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  AgentDescriptor,
  GraphBundle,
  HostDetection,
  McpServerDescriptor,
  PortalCapability,
  SkillDescriptor,
  TaskExecution,
} from '../../core/api/api.models';
import {
  FED_NODE_KINDS,
  FedEdge,
  FedGraph,
  FedNode,
  FedNodeKind,
  FedSource,
  SOURCE_ENDPOINT,
  SourceAvailability,
  buildFederatedGraph,
  nodeNeighbors,
} from '../../core/graph/federated';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { UiFilterBar } from '../../shared/filter-bar';
import { Source, toApiError } from '../explorer/forges.data';

type StudioSource = Exclude<FedSource, 'graphs' | 'bootstrap'>;

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * §5.6 — Federated Graph Studio.
 *
 * Two layers, both honest:
 *
 * - PER-FORJA VIEWS (kept): the real `ForgeGraphView/v1` documents the
 *   serving Forja's engine already produced (§7.2 — the portal reuses
 *   that engine, it never runs one) plus the external `studio_url` link
 *   and the `no_graph` empty state.
 * - FEDERATED MODEL: `buildFederatedGraph` composes one deterministic
 *   overlay from the real adapter ops (/capabilities, /skills, /agents,
 *   /mcp/servers, /hosts, /tasks, /graphs). Nodes are entities, edges
 *   are relations a descriptor actually declared — never inferred.
 *
 * Studio surface (data views, no canvas): search, kind chips, a node
 * inspector with evidence + a direct-neighbors impact list, an export
 * button for the FedGraph JSON, unverified nodes rendered dashed, and
 * a source-availability strip naming which endpoints loaded vs stayed
 * unverified.
 */
@Component({
  selector: 'page-graph',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton, UiFilterBar],
  template: `
    <ui-page-header [title]="'graph.title' | t" [subtitle]="'graph.subtitle' | t">
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="card" [lines]="2" />
      </div>
    }

    @if (bundle(); as b) {
      @if (b.availability.state === 'available') {
        <section class="card">
          @if (b.studio_url) {
            <a class="btn btn--primary" [href]="b.studio_url" target="_blank" rel="noopener">
              {{ 'graph.open' | t }}
              <ui-icon name="external" [size]="14" />
            </a>
          }
          <ul class="views">
            @for (v of b.views; track $index) {
              <li>
                <strong><ui-icon name="graph" [size]="14" />{{ viewName(v) }}</strong>
                <span class="muted">
                  {{ 'graph.nodes' | t: { count: viewNodes(v) } }} ·
                  {{ 'graph.edges' | t: { count: viewEdges(v) } }}
                </span>
              </li>
            }
          </ul>
        </section>
      } @else {
        <ui-empty
          icon="graph"
          [title]="'graph.unavailable' | t"
          [hint]="b.availability.unlock ?? ('graph.buildHint' | t)"
        />
      }
    }

    @if (fed(); as g) {
      <section class="card fed" data-section="federated">
        <header class="fed__head">
          <h2>
            <ui-icon name="network" [size]="15" />
            {{ 'graph.fed.title' | t }}
            <span class="chip">{{ 'graph.federated' | t }}</span>
          </h2>
          <button class="btn" (click)="exportGraph()" [disabled]="!g.nodes.length">
            <ui-icon name="external" [size]="14" />
            {{ 'graph.fed.export' | t }}
          </button>
        </header>

        <ul class="fed__sources" data-strip="sources" [attr.aria-label]="'graph.fed.sources' | t">
          @for (s of sourceList(g); track s.id) {
            <li [attr.data-source]="s.id" [attr.data-state]="s.info.state">
              <code>{{ s.info.endpoint }}</code>
              <ui-state-badge
                [state]="sourceBadge(s.info.state)"
                [labelOverride]="'graph.source.' + s.info.state | t"
              />
            </li>
          }
        </ul>
        <p class="muted">{{ 'graph.fed.evidenceNote' | t }}</p>

        @if (g.nodes.length) {
          <ui-filter-bar [(query)]="query" [placeholder]="'graph.fed.search' | t">
            <button
              class="fg-pill"
              type="button"
              [attr.data-tone]="kind() === null ? 'accent' : null"
              [attr.aria-pressed]="kind() === null"
              (click)="kind.set(null)"
            >
              {{ 'state.all' | t }} · {{ g.nodes.length }}
            </button>
            @for (k of kindOptions(g); track k) {
              <button
                class="fg-pill"
                type="button"
                [attr.data-tone]="kind() === k ? 'accent' : null"
                [attr.aria-pressed]="kind() === k"
                [attr.data-kind-chip]="k"
                (click)="toggleKind(k)"
              >
                {{ k }} · {{ g.counts[k] }}
              </button>
            }
          </ui-filter-bar>
        }

        @if (selected(); as sel) {
          <section class="card fed__detail" data-section="inspector" aria-live="polite">
            <header class="fed__detail-head">
              <h2>
                <ui-icon name="graph" [size]="15" />{{ sel.label }}
                @if (sel.unverified) {
                  <ui-state-badge state="unverified" />
                }
              </h2>
              <button
                class="icon-btn"
                (click)="selected.set(null)"
                [attr.aria-label]="'state.close' | t"
              >
                <ui-icon name="chevron-right" [size]="14" />
              </button>
            </header>
            <dl class="kv">
              <div>
                <dt>{{ 'table.id' | t }}</dt>
                <dd>
                  <code>{{ sel.id }}</code>
                </dd>
              </div>
              <div>
                <dt>{{ 'graph.fed.kind' | t }}</dt>
                <dd>
                  <code>{{ sel.kind }}</code>
                </dd>
              </div>
              <div>
                <dt>{{ 'graph.fed.verification' | t }}</dt>
                <dd>
                  <ui-state-badge
                    [state]="sel.unverified ? 'unverified' : 'ok'"
                    [labelOverride]="
                      (sel.unverified ? 'state.unverified' : 'graph.fed.observed') | t
                    "
                  />
                </dd>
              </div>
              <div>
                <dt>{{ 'skills.evidence' | t }}</dt>
                <dd class="fed__evidence">
                  @for (src of sel.evidence; track src) {
                    <code>{{ endpointFor(src) }}</code>
                  }
                </dd>
              </div>
            </dl>
            <h3 class="fed__impact muted">{{ 'graph.fed.impact' | t }}</h3>
            <ul class="fed__edges">
              @for (e of impact().edges; track e.id) {
                <li>
                  <button class="chip-link" type="button" (click)="selectId(e.source)">
                    {{ label(e.source) }}
                  </button>
                  <code>{{ e.kind }}</code>
                  <button class="chip-link" type="button" (click)="selectId(e.target)">
                    {{ label(e.target) }}
                  </button>
                  <code class="fed__edge-ev">{{ endpointFor(e.evidence) }}</code>
                </li>
              } @empty {
                <li class="muted">{{ 'graph.fed.noImpact' | t }}</li>
              }
            </ul>
          </section>
        }

        @if (g.nodes.length) {
          <ul class="fed__nodes" data-list="nodes">
            @for (n of filtered(); track n.id) {
              <li>
                <button
                  class="fed__node"
                  type="button"
                  [attr.data-unverified]="n.unverified || null"
                  [attr.data-selected]="selected()?.id === n.id || null"
                  [attr.data-neighbor]="isNeighbor(n) || null"
                  (click)="select(n)"
                >
                  <span class="fed__kind">{{ n.kind }}</span>
                  <span class="fed__label">{{ n.label }}</span>
                  <code class="fed__id">{{ n.id }}</code>
                  @if (n.unverified) {
                    <ui-state-badge state="unverified" />
                  }
                </button>
              </li>
            } @empty {
              <li class="muted">{{ 'graph.fed.empty' | t }}</li>
            }
          </ul>
        } @else {
          <ui-empty icon="network" [title]="'graph.fed.none' | t" />
        }
      </section>
    }
  `,
  styles: `
    .views {
      list-style: none;
      padding: 0;
      margin: var(--space-4) 0 0;
      display: grid;
    }
    .views li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
    }
    .views li + li {
      border-top: 1px solid var(--border);
    }
    .views li:hover {
      background: var(--bg-hover);
    }
    .views strong {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .muted {
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
    .fed {
      margin-top: var(--space-3);
    }
    .fed__head,
    .fed__detail-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .fed h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .views strong ui-icon,
    .fed__head ui-icon,
    .fed__detail-head ui-icon {
      color: var(--accent);
    }
    .chip,
    .fed__kind,
    .chip-link {
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
      flex: none;
    }
    .chip-link {
      border: 0;
      cursor: pointer;
    }
    .fed__sources {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
      padding: 0;
      margin: var(--space-2) 0;
      font-size: var(--font-xs);
    }
    .fed__sources li {
      display: inline-flex;
      gap: var(--space-2);
    }
    .fed__nodes {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: var(--space-2);
    }
    .fed__node {
      width: 100%;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      color: var(--fg);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .fed__node:hover {
      border-color: var(--accent);
    }
    .fed__node[data-unverified] {
      border-style: dashed;
      opacity: 0.72;
    }
    .fed__node[data-selected] {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .fed__node[data-neighbor] {
      border-color: var(--info);
      box-shadow: 0 0 0 1px var(--info);
    }
    .fed__label,
    .fed__id {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .fed__label {
      font-weight: 600;
    }
    .fed__id {
      margin-left: auto;
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .fed__detail {
      margin: var(--space-4) 0;
      border-left: 3px solid var(--accent);
    }
    .kv {
      display: grid;
      gap: var(--space-2);
      margin: 0;
    }
    .kv div {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
    }
    .kv dt {
      min-width: 7rem;
      color: var(--fg-muted);
      font-size: var(--font-sm);
      flex: none;
    }
    .kv dd {
      margin: 0;
    }
    .fed__evidence,
    .fed__edges li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
    }
    .fed__impact {
      margin: var(--space-2) 0;
      font-weight: 650;
    }
    .fed__edges {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-1);
      font-size: var(--font-sm);
    }
    .fed__edge-ev {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
  `,
})
export class GraphPage {
  private readonly api = inject(PortalApi);
  private readonly store = inject(PortalStore);

  readonly bundle = signal<GraphBundle | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly loading = signal(true);

  /** Federated model — rebuilt after every load attempt. */
  readonly fed = signal<FedGraph | null>(null);
  readonly query = signal('');
  readonly kind = signal<FedNodeKind | null>(null);
  readonly selected = signal<FedNode | null>(null);

  /** One Source per adapter op — a failed endpoint degrades to its
   *  strip chip, never blanks the studio. Payloads cast in `data()`. */
  private readonly srcs: { id: StudioSource; src: Source<unknown> }[] = [
    { id: 'capabilities', src: new Source<unknown>() },
    { id: 'skills', src: new Source<unknown>() },
    { id: 'agents', src: new Source<unknown>() },
    { id: 'mcp', src: new Source<unknown>() },
    { id: 'hosts', src: new Source<unknown>() },
    { id: 'tasks', src: new Source<unknown>() },
  ];

  readonly nodeById = computed(() => {
    const map = new Map<string, FedNode>();
    for (const n of this.fed()?.nodes ?? []) map.set(n.id, n);
    return map;
  });

  /** Direct neighbors of the selected node — the simple impact view. */
  readonly impact = computed<{ nodes: Set<string>; edges: FedEdge[] }>(() => {
    const sel = this.selected();
    const g = this.fed();
    if (!sel || !g) return { nodes: new Set<string>(), edges: [] };
    return nodeNeighbors(g, sel.id);
  });

  readonly filtered = computed<FedNode[]>(() => {
    const g = this.fed();
    if (!g) return [];
    const q = norm(this.query());
    const k = this.kind();
    return g.nodes.filter((n) => {
      if (k !== null && n.kind !== k) return false;
      if (!q) return true;
      return norm(n.id).includes(q) || norm(n.label).includes(q);
    });
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    this.selected.set(null);
    const graphsCall = firstValueFrom(this.api.graphs())
      .then((b) => this.bundle.set(b))
      .catch((e) => {
        this.bundle.set(null);
        this.error.set(toApiError(e));
      });
    await Promise.allSettled([
      graphsCall,
      ...this.srcs.map((s) => s.src.load(() => this.read(s.id))),
    ]);
    this.loading.set(false);
    this.rebuild();
  }

  private read(id: StudioSource): Observable<unknown> {
    switch (id) {
      case 'capabilities':
        return this.api.capabilities();
      case 'skills':
        return this.api.skills();
      case 'agents':
        return this.api.agents();
      case 'mcp':
        return this.api.mcpServers();
      case 'hosts':
        return this.api.hosts();
      case 'tasks':
        return this.api.tasks();
    }
  }

  /** Compose the federated overlay — each endpoint's outcome becomes a
   *  loaded/unavailable/unverified flag; nothing is assumed loaded. */
  private rebuild(): void {
    const avail = (s: Source<unknown>): SourceAvailability =>
      s.data() !== null ? 'loaded' : s.unavailable() ? 'unavailable' : 'unverified';
    const graphsErr = this.error();
    const b = this.bundle();
    const graphsAvail: SourceAvailability = !b
      ? graphsErr && (graphsErr.status === 404 || graphsErr.body.code === 'PORTAL-NOT-FOUND')
        ? 'unavailable'
        : 'unverified'
      : b.availability.state === 'available' || b.availability.state === 'no_graph'
        ? 'loaded'
        : 'unverified'; // 'unverified'/'disabled' bundles stay unverified evidence
    const descriptor = this.store.descriptor();
    const availability = {} as Record<FedSource, SourceAvailability>;
    for (const s of this.srcs) availability[s.id] = avail(s.src);
    availability['graphs'] = graphsAvail;
    availability['bootstrap'] = descriptor ? 'loaded' : 'unverified';
    this.fed.set(
      buildFederatedGraph({
        capabilities: this.data<PortalCapability[]>('capabilities'),
        skills: this.data<SkillDescriptor[]>('skills'),
        agents: this.data<AgentDescriptor[]>('agents'),
        mcp: this.data<McpServerDescriptor[]>('mcp'),
        hosts: this.data<HostDetection[]>('hosts'),
        tasks: this.data<TaskExecution[]>('tasks'),
        graphViews: this.bundle()?.views ?? null,
        servingForge: descriptor?.forge_id ?? null,
        availability,
      }),
    );
  }

  private data<T>(id: StudioSource): T | null {
    return (this.srcs.find((s) => s.id === id)?.src.data() ?? null) as T | null;
  }

  // -- studio interactions ------------------------------------------

  select(n: FedNode): void {
    this.selected.set(n);
  }

  selectId(id: string): void {
    const n = this.nodeById().get(id);
    if (n) this.selected.set(n);
  }

  /** Direct neighbor of the selected node (impact highlight). */
  isNeighbor(n: FedNode): boolean {
    const sel = this.selected();
    return sel !== null && sel.id !== n.id && this.impact().nodes.has(n.id);
  }

  toggleKind(k: FedNodeKind): void {
    this.kind.set(this.kind() === k ? null : k);
  }

  kindOptions(g: FedGraph): FedNodeKind[] {
    return FED_NODE_KINDS.filter((k) => (g.counts[k] ?? 0) > 0);
  }

  label(id: string): string {
    return this.nodeById().get(id)?.label ?? id;
  }

  endpointFor(src: FedSource): string {
    return SOURCE_ENDPOINT[src];
  }

  sourceList(g: FedGraph): { id: FedSource; info: FedGraph['sources'][FedSource] }[] {
    return (Object.entries(g.sources) as [FedSource, FedGraph['sources'][FedSource]][]).map(
      ([id, info]) => ({ id, info }),
    );
  }

  sourceBadge(state: SourceAvailability): string {
    return state === 'loaded' ? 'ok' : state === 'unavailable' ? 'muted' : 'warn';
  }

  /** Serialized FedGraph — what the export button downloads. */
  exportJson(): string {
    return JSON.stringify(this.fed(), null, 2);
  }

  /** Downloads the FedGraph via a data: URI anchor — no blob store, no
   *  extra APIs, works in every host. */
  exportGraph(): void {
    if (!this.fed()) return;
    const a = document.createElement('a');
    a.href = `data:application/json;charset=utf-8,${encodeURIComponent(this.exportJson())}`;
    a.download = 'forge-federated-graph.json';
    a.click();
  }

  // -- kept per-Forja views helpers ----------------------------------

  viewName(v: Record<string, unknown>): string {
    return String(v['view'] ?? v['name'] ?? 'view');
  }
  viewNodes(v: Record<string, unknown>): number {
    const n = v['nodes'];
    return Array.isArray(n) ? n.length : Number(v['node_count'] ?? 0);
  }
  viewEdges(v: Record<string, unknown>): number {
    const e = v['edges'];
    return Array.isArray(e) ? e.length : Number(v['edge_count'] ?? 0);
  }
}
