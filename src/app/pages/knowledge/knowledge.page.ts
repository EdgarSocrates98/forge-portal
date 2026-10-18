import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  AgentDescriptor,
  DocHit,
  FederationSnapshot,
  GraphBundle,
  HostDetection,
  McpServerDescriptor,
  PortalCapability,
  PortalEventReport,
  RegistryState,
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
import {
  REC_KIND_LABEL,
  Recommendation,
  agentsForDomain,
  agentsForSkill,
  buildRecommendations,
  skillsInDomain,
} from '../../core/search/recommend.data';
import { normalizeSearchText } from '../../core/search/search.data';
import { EntityLink, entityLink } from '../../core/graph/entity-link';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { StateBadge } from '../../shared/state-badge';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, toApiError } from '../explorer/forges.data';

type KnowledgeSource =
  'federation' | 'registry' | 'skills' | 'agents' | 'mcp' | 'hosts' | 'tasks' | 'events' | 'graphs';

const KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = [
  'federation',
  'registry',
  'skills',
  'agents',
  'mcp',
  'hosts',
  'tasks',
  'events',
  'graphs',
];

const KIND_ICON: Record<FedNodeKind, string> = {
  forge: 'gem',
  capability: 'shield-check',
  skill: 'skills',
  agent: 'agents',
  mcp: 'mcp',
  host: 'hosts',
  operation: 'tasks',
  tool: 'terminal',
};

/**
 * Cycle 5 §8 — Knowledge view: one surface over the entities the
 * serving Forja really exposes.
 *
 *  - ENTITIES (§8.1): the federated overlay (`buildFederatedGraph` —
 *    the same engine the Graph Studio uses, never duplicated) filtered
 *    by the unified query box.
 *  - RELATIONS (§8.2): the inspector lists the node's edges —
 *    `declares`/`origin`/`associated`/`bound_to` — each carrying the
 *    endpoint that declared it. Docs hits for the entity name come from
 *    `GET /docs/search` — a real server-side match, never inferred.
 *  - DOCS: the kept §3.x docs search, with an honest "not exposed"
 *    state when the Forja answers 404.
 *  - RECOMMENDATIONS (§8.5): `buildRecommendations` — each item shows
 *    its reason plus the endpoint+field that grounds it. When a source
 *    could not be verified the panel says so instead of guessing.
 *
 * Read-only by construction: every link navigates, nothing mutates.
 */
