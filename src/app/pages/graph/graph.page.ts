import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  AgentDescriptor,
  GraphBundle,
  HostDetection,
  McpServerDescriptor,
  PortalCapability,
  PortalEventReport,
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
} from '../../core/graph/federated';
import { GraphPath, ImpactReport, impactReport, shortestPath } from '../../core/graph/analysis';
import {
  GRAPH_LAYOUTS,
  GraphLayoutName,
  GraphRenderer,
  GraphSelection,
  GraphViewport,
} from '../../core/graph/renderer';
import {
  GraphGroupBy,
  KIND_STYLE,
  groupingFor,
  isFailed,
  toViewModel,
} from '../../core/graph/view-model';
import {
  GraphViewState,
  clearViewState,
  loadViewState,
  saveViewState,
} from '../../core/graph/saved-view';
import {
  GraphDiff,
  GraphSnapshot,
  captureSnapshot,
  diffMarks,
  diffSnapshots,
  loadSnapshot,
  saveSnapshot,
  clearSnapshot,
} from '../../core/graph/snapshot';
import { EntityLink, entityLink } from '../../core/graph/entity-link';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { UiFilterBar } from '../../shared/filter-bar';
import { Source, stamp, toApiError } from '../explorer/forges.data';

type StudioSource = Exclude<FedSource, 'graphs' | 'bootstrap'>;

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** Cap for the path-finder <select>: beyond it the option list itself
 *  would dominate the DOM — the honest cap is documented. */
const PATH_TARGET_CAP = 400;
const IMPACT_LIST_CAP = 24;

const storage = (): Storage | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

/**
 * §5.6 + Graph Studio 2.1 — Federated Graph Studio.
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
 * Studio 2.1 surface on top of it:
 * - rich nodes (kind icon + state/category/origin/version when the
 *   descriptor carried them, degree, failure indicator), zoom-tiered
 *   labels (far/mid/near), evidence-state line styles on edges;
 * - advanced inspectors: in/out relations, clickable neighbors, meta
 *   fields, evidence endpoints with observed timestamps, edge detail
 *   with direction + related relations + entity links;
 * - multi-hop analysis (`analysis.ts`, pure model functions): impact
 *   report at a chosen depth, shortest path, cycles, orphans,
 *   component, unverified relations and missing-source coverage —
 *   all labelled topological, never operational claims;
 * - five layouts, compound grouping by kind/forge/host with
 *   collapse, diff marks vs a user-captured snapshot, saved views in
 *   localStorage (`forge-portal/graph-view/v1`), reduced-motion gating.
 */
@Component({
  selector: 'page-graph',
  standalone: true,
  imports: [
    RouterLink,
    TPipe,
    PageHeader,
    StateBadge,
    EmptyState,
    ErrorState,
    UiIcon,
    UiSkeleton,
    UiFilterBar,
  ],
  template: `
    <ui-page-header [title]="'graph.title' | t" [subtitle]="'graph.subtitle' | t" hintId="graph">
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
          <div class="fed__head-side">
            <div
              class="fed__view-toggle"
              role="group"
              [attr.aria-label]="'graph.view.toggle' | t"
              data-toggle="view"
            >
              <button
                class="fg-pill"
                type="button"
                data-view="list"
                [attr.data-tone]="mode() === 'list' ? 'accent' : null"
                [attr.aria-pressed]="mode() === 'list'"
                (click)="setMode('list')"
              >
                {{ 'graph.view.list' | t }}
              </button>
              <button
                class="fg-pill"
                type="button"
                data-view="canvas"
                [attr.data-tone]="mode() === 'canvas' ? 'accent' : null"
                [attr.aria-pressed]="mode() === 'canvas'"
                (click)="setMode('canvas')"
              >
                {{ 'graph.view.canvas' | t }}
              </button>
            </div>
            <button
              class="btn"
              data-action="snapshot"
              (click)="takeSnapshot()"
              [disabled]="!g.nodes.length"
            >
              <ui-icon name="copy" [size]="14" />
              {{ 'graph.snap.capture' | t }}
            </button>
            <button
              class="btn"
              data-action="export"
              (click)="exportGraph()"
              [disabled]="!g.nodes.length"
            >
              <ui-icon name="external" [size]="14" />
              {{ 'graph.fed.export' | t }}
            </button>
          </div>
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

        @if (snap(); as sp) {
          <div class="fed__snap muted" data-section="snapshot-bar">
            <span>{{ 'graph.snap.at' | t: { at: stampAt(sp.capturedAt) } }}</span>
            <button
              class="fg-pill"
              type="button"
              data-action="compare"
              [attr.data-tone]="diff() ? 'accent' : null"
              [attr.aria-pressed]="diff() !== null"
              (click)="toggleDiff(g)"
            >
              <ui-icon name="diff" [size]="13" />
              {{ 'graph.snap.compare' | t }}
            </button>
            <button class="fg-pill" type="button" data-action="snap-clear" (click)="dropSnapshot()">
              {{ 'graph.snap.clear' | t }}
            </button>
          </div>
        }

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

        @if (diff(); as d) {
          <section class="card fed__diff fg-enter" data-section="diff" aria-live="polite">
            <h2><ui-icon name="diff" [size]="15" />{{ 'graph.diff.title' | t }}</h2>
            <p class="muted">{{ 'graph.snap.at' | t: { at: stampAt(d.snapshot) } }}</p>
            @if (d.unchanged) {
              <p class="muted">{{ 'graph.diff.unchanged' | t }}</p>
            } @else {
              <div class="fed__diff-cols">
                <div>
                  <h3 class="fed__impact">{{ 'graph.diff.added' | t }}</h3>
                  <ul class="fed__edges" data-diff="added">
                    @for (n of d.addedNodes; track n.id) {
                      <li>
                        <button class="chip-link" type="button" (click)="selectFocus(n.id)">
                          {{ n.label }}
                        </button>
                        <code class="fed__edge-ev">{{ n.id }}</code>
                      </li>
                    }
                    @for (e of d.addedEdges; track e.id) {
                      <li>
                        <code class="fed__edge-ev">{{ e.kind }}</code>
                        <code class="fed__edge-ev">{{ e.id }}</code>
                      </li>
                    }
                    @if (!d.addedNodes.length && !d.addedEdges.length) {
                      <li class="muted">{{ 'state.none' | t }}</li>
                    }
                  </ul>
                </div>
                <div>
                  <h3 class="fed__impact">{{ 'graph.diff.removed' | t }}</h3>
                  <ul class="fed__edges" data-diff="removed">
                    @for (n of d.removedNodes; track n.id) {
                      <li>
                        <code>{{ n.id }}</code>
                      </li>
                    }
                    @for (e of d.removedEdges; track e.id) {
                      <li>
                        <code class="fed__edge-ev">{{ e.id }}</code>
                      </li>
                    }
                    @if (!d.removedNodes.length && !d.removedEdges.length) {
                      <li class="muted">{{ 'state.none' | t }}</li>
                    }
                  </ul>
                </div>
                <div>
                  <h3 class="fed__impact">{{ 'graph.diff.changed' | t }}</h3>
                  <ul class="fed__edges" data-diff="changed">
                    @for (c of d.changedNodes; track c.id) {
                      <li>
                        <button class="chip-link" type="button" (click)="selectFocus(c.id)">
                          {{ c.id }}
                        </button>
                      </li>
                    }
                    @for (c of d.changedEdges; track c.id) {
                      <li>
                        <code class="fed__edge-ev">{{ c.id }}</code>
                      </li>
                    }
                    @if (!d.changedNodes.length && !d.changedEdges.length) {
                      <li class="muted">{{ 'state.none' | t }}</li>
                    }
                  </ul>
                </div>
              </div>
            }
          </section>
        }

        @if (selected(); as sel) {
          <section class="card fed__detail fg-enter" data-section="inspector" aria-live="polite">
            <header class="fed__detail-head">
              <h2>
                <ui-icon name="graph" [size]="15" />{{ sel.label }}
                @if (sel.unverified) {
                  <ui-state-badge state="unverified" />
                }
                @if (isFailed(sel)) {
                  <ui-state-badge state="FAILED" [labelOverride]="'graph.fed.failed' | t" />
                }
              </h2>
              <span class="fed__detail-actions">
                <!-- Contextual navigation — only when the entity kind has a
                     real owning page (entity-link.ts); capability nodes
                     show no link rather than a pretend one. -->
                @if (openLink(sel); as link) {
                  <a
                    class="btn btn--mini fed__open"
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
              @if (sel.state) {
                <div>
                  <dt>{{ 'graph.fed.state' | t }}</dt>
                  <dd>
                    <code>{{ sel.state }}</code>
                  </dd>
                </div>
              }
              @if (sel.category) {
                <div>
                  <dt>{{ 'graph.fed.category' | t }}</dt>
                  <dd>
                    <code>{{ sel.category }}</code>
                  </dd>
                </div>
              }
              @if (sel.origin) {
                <div>
                  <dt>{{ 'graph.fed.origin' | t }}</dt>
                  <dd>
                    <button
                      class="chip-link"
                      type="button"
                      (click)="selectFocus('forge:' + sel.origin)"
                    >
                      {{ sel.origin }}
                    </button>
                  </dd>
                </div>
              }
              @if (sel.version) {
                <div>
                  <dt>{{ 'graph.fed.version' | t }}</dt>
                  <dd>
                    <code>{{ sel.version }}</code>
                  </dd>
                </div>
              }
              <div>
                <dt>{{ 'graph.fed.degree' | t }}</dt>
                <dd>
                  <code>{{ degreeOf(sel.id) }}</code>
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
              @for (m of metaRows(sel); track m[0]) {
                <div>
                  <dt>{{ m[0] }}</dt>
                  <dd>
                    <code>{{ m[1] ?? '—' }}</code>
                  </dd>
                </div>
              }
            </dl>

            <div class="fed__rel-cols">
              <div>
                <h3 class="fed__impact">{{ 'graph.fed.relOut' | t }}</h3>
                <ul class="fed__edges" data-rel="out">
                  @for (e of relsOut(sel.id); track e.id) {
                    <li>
                      <code>{{ e.kind }}</code
                      ><span aria-hidden="true">→</span>
                      <button class="chip-link" type="button" (click)="selectFocus(e.target)">
                        {{ label(e.target) }}
                      </button>
                      <code class="fed__edge-ev">{{ endpointFor(e.evidence) }}</code>
                    </li>
                  } @empty {
                    <li class="muted">{{ 'graph.fed.noRelations' | t }}</li>
                  }
                </ul>
              </div>
              <div>
                <h3 class="fed__impact">{{ 'graph.fed.relIn' | t }}</h3>
                <ul class="fed__edges" data-rel="in">
                  @for (e of relsIn(sel.id); track e.id) {
                    <li>
                      <button class="chip-link" type="button" (click)="selectFocus(e.source)">
                        {{ label(e.source) }}
                      </button>
                      <span aria-hidden="true">→</span><code>{{ e.kind }}</code>
                      <code class="fed__edge-ev">{{ endpointFor(e.evidence) }}</code>
                    </li>
                  } @empty {
                    <li class="muted">{{ 'graph.fed.noRelations' | t }}</li>
                  }
                </ul>
              </div>
            </div>

            @if (report(); as rep) {
              <section class="fed__impactsec" data-section="impact">
                <h3 class="fed__impact">
                  {{ 'graph.impact.title' | t }}
                  <span
                    class="fed__depth"
                    role="group"
                    [attr.aria-label]="'graph.impact.depth' | t"
                  >
                    @for (d of [1, 2, 3]; track d) {
                      <button
                        class="fg-pill fg-pill--mini"
                        type="button"
                        [attr.data-depth]="d"
                        [attr.data-tone]="impactDepth() === d ? 'accent' : null"
                        [attr.aria-pressed]="impactDepth() === d"
                        (click)="impactDepth.set(d)"
                      >
                        {{ d }}
                      </button>
                    }
                  </span>
                </h3>
                <div class="fed__rel-cols">
                  <div>
                    <h4 class="muted fed__impactsub">{{ 'graph.impact.usedBy' | t }}</h4>
                    <ul class="fed__edges" data-impact="usedBy">
                      @for (h of rep.usedBy.slice(0, impactCap); track h.id) {
                        <li>
                          <button class="chip-link" type="button" (click)="selectFocus(h.id)">
                            {{ label(h.id) }}
                          </button>
                          <code class="fed__edge-ev">{{ h.dist }}h</code>
                        </li>
                      } @empty {
                        <li class="muted">{{ 'graph.fed.noRelations' | t }}</li>
                      }
                      @if (rep.usedBy.length > impactCap) {
                        <li class="muted">
                          {{ 'graph.impact.more' | t: { count: rep.usedBy.length - impactCap } }}
                        </li>
                      }
                    </ul>
                  </div>
                  <div>
                    <h4 class="muted fed__impactsub">{{ 'graph.impact.uses' | t }}</h4>
                    <ul class="fed__edges" data-impact="uses">
                      @for (h of rep.uses.slice(0, impactCap); track h.id) {
                        <li>
                          <button class="chip-link" type="button" (click)="selectFocus(h.id)">
                            {{ label(h.id) }}
                          </button>
                          <code class="fed__edge-ev">{{ h.dist }}h</code>
                        </li>
                      } @empty {
                        <li class="muted">{{ 'graph.fed.noRelations' | t }}</li>
                      }
                      @if (rep.uses.length > impactCap) {
                        <li class="muted">
                          {{ 'graph.impact.more' | t: { count: rep.uses.length - impactCap } }}
                        </li>
                      }
                    </ul>
                  </div>
                </div>

                <p class="fed__facts muted">
                  <span>{{ 'graph.impact.component' | t }}: {{ rep.componentSize }}</span>
                  @if (rep.orphan) {
                    <ui-state-badge state="muted" [labelOverride]="'graph.impact.orphan' | t" />
                  }
                  @for (c of rep.cycles; track c[0]) {
                    <span class="fed__cycle" [attr.title]="c.join(' → ')">
                      {{ 'graph.impact.cycle' | t }}: {{ c.length }}
                    </span>
                  }
                </p>

                <div class="fed__path" data-section="path">
                  <label class="muted" for="path-target">{{ 'graph.impact.path' | t }}</label>
                  <select
                    id="path-target"
                    class="input fed__pathsel"
                    (change)="onPathTarget($event)"
                    [value]="pathTarget() ?? ''"
                  >
                    <option value="">—</option>
                    @for (n of pathOptions(sel.id); track n.id) {
                      <option [value]="n.id">{{ n.id }}</option>
                    }
                  </select>
                  <span class="fed__depth" role="group" [attr.aria-label]="'graph.impact.path' | t">
                    <button
                      class="fg-pill fg-pill--mini"
                      type="button"
                      data-dir="out"
                      [attr.data-tone]="pathDir() === 'out' ? 'accent' : null"
                      (click)="pathDir.set('out')"
                    >
                      {{ 'graph.impact.dirOut' | t }}
                    </button>
                    <button
                      class="fg-pill fg-pill--mini"
                      type="button"
                      data-dir="both"
                      [attr.data-tone]="pathDir() === 'both' ? 'accent' : null"
                      (click)="pathDir.set('both')"
                    >
                      {{ 'graph.impact.dirBoth' | t }}
                    </button>
                  </span>
                  @if (pathResult(); as p) {
                    @if (p.nodes) {
                      <ol class="fed__pathlist" data-path="found">
                        @for (nid of p.nodes; track nid) {
                          <li>
                            <button class="chip-link" type="button" (click)="selectFocus(nid)">
                              {{ label(nid) }}
                            </button>
                          </li>
                        }
                      </ol>
                    } @else {
                      <span class="muted" data-path="none">{{ 'graph.impact.noPath' | t }}</span>
                    }
                  }
                </div>

                <p class="fed__honest muted">
                  <span>
                    {{ 'graph.impact.unverified' | t }}: {{ rep.unverifiedEdges.length }}
                  </span>
                  <span>
                    {{
                      'graph.impact.coverage'
                        | t: { loaded: rep.coverage.loaded, total: rep.coverage.total }
                    }}
                  </span>
                  @for (ms of rep.missingSources; track ms) {
                    <code class="fed__edge-ev">{{ endpointFor(ms) }}</code>
                  }
                </p>
                <p class="muted fed__toponote">{{ 'graph.impact.topoNote' | t }}</p>
              </section>
            }
          </section>
        }

        @if (selectedEdge(); as se) {
          <section
            class="card fed__detail fg-enter"
            data-section="edge-inspector"
            aria-live="polite"
          >
            <header class="fed__detail-head">
              <h2><ui-icon name="network" [size]="15" />{{ 'graph.edge.title' | t }}</h2>
              <button
                class="icon-btn"
                (click)="selectedEdge.set(null)"
                [attr.aria-label]="'state.close' | t"
              >
                <ui-icon name="chevron-right" [size]="14" />
              </button>
            </header>
            <dl class="kv">
              <div>
                <dt>{{ 'graph.edge.relation' | t }}</dt>
                <dd>
                  <code>{{ se.kind }}</code>
                </dd>
              </div>
              <div>
                <dt>{{ 'graph.edge.direction' | t }}</dt>
                <dd>
                  <button class="chip-link" type="button" (click)="selectFocus(se.source)">
                    {{ label(se.source) }}
                  </button>
                  <span aria-hidden="true">→</span>
                  <button class="chip-link" type="button" (click)="selectFocus(se.target)">
                    {{ label(se.target) }}
                  </button>
                </dd>
              </div>
              <div>
                <dt>{{ 'graph.edge.source' | t }}</dt>
                <dd>
                  <code class="fed__edge-ev">{{ se.source }}</code>
                </dd>
              </div>
              <div>
                <dt>{{ 'graph.edge.target' | t }}</dt>
                <dd>
                  <code class="fed__edge-ev">{{ se.target }}</code>
                </dd>
              </div>
              <div>
                <dt>{{ 'skills.evidence' | t }}</dt>
                <dd class="fed__evidence">
                  <code>{{ endpointFor(se.evidence) }}</code>
                  <ui-state-badge
                    [state]="sourceBadge(evidenceState(se.evidence))"
                    [labelOverride]="'graph.source.' + evidenceState(se.evidence) | t"
                  />
                </dd>
              </div>
              @if (evidenceLoadedAt(se.evidence); as at) {
                <div>
                  <dt>{{ 'graph.edge.observedAt' | t }}</dt>
                  <dd>
                    <code>{{ at }}</code>
                  </dd>
                </div>
              }
            </dl>
            <h3 class="fed__impact muted">{{ 'graph.edge.related' | t }}</h3>
            <ul class="fed__edges">
              @for (r of relatedEdges(se); track r.id) {
                <li>
                  <button class="chip-link" type="button" (click)="selectEdge(r.id)">
                    {{ r.kind }}
                  </button>
                  <code class="fed__edge-ev">{{ r.id }}</code>
                </li>
              } @empty {
                <li class="muted">{{ 'graph.edge.relatedNone' | t }}</li>
              }
            </ul>
          </section>
        }

        @if (g.nodes.length && mode() === 'canvas') {
          <div class="fed__canvas-wrap" data-section="canvas">
            <div class="fed__toolbar" role="toolbar" [attr.aria-label]="'graph.canvas.tools' | t">
              <span class="muted">{{ 'graph.canvas.layout' | t }}</span>
              @for (l of layouts; track l) {
                <button
                  class="fg-pill"
                  type="button"
                  [attr.data-layout]="l"
                  [attr.data-tone]="layoutName() === l ? 'accent' : null"
                  [attr.aria-pressed]="layoutName() === l"
                  (click)="setLayout(l)"
                >
                  {{ l }}
                </button>
              }
              <span class="fed__toolbar-gap"></span>
              <label class="muted" for="group-by">{{ 'graph.canvas.group' | t }}</label>
              <select
                id="group-by"
                class="input fed__groupsel"
                data-action="group"
                (change)="onGroupBy($event)"
                [value]="groupBy() ?? ''"
              >
                <option value="">{{ 'graph.group.none' | t }}</option>
                <option value="kind">{{ 'graph.group.kind' | t }}</option>
                <option value="forge">{{ 'graph.group.forge' | t }}</option>
                <option value="host">{{ 'graph.group.host' | t }}</option>
              </select>
              <button class="fg-pill" type="button" data-action="reset" (click)="resetLayout()">
                {{ 'graph.canvas.reset' | t }}
              </button>
              <button class="fg-pill" type="button" data-action="fit" (click)="fitCanvas()">
                {{ 'graph.canvas.fit' | t }}
              </button>
              <button
                class="fg-pill"
                type="button"
                data-action="zoom"
                [disabled]="!selected() && !selectedEdge()"
                (click)="zoomToSelected()"
              >
                {{ 'graph.canvas.zoomSel' | t }}
              </button>
              <button class="fg-pill" type="button" data-action="png" (click)="exportPng()">
                PNG
              </button>
              <button class="fg-pill" type="button" data-action="svg" (click)="exportSvg()">
                SVG
              </button>
              <button class="fg-pill" type="button" data-action="reset-view" (click)="resetView()">
                {{ 'graph.view.reset' | t }}
              </button>
            </div>
            @if (groupSpec(); as gs) {
              @if (gs.groups.length) {
                <ul
                  class="fed__groups"
                  data-strip="groups"
                  [attr.aria-label]="'graph.canvas.group' | t"
                >
                  @for (gr of gs.groups; track gr.id) {
                    <li>
                      <button
                        class="fg-pill fg-pill--mini"
                        type="button"
                        [attr.data-group]="gr.id"
                        [attr.data-tone]="collapsed().has(gr.id) ? 'accent' : null"
                        [attr.aria-pressed]="collapsed().has(gr.id)"
                        (click)="toggleGroup(gr.id)"
                      >
                        {{ gr.label }} · {{ gr.members.length }}
                      </button>
                    </li>
                  }
                </ul>
              }
            }
            <div
              #canvasEl
              class="fed__canvas"
              data-canvas="graph"
              role="application"
              [attr.aria-label]="'graph.canvas.aria' | t"
            ></div>
            <p class="muted fed__hover" data-status="hover">{{ hoverLine() }}</p>
            <ul class="fed__legend" [attr.aria-label]="'graph.canvas.legend' | t">
              @for (k of kindOptions(g); track k) {
                <li [attr.data-kind]="k">
                  <span
                    class="fed__legend-dot"
                    [style.background]="kindColor(k)"
                    [attr.data-shape]="kindShape(k)"
                  ></span>
                  {{ k }}
                </li>
              }
              <li class="fed__legend-line" data-line="solid">
                <span class="fed__legend-rule"></span>{{ 'graph.legend.declared' | t }}
              </li>
              <li class="fed__legend-line" data-line="dashed">
                <span class="fed__legend-rule fed__legend-rule--dashed"></span
                >{{ 'graph.legend.unverified' | t }}
              </li>
              <li class="fed__legend-line" data-line="dotted">
                <span class="fed__legend-rule fed__legend-rule--dotted"></span
                >{{ 'graph.legend.unavailable' | t }}
              </li>
            </ul>
          </div>
        }

        @if (g.nodes.length && mode() === 'list') {
          <ul class="fed__nodes" data-list="nodes">
            @for (n of filtered(); track n.id) {
              <li>
                <button
                  class="fed__node"
                  type="button"
                  [attr.data-unverified]="n.unverified || null"
                  [attr.data-failed]="isFailed(n) || null"
                  [attr.data-selected]="selected()?.id === n.id || null"
                  [attr.data-neighbor]="isNeighbor(n) || null"
                  (click)="select(n)"
                >
                  <span class="chip">{{ n.kind }}</span>
                  <span class="fed__label" [attr.title]="n.label">{{ n.label }}</span>
                  @if (n.state) {
                    <span class="fed__state" [attr.title]="n.state">{{ n.state }}</span>
                  }
                  <code class="fed__id" [attr.title]="n.id">{{ n.id }}</code>
                  @if (n.unverified) {
                    <ui-state-badge state="unverified" />
                  }
                </button>
              </li>
            } @empty {
              <li class="muted">{{ 'graph.fed.empty' | t }}</li>
            }
          </ul>
        }
        @if (!g.nodes.length) {
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
    .muted {
      font-size: var(--font-sm);
    }
    .views strong,
    .fed h2 {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
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
    }
    .views strong ui-icon,
    .fed__head ui-icon,
    .fed__detail-head ui-icon {
      color: var(--accent-ink);
    }
    .fed__state {
      font-size: var(--font-xs);
      border-radius: var(--radius-pill);
      flex: none;
      color: var(--fg-muted);
      border: 1px solid var(--border);
      padding: 0 6px;
      max-width: 8rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .fed__sources,
    .fed__legend,
    .fed__nodes {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .fed__sources,
    .fed__legend {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-3);
      font-size: var(--font-xs);
    }
    .fed__sources {
      margin: var(--space-2) 0;
    }
    .fed__sources li,
    .fed__legend li {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }
    .fed__legend {
      color: var(--fg-muted);
    }
    /* 2.1 inspector/impact/diff/group styles live in styles.css — same
       consolidation the .chip/.chip-link shared blocks already used. */
    .fed__nodes {
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
      /* buttons inherit the UA buttonface gray — paint the token surface or
         the label/id text loses AA contrast in dark schemes (axe §1.4.3) */
      background: var(--bg-elevated);
      border-radius: var(--radius-md);
      color: var(--fg);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        border-color var(--motion-fast),
        box-shadow var(--motion-fast),
        background var(--motion-fast);
    }
    .fed__node:hover {
      border-color: var(--accent-ink);
      background: var(--bg-hover);
    }
    .fed__node[data-unverified] {
      border-style: dashed;
      /* no opacity here: alpha < 1 dims the kind chip/badge text below AA —
         a translucent surface keeps the "not yet observed" cue legally */
      background: color-mix(in srgb, var(--bg-elevated) 55%, transparent);
    }
    .fed__node[data-failed] {
      border-color: var(--error);
    }
    .fed__node[data-selected] {
      border-color: var(--accent-ink);
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
    .fed__detail-actions,
    .fed__head-side,
    .fed__view-toggle,
    .fed__depth {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .fed__depth {
      gap: var(--space-1);
      margin-left: var(--space-2);
    }
    .fed__open {
      text-decoration: none;
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
    .fed__canvas-wrap {
      display: grid;
      gap: var(--space-2);
    }
    .fed__toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .fed__toolbar-gap {
      flex: 1;
    }
    .fed__canvas {
      height: 520px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-elevated);
      overflow: hidden;
    }
    .fed__canvas canvas {
      outline: none;
    }
    .fed__hover {
      margin: 0;
      min-height: 1.1em;
      font-size: var(--font-xs);
    }
    .fed__legend-dot {
      width: 10px;
      height: 10px;
      display: inline-block;
      border-radius: 3px;
      flex: none;
    }
    .fed__legend-rule {
      width: 18px;
      height: 0;
      border-top: 2px solid var(--fg-muted);
      display: inline-block;
      flex: none;
    }
    .fed__legend-rule--dashed {
      border-top-style: dashed;
    }
    .fed__legend-rule--dotted {
      border-top-style: dotted;
    }
  `,
})
export class GraphPage {
  private readonly api = inject(PortalApi);
  private readonly store = inject(PortalStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly bundle = signal<GraphBundle | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly loading = signal(true);

  /** Federated model — rebuilt after every load attempt. */
  readonly fed = signal<FedGraph | null>(null);
  readonly query = signal('');
  readonly kind = signal<FedNodeKind | null>(null);
  readonly selected = signal<FedNode | null>(null);
  readonly selectedEdge = signal<FedEdge | null>(null);

  /** Studio surface: the accessible list is the default; the canvas is
   *  mounted on demand and destroyed when the toggle leaves it. */
  readonly mode = signal<'list' | 'canvas'>('list');
  readonly layouts = GRAPH_LAYOUTS;
  readonly layoutName = signal<GraphLayoutName>('cose');
  readonly canvasEl = viewChild<ElementRef<HTMLElement>>('canvasEl');
  /** Signals the sync effects once the async engine import lands. */
  readonly rendererReady = signal(false);

  /** 2.1 — analysis + studio state. */
  readonly impactDepth = signal(2);
  readonly impactCap = IMPACT_LIST_CAP;
  readonly pathTarget = signal<string | null>(null);
  readonly pathDir = signal<'out' | 'both'>('out');
  readonly groupBy = signal<GraphGroupBy | null>(null);
  readonly collapsed = signal<ReadonlySet<string>>(new Set());
  readonly snap = signal<GraphSnapshot | null>(loadSnapshot(storage()));
  readonly diff = signal<GraphDiff | null>(null);
  readonly hovered = signal<GraphSelection | null>(null);
  readonly vp = signal<GraphViewport | null>(null);
  private graphsLoadedAt = signal<string | null>(null);

  private renderer: GraphRenderer | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Saved view applied once after the first model build. */
  private restored = false;
  /** Camera waiting for the canvas to mount. */
  private pendingViewport: GraphViewport | null = null;

  /** One Source per adapter op — a failed endpoint degrades to its
   *  strip chip, never blanks the studio. Payloads cast in `data()`. */
  private readonly srcs: { id: StudioSource; src: Source<unknown> }[] = [
    { id: 'capabilities', src: new Source<unknown>() },
    { id: 'skills', src: new Source<unknown>() },
    { id: 'agents', src: new Source<unknown>() },
    { id: 'mcp', src: new Source<unknown>() },
    { id: 'hosts', src: new Source<unknown>() },
    { id: 'tasks', src: new Source<unknown>() },
    { id: 'events', src: new Source<unknown>() },
  ];

  readonly nodeById = computed(() => {
    const map = new Map<string, FedNode>();
    for (const n of this.fed()?.nodes ?? []) map.set(n.id, n);
    return map;
  });

  /** Real incident-edge count per node — one pass over the edges. */
  readonly degreeMap = computed(() => {
    const m = new Map<string, number>();
    for (const e of this.fed()?.edges ?? []) {
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
      m.set(e.target, (m.get(e.target) ?? 0) + 1);
    }
    return m;
  });

  /** Multi-hop topological report for the selected node. */
  readonly report = computed<ImpactReport | null>(() => {
    const sel = this.selected();
    const g = this.fed();
    if (!sel || !g) return null;
    return impactReport(g, sel.id, this.impactDepth());
  });

  /** Shortest path to the chosen target — null when none exists. */
  readonly pathResult = computed<GraphPath | null>(() => {
    const sel = this.selected();
    const g = this.fed();
    const target = this.pathTarget();
    if (!sel || !g || !target) return null;
    return shortestPath(g, sel.id, target, this.pathDir());
  });

  readonly groupSpec = computed(() => {
    const g = this.fed();
    const by = this.groupBy();
    if (!g || !by) return null;
    return groupingFor(g, by);
  });

  /** Edges sharing the selected edge's endpoints — related relations,
   *  direction-agnostic, excluding the edge itself. */
  relatedEdges(e: FedEdge): FedEdge[] {
    const g = this.fed();
    if (!g) return [];
    return g.edges.filter(
      (x) =>
        x.id !== e.id &&
        ((x.source === e.source && x.target === e.target) ||
          (x.source === e.target && x.target === e.source)),
    );
  }

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
    // Mount/destroy follows the canvas element's presence (mode toggle).
    effect(() => {
      const el = this.canvasEl()?.nativeElement ?? null;
      if (el && !this.renderer) void this.mountCanvas(el);
      if (!el && this.renderer) this.destroyCanvas();
    });
    // FedGraph → view model, re-pushed after every rebuild.
    effect(() => {
      this.rendererReady();
      const g = this.fed();
      if (this.renderer && g) {
        this.renderer.setData(toViewModel(g));
        if (this.pendingViewport) {
          this.renderer.setViewport(this.pendingViewport);
          this.pendingViewport = null;
        }
      }
    });
    // Selection + analysis emphasis share one sync path: a found path
    // outranks the impact halo; the halo outranks the bare selection.
    effect(() => {
      this.rendererReady();
      const r = this.renderer;
      if (!r) return;
      const sel = this.selected();
      const edge = this.selectedEdge();
      r.select(sel?.id ?? edge?.id ?? null);
      const path = this.pathResult();
      if (path?.nodes) {
        r.highlight(new Set(path.nodes), new Set(path.edges));
        return;
      }
      if (sel) {
        const rep = this.report();
        if (rep) {
          r.highlight(
            new Set([sel.id, ...rep.uses.map((h) => h.id), ...rep.usedBy.map((h) => h.id)]),
            new Set(rep.edges.map((e) => e.id)),
          );
          return;
        }
      }
      r.highlight(new Set(), new Set());
    });
    // Active search/kind filters dim non-matching canvas nodes; the
    // selection itself is never touched by filtering.
    effect(() => {
      this.rendererReady();
      const r = this.renderer;
      if (!r) return;
      const active = norm(this.query()) !== '' || this.kind() !== null;
      r.dimExcept(active ? new Set(this.filtered().map((n) => n.id)) : null);
    });
    // Compound grouping — spec recomputed when model/group mode change.
    effect(() => {
      this.rendererReady();
      const r = this.renderer;
      if (!r) return;
      const spec = this.groupSpec();
      r.setGrouping(spec ? { ...spec, collapsed: this.collapsed() } : null);
    });
    // Diff overlay — canvas marks only for still-present elements.
    effect(() => {
      this.rendererReady();
      const r = this.renderer;
      if (!r) return;
      const d = this.diff();
      r.setDiff(d ? diffMarks(d) : null);
    });
    // Persist the view state (debounced) — never blocks, never secrets.
    effect(() => {
      this.mode();
      this.layoutName();
      this.query();
      this.kind();
      this.selected();
      this.selectedEdge();
      this.groupBy();
      this.collapsed();
      this.vp();
      this.schedulePersist();
    });
    this.destroyRef.onDestroy(() => {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.destroyCanvas();
    });
    void this.load();
  }