@Component({
  selector: 'page-knowledge',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TPipe,
    PageHeader,
    EmptyState,
    ErrorState,
    StateBadge,
    UiIcon,
    UiSkeleton,
  ],
  template: `
    <ui-page-header [title]="'knowledge.title' | t" [subtitle]="'knowledge.subtitle' | t">
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <section class="card">
      <label class="lbl" for="q">{{ 'knowledge.search' | t }}</label>
      <div class="row">
        <div class="search-field q-field">
          <ui-icon name="search" [size]="15" />
          <input
            id="q"
            class="input"
            type="search"
            [placeholder]="'knowledge.placeholder' | t"
            [ngModel]="query()"
            (ngModelChange)="onQuery($event)"
            (keydown.enter)="searchDocs()"
          />
        </div>
        <button
          class="btn btn--primary"
          [disabled]="docBusy() || !query().trim()"
          (click)="searchDocs()"
        >
          <ui-icon name="search" [size]="14" />
          {{ 'knowledge.search' | t }}
        </button>
      </div>
    </section>

    @if (loading()) {
      <div role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="card" [lines]="2" />
      </div>
    }

    @if (fed(); as g) {
      <ul class="srcs" data-strip="sources" [attr.aria-label]="'graph.fed.sources' | t">
        @for (s of sourceRows(); track s.id) {
          <li [attr.data-source]="s.id" [attr.data-state]="s.state">
            <code>{{ s.endpoint }}</code>
            <ui-state-badge
              [state]="sourceBadge(s.state)"
              [labelOverride]="'graph.source.' + s.state | t"
            />
          </li>
        }
        <li data-source="environment" [attr.data-state]="envState()">
          <code>{{ 'GET /api/v1/bootstrap → account_environment' }}</code>
          <ui-state-badge
            [state]="sourceBadge(envState())"
            [labelOverride]="'graph.source.' + envState() | t"
          />
        </li>
      </ul>

      <section class="card" data-section="entities">
        <header class="sec-head">
          <h2><ui-icon name="knowledge" [size]="15" />{{ 'knowledge.entities' | t }}</h2>
        </header>
        @if (g.nodes.length) {
          <div class="chips" role="group" [attr.aria-label]="'command.filters' | t">
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
                [attr.data-kind-chip]="k"
                [attr.data-tone]="kind() === k ? 'accent' : null"
                [attr.aria-pressed]="kind() === k"
                (click)="toggleKind(k)"
              >
                {{ k }} · {{ g.counts[k] }}
              </button>
            }
          </div>
          <ul class="nodes" data-list="entities">
            @for (n of filtered(); track n.id) {
              <li>
                <button
                  class="node"
                  type="button"
                  [attr.data-unverified]="n.unverified || null"
                  [attr.data-selected]="selected()?.id === n.id || null"
                  (click)="select(n)"
                >
                  <ui-icon [name]="kindIcon(n.kind)" [size]="14" />
                  <span class="node__label" [attr.title]="n.label">{{ n.label }}</span>
                  <code class="node__id" [attr.title]="n.id">{{ n.id }}</code>
                  @if (n.unverified) {
                    <ui-state-badge state="unverified" />
                  }
                </button>
              </li>
            } @empty {
              <li class="muted">{{ 'knowledge.noEntities' | t }}</li>
            }
          </ul>
        } @else {
          <ui-empty icon="knowledge" [title]="'knowledge.noEntities' | t" />
        }
      </section>

      @if (selected(); as sel) {
        <section class="card detail fg-enter" data-section="inspector" aria-live="polite">
          <header class="sec-head">
            <h2>
              <ui-icon [name]="kindIcon(sel.kind)" [size]="15" />{{ sel.label }}
              @if (sel.unverified) {
                <ui-state-badge state="unverified" />
              }
            </h2>
            <span class="detail__actions">
              <!-- Contextual navigation — only kinds with a real owning
                   page get a link (entity-link.ts); capabilities don't. -->
              @if (openLink(sel); as link) {
                <a
                  class="btn btn--mini"
                  [routerLink]="link.commands"
                  [queryParams]="link.queryParams ?? null"
                  [fragment]="link.fragment"
                >
                  {{ 'entity.openIn' | t }} {{ link.navKey | t }}
                  <ui-icon name="chevron-right" [size]="13" />
                </a>
              }
              <button
                class="icon-btn"
                (click)="selected.set(null)"
                [attr.aria-label]="'state.close' | t"
              >
                <ui-icon name="chevron-right" [size]="14" />
              </button>
            </span>
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
              <dt>{{ 'skills.evidence' | t }}</dt>
              <dd class="ev">
                @for (src of sel.evidence; track src) {
                  <code>{{ endpointFor(src) }}</code>
                }
              </dd>
            </div>
          </dl>

          <h3 class="sub muted">{{ 'knowledge.related' | t }}</h3>
          <ul class="edges" data-list="relations">
            @for (e of impact().edges; track e.id) {
              <li>
                <button class="chip-link" type="button" (click)="selectId(e.source)">
                  {{ label(e.source) }}
                </button>
                <code>{{ e.kind }}</code>
                <button class="chip-link" type="button" (click)="selectId(e.target)">
                  {{ label(e.target) }}
                </button>
                <code class="edge-ev">{{ endpointFor(e.evidence) }}</code>
              </li>
            } @empty {
              <li class="muted">{{ 'knowledge.relatedEmpty' | t }}</li>
            }
          </ul>

          @if (sameDomain().length) {
            <h3 class="sub muted">{{ 'knowledge.sameDomain' | t }}</h3>
            <ul class="edges" data-list="same-domain">
              @for (s of sameDomain(); track s.id) {
                <li>
                  <button class="chip-link" type="button" (click)="selectId('skill:' + s.id)">
                    {{ s.name || s.id }}
                  </button>
                  <code class="edge-ev">{{ 'GET /api/v1/skills → domain' }}</code>
                </li>
              }
            </ul>
          }

          @if (declaringAgents().length) {
            <h3 class="sub muted">{{ 'knowledge.declaredBy' | t }}</h3>
            <ul class="edges" data-list="declared-by">
              @for (a of declaringAgents(); track a.id) {
                <li>
                  <button class="chip-link" type="button" (click)="selectId('agent:' + a.id)">
                    {{ a.name || a.id }}
                  </button>
                  <code class="edge-ev">{{ 'GET /api/v1/agents → skills[]' }}</code>
                </li>
              }
            </ul>
          }

          @if (domainAgents().length) {
            <h3 class="sub muted">{{ 'knowledge.domainAgents' | t }}</h3>
            <ul class="edges" data-list="domain-agents">
              @for (a of domainAgents(); track a.id) {
                <li>
                  <button class="chip-link" type="button" (click)="selectId('agent:' + a.id)">
                    {{ a.name || a.id }}
                  </button>
                  <code class="edge-ev">{{ 'GET /api/v1/agents → domains[]' }}</code>
                </li>
              }
            </ul>
          }

          <h3 class="sub muted">{{ 'knowledge.entityDocs' | t }}</h3>
          @if (entityDocs(); as docs) {
            <ul class="edges" data-list="entity-docs">
              @for (h of docs; track h.path) {
                <li>
                  <span class="doc-title">{{ h.title || h.path }}</span>
                  <code class="edge-ev">{{ 'GET /api/v1/docs/search' }}</code>
                </li>
              } @empty {
                <li class="muted">{{ 'knowledge.entityDocsEmpty' | t }}</li>
              }
            </ul>
          } @else {
            <p class="muted">{{ 'knowledge.entityDocsUnverified' | t }}</p>
          }
        </section>
      }
    }

    <section class="card" data-section="docs">
      <h2 class="sec-title"><ui-icon name="knowledge" [size]="15" />{{ 'knowledge.docs' | t }}</h2>
      @if (docError(); as e) {
        <ui-error [error]="e" (retry)="searchDocs()" />
      } @else if (docsUnavailable()) {
        <ui-empty icon="knowledge" [title]="'knowledge.docsUnavailable' | t" />
      } @else if (docsSearched()) {
        <p class="muted">{{ 'knowledge.results' | t: { count: hits().length } }}</p>
        @for (h of hits(); track h.path) {
          <article class="hit" data-lift>
            <h3>{{ h.title }}</h3>
            <p class="muted">{{ h.excerpt }}</p>
            <footer>
              <code>{{ h.path }}</code>
              <span class="cat">{{ h.category }}</span>
              @if (h.url) {
                <a class="btn" [href]="h.url" target="_blank" rel="noopener">
                  {{ 'knowledge.open' | t }}
                  <ui-icon name="external" [size]="13" />
                </a>
              }
            </footer>
          </article>
        } @empty {
          <ui-empty icon="knowledge" [title]="'knowledge.empty' | t" />
        }
      } @else {
        <p class="muted">{{ 'knowledge.docsHint' | t }}</p>
      }
    </section>

    <section class="card" data-section="recommend">
      <h2 class="sec-title"><ui-icon name="compass" [size]="15" />{{ 'recommend.title' | t }}</h2>
      <p class="muted">{{ 'recommend.note' | t }}</p>
      @if (recPartial()) {
        <p class="muted warn-note" data-note="partial">
          <ui-icon name="alert" [size]="13" />
          {{ 'recommend.partial' | t }}
        </p>
      }
      @if (recommendations().length) {
        <ul class="recs" data-list="recommendations">
          @for (r of recommendations(); track r.id) {
            <li class="rec" [attr.data-kind]="r.kind" [attr.data-severity]="r.severity">
              <header>
                <span class="chip">{{ recKindLabel[r.kind] | t }}</span>
                <ui-state-badge
                  [state]="r.severity === 'warning' ? 'warn' : 'info'"
                  [labelOverride]="
                    (r.severity === 'warning' ? 'recommend.sev.warning' : 'recommend.sev.info') | t
                  "
                />
              </header>
              <p class="rec__reason">{{ r.reasonKey | t: r.params }}</p>
              <ul class="rec__refs">
                @for (ref of r.refs; track ref.kind + ':' + ref.id) {
                  <li>
                    <code>{{ ref.kind }}:{{ ref.id }}</code>
                  </li>
                }
              </ul>
              <footer>
                @for (s of r.source; track s.endpoint + s.field) {
                  <code class="rec__src">{{ s.endpoint }} → {{ s.field }}</code>
                }
                <a class="btn" [routerLink]="[r.route]">{{ 'recommend.goto' | t }}</a>
              </footer>
            </li>
          }
        </ul>
      } @else {
        <ui-empty icon="compass" [title]="'recommend.empty' | t" />
      }
    </section>
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    .lbl {
      display: block;
      font-weight: 600;
      margin-bottom: var(--space-2);
    }
    .row {
      display: flex;
      gap: var(--space-2);
    }
    .q-field {
      flex: 1;
      max-width: none;
      margin-bottom: 0;
    }
    .muted {
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
    .sec-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .sec-title,
    .sec-head h2 {
      margin: 0 0 var(--space-2);
      font-size: var(--font-lg);
      font-weight: 650;
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .sec-head h2 ui-icon,
    .sec-title ui-icon {
      color: var(--accent-ink);
    }
    .srcs {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
      padding: 0;
      margin: 0 0 var(--space-3);
      font-size: var(--font-xs);
    }
    .srcs li {
      display: inline-flex;
      gap: var(--space-2);
      align-items: center;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .nodes {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: var(--space-2);
    }
    .node {
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
      background: transparent;
    }
    /* one transition vocabulary for every hoverable surface below */
    .node,
    .hit,
    .rec {
      transition:
        border-color var(--motion-fast),
        box-shadow var(--motion-fast);
    }
    .node ui-icon {
      color: var(--fg-muted);
      flex: none;
    }
    .node:hover {
      border-color: var(--accent-ink);
    }
    .node[data-unverified] {
      border-style: dashed;
      /* no opacity: alpha < 1 dims the badge text below AA — a
         translucent surface keeps the "not yet observed" cue legal */
      background: color-mix(in srgb, var(--bg-elevated) 55%, transparent);
    }
    .node[data-selected] {
      border-color: var(--accent-ink);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .node__label,
    .node__id {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .node__label,
    .doc-title {
      font-weight: 600;
    }
    .node__id {
      margin-left: auto;
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .detail {
      border-left: 3px solid var(--accent);
    }
    .detail__actions {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .kv {
      display: grid;
      gap: var(--space-2);
      margin: var(--space-2) 0;
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
    .ev,
    .edges li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
    }
    .sub {
      margin: var(--space-3) 0 var(--space-1);
      font-weight: 650;
    }
    .edges {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-1);
      font-size: var(--font-sm);
    }
    .edge-ev,
    .rec__src {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    /* .chip/.chip-link consolidated into styles.css shared blocks */
    .hit {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      margin-bottom: var(--space-2);
    }
    .hit:hover,
    .rec:hover {
      border-color: var(--border-strong);
    }
    .hit:hover {
      box-shadow: var(--elev-hover);
    }
    .hit h3 {
      margin: 0 0 6px;
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .hit footer {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-top: var(--space-3);
      font-size: var(--font-xs);
    }
    .hit code {
      color: var(--fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hit .btn,
    .rec footer .btn {
      margin-left: auto;
    }
    .cat {
      color: var(--accent-ink);
      font-weight: 600;
      flex-shrink: 0;
      background: var(--accent-bg);
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
      border-radius: var(--radius-pill);
      padding: 1px var(--space-2);
    }
    .warn-note {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      color: var(--warn, var(--fg-muted));
    }
    .recs {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .rec {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
    }
    .rec[data-severity='warning'] {
      border-left: 3px solid var(--warn, var(--accent));
    }
    .rec[data-severity='info'] {
      border-left: 3px solid var(--info, var(--accent));
    }
    .rec header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .rec__reason {
      margin: var(--space-2) 0;
      font-size: var(--font-sm);
    }
    .rec__refs {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-2);
      padding: 0;
      margin: 0 0 var(--space-2);
      font-size: var(--font-xs);
    }
    .rec footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-1) var(--space-2);
    }
  `,
})
export class KnowledgePage {
  private readonly api = inject(PortalApi);
  private readonly store = inject(PortalStore);