  /** The mounted renderer — null in list mode or before the lazy
   *  engine import resolves. Exposed for tests and diagnostics. */
  canvasRenderer(): GraphRenderer | null {
    return this.renderer;
  }

  private mounting: HTMLElement | null = null;

  private async mountCanvas(el: HTMLElement): Promise<void> {
    if (this.mounting) return; // one mount in flight at a time
    this.mounting = el;
    try {
      const { createCytoscapeRenderer } = await import('../../core/graph/cytoscape-adapter');
      if (this.canvasEl()?.nativeElement !== el || this.renderer) return; // stale toggle
      const reduced =
        typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      const r = createCytoscapeRenderer({ animate: !reduced });
      r.mount(el);
      r.onSelect((s) => this.onCanvasSelect(s));
      r.onHover((s) => this.hovered.set(s));
      r.onViewport((v) => this.vp.set(v));
      r.layout(this.layoutName());
      this.renderer = r;
      this.rendererReady.set(true);
    } finally {
      this.mounting = null;
    }
  }

  private destroyCanvas(): void {
    this.renderer?.destroy();
    this.renderer = null;
    this.rendererReady.set(false);
  }

  private onCanvasSelect(sel: GraphSelection | null): void {
    if (sel?.type === 'node') {
      this.selectedEdge.set(null);
      this.selectId(sel.id);
    } else if (sel?.type === 'edge') {
      this.selected.set(null);
      this.selectedEdge.set(this.fed()?.edges.find((e) => e.id === sel.id) ?? null);
    } else {
      this.selected.set(null);
      this.selectedEdge.set(null);
    }
  }