  readonly query = signal('');
  readonly kind = signal<FedNodeKind | null>(null);
  readonly selected = signal<FedNode | null>(null);
  readonly fed = signal<FedGraph | null>(null);
  readonly loading = signal(true);

  readonly hits = signal<DocHit[]>([]);
  readonly docsSearched = signal(false);
  readonly docsUnavailable = signal(false);
  readonly docError = signal<ApiError | null>(null);
  readonly docBusy = signal(false);

  /** Docs hits for the selected entity's own name — null until its
   *  docs query really answered (unverified, not empty). */
  readonly entityDocs = signal<DocHit[] | null>(null);
  private entityDocsFor = '';

  private readonly srcs: { id: KnowledgeSource; src: Source<unknown> }[] = KNOWLEDGE_SOURCES.map(
    (id) => ({ id, src: new Source<unknown>() }),
  );

  constructor() {
    void this.load();
  }

  // -- loading --------------------------------------------------------------

  async load(): Promise<void> {
    this.loading.set(true);
    this.selected.set(null);
    this.entityDocs.set(null);
    this.entityDocsFor = '';
    await Promise.allSettled(this.srcs.map((s) => s.src.load(() => this.read(s.id))));
    this.loading.set(false);
    this.rebuild();
  }

  private read(id: KnowledgeSource): Observable<unknown> {
    switch (id) {
      case 'federation':
        return this.api.federation();
      case 'registry':
        return this.api.registryState();
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
      case 'events':
        return this.api.events();
      case 'graphs':
        return this.api.graphs();
    }
  }

  private data<T>(id: KnowledgeSource): T | null {
    return (this.srcs.find((s) => s.id === id)?.src.data() ?? null) as T | null;
  }

  private srcState(id: KnowledgeSource): SourceAvailability {
    const s = this.srcs.find((x) => x.id === id)!.src;
    if (s.data() !== null) return 'loaded';
    return s.unavailable() ? 'unavailable' : 'unverified';
  }

  /** Registry only counts when the projection was really present —
   *  `present: false` means absent-OR-malformed, so it stays unchecked. */
  private registry(): RegistryState | null {
    const r = this.data<RegistryState>('registry');
    return r?.present === true ? r : null;
  }

  private rebuild(): void {
    const descriptor = this.store.descriptor();
    const availability = {} as Record<FedSource, SourceAvailability>;
    const b = this.data<GraphBundle>('graphs');
    availability['graphs'] =
      this.srcState('graphs') !== 'loaded'
        ? this.srcState('graphs')
        : b && (b.availability.state === 'available' || b.availability.state === 'no_graph')
          ? 'loaded'
          : 'unverified';
    availability['bootstrap'] = descriptor ? 'loaded' : 'unverified';
    // descriptor-carried catalog — same availability as bootstrap itself
    availability['capabilities'] = availability['bootstrap'];
    availability['skills'] = this.srcState('skills');
    availability['agents'] = this.srcState('agents');
    availability['mcp'] = this.srcState('mcp');
    availability['hosts'] = this.srcState('hosts');
    availability['tasks'] = this.srcState('tasks');
    availability['events'] = this.srcState('events');
    this.fed.set(
      buildFederatedGraph({
        capabilities: this.store.capabilities() as PortalCapability[],
        skills: this.data<SkillDescriptor[]>('skills'),
        agents: this.data<AgentDescriptor[]>('agents'),
        mcp: this.data<McpServerDescriptor[]>('mcp'),
        hosts: this.data<HostDetection[]>('hosts'),
        tasks: this.data<TaskExecution[]>('tasks'),
        events: this.data<PortalEventReport>('events')?.events ?? null,
        graphViews: b?.views ?? null,
        servingForge: descriptor?.forge_id ?? null,
        availability,
      }),
    );
  }