  setMode(m: 'list' | 'canvas'): void {
    this.mode.set(m);
  }

  setLayout(name: GraphLayoutName): void {
    this.layoutName.set(name);
    this.renderer?.layout(name);
  }

  resetLayout(): void {
    this.renderer?.layout(this.layoutName());
  }

  fitCanvas(): void {
    this.renderer?.fit();
  }

  zoomToSelected(): void {
    const id = this.selected()?.id ?? this.selectedEdge()?.id;
    if (id) this.renderer?.zoomTo(id);
  }

  /** Select + focus on the canvas — the shared gesture every neighbor
   *  chip, diff row, relation row and path hop uses. */
  selectFocus(id: string): void {
    this.selectId(id);
    if (this.renderer) this.renderer.zoomTo(id);
  }

  onGroupBy(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.groupBy.set(v === 'kind' || v === 'forge' || v === 'host' ? v : null);
    this.collapsed.set(new Set());
  }

  toggleGroup(gid: string): void {
    const next = new Set(this.collapsed());
    if (next.has(gid)) next.delete(gid);
    else next.add(gid);
    this.collapsed.set(next);
  }

  onPathTarget(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.pathTarget.set(v || null);
  }

  /** Node ids other than the selected one — capped so the <select>
   *  never becomes the heaviest node on the page. */
  pathOptions(exclude: string): { id: string }[] {
    return (this.fed()?.nodes ?? [])
      .filter((n) => n.id !== exclude)
      .slice(0, PATH_TARGET_CAP)
      .map((n) => ({ id: n.id }));
  }