  // -- entities -------------------------------------------------------------

  readonly nodeById = computed(() => {
    const map = new Map<string, FedNode>();
    for (const n of this.fed()?.nodes ?? []) map.set(n.id, n);
    return map;
  });

  readonly filtered = computed<FedNode[]>(() => {
    const g = this.fed();
    if (!g) return [];
    const q = normalizeSearchText(this.query());
    const k = this.kind();
    return g.nodes.filter((n) => {
      if (k !== null && n.kind !== k) return false;
      if (!q) return true;
      return normalizeSearchText(n.id).includes(q) || normalizeSearchText(n.label).includes(q);
    });
  });

  readonly impact = computed<{ nodes: Set<string>; edges: FedEdge[] }>(() => {
    const sel = this.selected();
    const g = this.fed();
    if (!sel || !g) return { nodes: new Set<string>(), edges: [] };
    return nodeNeighbors(g, sel.id);
  });

  /** Skills in the same declared domain — only when the selected node
   *  is a skill whose descriptor really carries `domain`. */
  readonly sameDomain = computed<SkillDescriptor[]>(() => {
    const sel = this.selected();
    const skills = this.data<SkillDescriptor[]>('skills');
    if (!sel || sel.kind !== 'skill' || !skills) return [];
    const id = sel.id.slice('skill:'.length);
    const me = skills.find((s) => s.id === id || s.name === sel.label);
    return me?.domain ? skillsInDomain(skills, me.domain, me.id) : [];
  });