  /** Snapshot: capture the CURRENT canonical model at click time —
   *  the honest second sample for topology diffs. */
  takeSnapshot(): void {
    const g = this.fed();
    if (!g) return;
    const snap = captureSnapshot(g, new Date().toISOString());
    saveSnapshot(storage(), snap);
    this.snap.set(snap);
    this.diff.set(diffSnapshots(snap, g)); // self-diff → honest 'unchanged'
  }

  toggleDiff(g: FedGraph): void {
    this.diff.set(this.diff() ? null : diffSnapshots(this.snap()!, g));
  }

  dropSnapshot(): void {
    clearSnapshot(storage());
    this.snap.set(null);
    this.diff.set(null);
  }

  /** Reset view = clear the saved record AND return to the default
   *  studio state — the saved file must not resurrect stale prefs. */
  resetView(): void {
    clearViewState(storage());
    this.mode.set('list');
    this.query.set('');
    this.kind.set(null);
    this.selected.set(null);
    this.selectedEdge.set(null);
    this.pathTarget.set(null);
    this.groupBy.set(null);
    this.collapsed.set(new Set());
    this.layoutName.set('cose');
    this.vp.set(null);
    this.renderer?.layout('cose');
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      const state: GraphViewState = {
        schema: 'forge-portal/GraphView/v1',
        mode: this.mode(),
        layout: this.layoutName(),
        query: this.query(),
        kind: this.kind(),
        selectedNode: this.selected()?.id ?? null,
        selectedEdge: this.selectedEdge()?.id ?? null,
        viewport: this.vp(),
        groupBy: this.groupBy(),
        collapsedGroups: [...this.collapsed()],
      };
      saveViewState(storage(), state);
    }, 200);
  }

  /** Apply the saved view once — ids that no longer resolve are
   *  dropped honestly (the model is rebuilt live every load). */
  private applySaved(): void {
    if (this.restored) return;
    this.restored = true;
    const s = loadViewState(storage());
    if (!s) return;
    this.mode.set(s.mode);
    this.layoutName.set(s.layout);
    this.query.set(s.query);
    this.kind.set(s.kind);
    this.groupBy.set(s.groupBy);
    this.collapsed.set(new Set(s.collapsedGroups));
    if (s.viewport) this.pendingViewport = s.viewport;
    const nodes = this.nodeById();
    if (s.selectedNode && nodes.has(s.selectedNode)) {
      this.selected.set(nodes.get(s.selectedNode)!);
    } else if (s.selectedEdge) {
      const e = this.fed()?.edges.find((x) => x.id === s.selectedEdge);
      if (e) this.selectedEdge.set(e);
    }
  }

  /** Raster export — silently skipped when the host can't rasterize
   *  (the renderer honestly returns null). */
  exportPng(): void {
    const uri = this.renderer?.exportPng();
    if (uri) this.download(uri, 'forge-federated-graph.png');
  }

  exportSvg(): void {
    const svg = this.renderer?.exportSvg();
    if (svg) {
      this.download(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        'forge-federated-graph.svg',
      );
    }
  }

  private download(href: string, name: string): void {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
  }

  kindColor(k: FedNodeKind): string {
    return KIND_STYLE[k].color;
  }

  kindShape(k: FedNodeKind): string {
    return KIND_STYLE[k].shape;
  }

  readonly isFailed = isFailed;

  degreeOf(id: string): number {
    return this.degreeMap().get(id) ?? 0;
  }

  relsOut(id: string): FedEdge[] {
    return (this.fed()?.edges ?? []).filter((e) => e.source === id);
  }

  relsIn(id: string): FedEdge[] {
    return (this.fed()?.edges ?? []).filter((e) => e.target === id);
  }

  metaRows(n: FedNode): [string, string | number | boolean | null][] {
    return Object.entries(n.meta ?? {});
  }

  /** Status-line under the canvas: hovered element provenance — the
   *  canvas-tooltip honest substitute (canvas has no DOM tooltips). */
  hoverLine(): string {
    const h = this.hovered();
    if (!h) return ' ';
    const g = this.fed();
    if (!g) return h.id;
    if (h.type === 'node') {
      const n = this.nodeById().get(h.id);
      return n ? `${n.kind} · ${n.id}` : h.id;
    }
    const e = g.edges.find((x) => x.id === h.id);
    return e ? `${e.kind} · ${SOURCE_ENDPOINT[e.evidence]}` : h.id;
  }

  evidenceState(src: FedSource): SourceAvailability {
    return this.fed()?.sources[src]?.state ?? 'unverified';
  }

  /** When the evidence endpoint was really loaded — never inferred. */
  evidenceLoadedAt(src: FedSource): string | null {
    if (src === 'graphs') return this.graphsLoadedAt();
    if (src === 'bootstrap') return this.store.refreshedAt();
    const s = this.srcs.find((x) => x.id === src);
    const at = s?.src.loadedAt();
    return at ? stamp(at) : null;
  }

  stampAt(iso: string): string {
    return stamp(iso);
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    this.selected.set(null);
    this.selectedEdge.set(null);
    const graphsCall = firstValueFrom(this.api.graphs())
      .then((b) => {
        this.bundle.set(b);
        this.graphsLoadedAt.set(new Date().toISOString());
      })
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
    this.applySaved();
    if (this.snap() && !this.diff()) {
      // a stored snapshot exists — do not auto-diff on load; the user
      // explicitly compares (an implicit diff would claim a baseline
      // the user did not choose).
    }
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
      case 'events':
        return this.api.events();
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
        events: this.data<PortalEventReport>('events')?.events ?? null,
        graphViews: this.bundle()?.views ?? null,
        servingForge: descriptor?.forge_id ?? null,
        servingVersion: descriptor?.forge_version ?? null,
        availability,
      }),
    );
  }

  private data<T>(id: StudioSource): T | null {
    return (this.srcs.find((s) => s.id === id)?.src.data() ?? null) as T | null;
  }

  // -- studio interactions ------------------------------------------

  select(n: FedNode): void {
    this.selectedEdge.set(null);
    this.pathTarget.set(null);
    this.selected.set(n);
  }

  selectId(id: string): void {
    const n = this.nodeById().get(id);
    if (n) this.select(n);
  }

  selectEdge(id: string): void {
    const e = this.fed()?.edges.find((x) => x.id === id);
    if (e) {
      this.selected.set(null);
      this.selectedEdge.set(e);
    }
  }

  /** Direct neighbor of the selected node (impact highlight). */
  isNeighbor(n: FedNode): boolean {
    const sel = this.selected();
    if (!sel || sel.id === n.id) return false;
    const rep = this.report();
    if (rep) {
      return rep.uses.some((h) => h.id === n.id) || rep.usedBy.some((h) => h.id === n.id);
    }
    return false;
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

  /** Deep link into the page that owns this entity — null for kinds
   *  with no dedicated surface (capability), never a pretend link. */
  openLink(n: FedNode): EntityLink | null {
    return entityLink(n);
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