  /** §8.5 "potentially suitable agents" — only those whose descriptor
   *  declares this skill in `skills[]`. Evidence, not suitability score. */
  readonly declaringAgents = computed<AgentDescriptor[]>(() => {
    const sel = this.selected();
    const agents = this.data<AgentDescriptor[]>('agents');
    if (!sel || sel.kind !== 'skill' || !agents) return [];
    const id = sel.id.slice('skill:'.length);
    const skills = this.data<SkillDescriptor[]>('skills');
    const me = skills?.find((s) => s.id === id);
    return agentsForSkill(agents, me ? [me.id, me.name].filter(Boolean) : [id, sel.label]);
  });

  /** Agents declaring the selected skill's domain — "same domain", a
   *  weaker declared relation shown separately. */
  readonly domainAgents = computed<AgentDescriptor[]>(() => {
    const sel = this.selected();
    const agents = this.data<AgentDescriptor[]>('agents');
    const skills = this.data<SkillDescriptor[]>('skills');
    if (!sel || sel.kind !== 'skill' || !agents || !skills) return [];
    const id = sel.id.slice('skill:'.length);
    const me = skills.find((s) => s.id === id);
    if (!me?.domain) return [];
    const declared = new Set(this.declaringAgents().map((a) => a.id));
    return agentsForDomain(agents, me.domain).filter((a) => !declared.has(a.id));
  });

  select(n: FedNode): void {
    this.selected.set(n);
    void this.loadEntityDocs(n);
  }

  selectId(id: string): void {
    const n = this.nodeById().get(id);
    if (n) this.select(n);
  }

  toggleKind(k: FedNodeKind): void {
    this.kind.set(this.kind() === k ? null : k);
  }

  kindOptions(g: FedGraph): FedNodeKind[] {
    return FED_NODE_KINDS.filter((k) => (g.counts[k] ?? 0) > 0);
  }

  kindIcon(k: FedNodeKind): string {
    return KIND_ICON[k];
  }

  label(id: string): string {
    return this.nodeById().get(id)?.label ?? id;
  }

  /** Deep link into the page that owns this entity — null for kinds
   *  with no dedicated surface (capability), never a pretend link. */
  openLink(n: FedNode): EntityLink | null {
    return entityLink(n);
  }

  endpointFor(src: FedSource): string {
    return SOURCE_ENDPOINT[src];
  }

  sourceBadge(state: SourceAvailability): string {
    return state === 'loaded' ? 'ok' : state === 'unavailable' ? 'muted' : 'warn';
  }

  sourceRows(): { id: KnowledgeSource; endpoint: string; state: SourceAvailability }[] {
    const endpoint: Record<KnowledgeSource, string> = {
      federation: 'GET /api/v1/federation',
      registry: 'GET /api/v1/registry/state',
      skills: 'GET /api/v1/skills',
      agents: 'GET /api/v1/agents',
      mcp: 'GET /api/v1/mcp/servers',
      hosts: 'GET /api/v1/hosts',
      tasks: 'GET /api/v1/tasks',
      events: 'GET /api/v1/events',
      graphs: 'GET /api/v1/graphs',
    };
    return KNOWLEDGE_SOURCES.map((id) => ({
      id,
      endpoint: endpoint[id],
      state: this.srcState(id),
    }));
  }

  envState(): SourceAvailability {
    const env = this.store.accountEnvironment();
    if (env) return 'loaded';
    return this.store.descriptor() ? 'unverified' : 'unavailable';
  }

  // -- docs -----------------------------------------------------------------

  onQuery(q: string): void {
    this.query.set(q);
  }

  async searchDocs(): Promise<void> {
    const q = this.query().trim();
    if (!q) return;
    this.docBusy.set(true);
    this.docError.set(null);
    this.docsUnavailable.set(false);
    try {
      this.hits.set(await firstValueFrom(this.api.docsSearch(q)));
      this.docsSearched.set(true);
    } catch (e) {
      const err = toApiError(e);
      // 404 = this Forja does not expose docs → honest "not exposed",
      // any other failure → retryable error panel.
      if (err.status === 404 || err.body.code === 'PORTAL-NOT-FOUND')
        this.docsUnavailable.set(true);
      else this.docError.set(err);
    } finally {
      this.docBusy.set(false);
    }
  }

  /** Docs hits for the selected entity — its own label queried against
   *  the real docs endpoint. One query per selection; a failure keeps
   *  `entityDocs` null (unverified — never rendered as "no docs"). */
  private async loadEntityDocs(n: FedNode): Promise<void> {
    this.entityDocs.set(null);
    this.entityDocsFor = n.id;
    try {
      const hits = await firstValueFrom(this.api.docsSearch(n.label, 5));
      if (this.entityDocsFor === n.id) this.entityDocs.set(hits);
    } catch {
      if (this.entityDocsFor === n.id) this.entityDocs.set(null); // stays unverified
    }
  }

  // -- recommendations (§8.5) ------------------------------------------------

  readonly recommendations = computed<Recommendation[]>(() => {
    if (!this.fed()) return [];
    return buildRecommendations({
      federation: this.data<FederationSnapshot>('federation'),
      registry: this.registry(),
      environment: this.store.accountEnvironment(),
      skills: this.data<SkillDescriptor[]>('skills'),
      agents: this.data<AgentDescriptor[]>('agents'),
      mcp: this.data<McpServerDescriptor[]>('mcp'),
      hosts: this.data<HostDetection[]>('hosts'),
      tasks: this.data<TaskExecution[]>('tasks'),
    });
  });

  /** True when any recommendation source stayed unverified/unavailable —
   *  the panel flags itself partial instead of looking complete. */
  readonly recPartial = computed(() => {
    if (!this.fed()) return false;
    const ids: KnowledgeSource[] = ['federation', 'skills', 'mcp', 'hosts', 'tasks', 'registry'];
    return ids.some((id) => this.srcState(id) !== 'loaded');
  });

  readonly recKindLabel = REC_KIND_LABEL;
}
