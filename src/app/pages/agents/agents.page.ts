import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { AgentDescriptor, SkillDescriptor } from '../../core/api/api.models';
import { FED_NODE_KINDS, FedNodeKind, buildFederatedGraph } from '../../core/graph/federated';
import {
  GRAPH_LAYOUTS,
  GraphLayoutName,
  GraphRenderer,
  GraphSelection,
} from '../../core/graph/renderer';
import { KIND_STYLE, toViewModel } from '../../core/graph/view-model';
import { PortalStore } from '../../core/portal/portal.store';
import { PrefsStore } from '../../core/prefs/prefs.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { UiFilterBar } from '../../shared/filter-bar';
import { Source } from '../explorer/forges.data';
import {
  UNDECLARED,
  agentSubgraph,
  compareAgents,
  declaredForge,
  domainOptions,
  filterAgents,
  forgeOptions,
  hostOptions,
  skillOptions,
} from './agents.data';

type StudioMode = 'cards' | 'table' | 'graph';

/**
 * Agent Studio (spec §4.4 + Cycle 4 §7) — the real /agents roster.
 *
 * Free-text search plus filters mined from the catalog itself: domain
 * chips, skill and host selects, and a Forja select that probes the
 * *declared* origin keys on each raw descriptor (same rule the
 * federated graph trusts) — agents without a declared origin land in
 * the explicit "(not declared)" bucket, never a guessed attribution.
 * The serving Forja still answers "which catalog is this" in the
 * inspector, exactly as before.
 *
 * Views: cards, table and a graph projection — the subgraph of the
 * real FedGraph (agents + their declared `associated`/`origin` edges),
 * rendered by the shared `GraphRenderer` contract through the cytoscape
 * adapter, lazy-loaded exactly like Graph Studio. No second engine.
 *
 * Comparison: two agents side by side over real descriptor fields;
 * absent values render "not declared", and `differ` only fires when
 * both sides declared a value.
 *
 * Honesty contract: tools/MCP, permissions, dependencies, compatible
 * hosts (when the list is empty) and version are NOT exposed by the
 * adapter — the inspector renders them UNVERIFIED instead of inventing
 * values. `?q=` deep-links seed the search box.
 */
@Component({
  selector: 'page-agents',
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
    <ui-page-header [title]="'agents.title' | t" [subtitle]="'agents.subtitle' | t" hintId="agent">
      <div
        class="view-toggle"
        role="group"
        [attr.aria-label]="'agents.view.label' | t"
        data-toggle="view"
      >
        @for (m of modes; track m) {
          <button
            class="fg-pill"
            type="button"
            [attr.data-view]="m"
            [attr.data-tone]="mode() === m ? 'accent' : null"
            [attr.aria-pressed]="mode() === m"
            (click)="setMode(m)"
          >
            {{ 'agents.view.' + m | t }}
          </button>
        }
      </div>
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <section class="grid" role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="card" [lines]="3" />
      </section>
    }

    @if (agents().length) {
      <ui-filter-bar [(query)]="query" placeholder="agents.search">
        <button
          class="fg-pill"
          type="button"
          [attr.data-tone]="domain() === null ? 'accent' : null"
          [attr.aria-pressed]="domain() === null"
          (click)="domain.set(null)"
        >
          {{ 'state.all' | t }}
        </button>
        @for (d of domainOpts(); track d) {
          <button
            class="fg-pill"
            type="button"
            [attr.data-tone]="domain() === d ? 'accent' : null"
            [attr.aria-pressed]="domain() === d"
            (click)="toggleDomain(d)"
          >
            {{ d }}
          </button>
        }
        @if (skillOpts().length) {
          <select
            class="input sel"
            [value]="skill() ?? ''"
            (change)="onSkill($event)"
            [attr.aria-label]="'agents.skills' | t"
          >
            <option value="">{{ 'agents.skills' | t }}: {{ 'state.all' | t }}</option>
            @for (s of skillOpts(); track s) {
              <option [value]="s" [selected]="skill() === s">{{ s }}</option>
            }
          </select>
        }
        @if (hostOpts().length) {
          <select
            class="input sel"
            data-filter="host"
            [value]="host() ?? ''"
            (change)="onHost($event)"
            [attr.aria-label]="'agents.compatibleHosts' | t"
          >
            <option value="">{{ 'agents.compatibleHosts' | t }}: {{ 'state.all' | t }}</option>
            @for (h of hostOpts(); track h) {
              <option [value]="h" [selected]="host() === h">{{ h }}</option>
            }
          </select>
        }
        @if (forgeOpts().declared.length || forgeOpts().hasUndeclared) {
          <select
            class="input sel"
            data-filter="forge"
            [value]="forge() ?? ''"
            (change)="onForge($event)"
            [attr.aria-label]="'agents.declaredForge' | t"
          >
            <option value="">{{ 'agents.declaredForge' | t }}: {{ 'state.all' | t }}</option>
            @for (f of forgeOpts().declared; track f) {
              <option [value]="f" [selected]="forge() === f">{{ f }}</option>
            }
            @if (forgeOpts().hasUndeclared) {
              <option [value]="undeclared" [selected]="forge() === undeclared">
                {{ 'agents.undeclared' | t }}
              </option>
            }
          </select>
        }
      </ui-filter-bar>

      @if (compareIds().length) {
        <section class="card tray" data-section="compare-tray" aria-live="polite">
          <span class="tray__label">{{ 'agents.compare.title' | t }}</span>
          @for (id of compareIds(); track id) {
            <span class="tray__chip">
              {{ labelFor(id) }}
              <button
                class="tray__x"
                type="button"
                [attr.aria-label]="'agents.compare.remove' | t"
                (click)="toggleCompare(id)"
              >
                ×
              </button>
            </span>
          }
          @if (compareIds().length < 2) {
            <span class="muted">{{ 'agents.compare.pick' | t }}</span>
          }
          <button class="btn btn--mini" (click)="compareIds.set([])">
            {{ 'agents.compare.clear' | t }}
          </button>
        </section>
      }

      @if (compareRows(); as rows) {
        <section class="card cmp" data-section="compare" aria-live="polite">
          <header class="cmp__head">
            <h2><ui-icon name="diff" [size]="15" />{{ 'agents.compare.title' | t }}</h2>
            <button
              class="icon-btn"
              (click)="compareIds.set([])"
              [attr.aria-label]="'state.close' | t"
            >
              <ui-icon name="chevron-right" [size]="14" />
            </button>
          </header>
          <div class="table-wrap">
            <table class="table cmp__table">
              <thead>
                <tr>
                  <th scope="col">{{ 'agents.compare.field' | t }}</th>
                  @for (a of comparePair(); track a.id) {
                    <th scope="col">
                      <code>{{ a.id }}</code>
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (r of rows; track r.key) {
                  <tr [attr.data-differ]="r.differ || null">
                    <th scope="row">{{ r.key | t }}</th>
                    @for (c of [r.a, r.b]; track $index) {
                      <td>
                        @if (c.absent) {
                          <span class="undecl">{{ 'agents.compare.notDeclared' | t }}</span>
                        } @else {
                          {{ c.text }}
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      @if (selected(); as sel) {
        <section class="card detail fg-enter" data-section="agent-detail" aria-live="polite">
          <header class="detail__head">
            <h2><ui-icon name="agents" [size]="15" />{{ sel.name || sel.id }}</h2>
            <div class="detail__actions">
              <button
                class="btn btn--mini"
                data-action="compare"
                [attr.data-tone]="compareIds().includes(sel.id) ? 'accent' : null"
                [attr.aria-pressed]="compareIds().includes(sel.id)"
                (click)="toggleCompare(sel.id)"
              >
                {{ 'agents.compare.add' | t }}
              </button>
              <button
                class="icon-btn"
                (click)="selected.set(null)"
                [attr.aria-label]="'state.close' | t"
              >
                <ui-icon name="chevron-right" [size]="14" />
              </button>
            </div>
          </header>
          <dl class="kv">
            <div>
              <dt>{{ 'table.id' | t }}</dt>
              <dd>
                <code>{{ sel.id }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.role' | t }}</dt>
              <dd>{{ sel.role || ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'agents.responsibility' | t }}</dt>
              <dd>{{ sel.description || ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'agents.authority' | t }}</dt>
              <dd>{{ sel.authority ?? ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'agents.domains' | t }}</dt>
              <dd>{{ sel.domains.length ? sel.domains.join(', ') : ('state.none' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'agents.skills' | t }}</dt>
              <dd>
                @if (sel.skills.length) {
                  <span class="links">
                    @for (s of sel.skills; track s) {
                      <a class="chip-link" [routerLink]="['/skills']" [queryParams]="{ q: s }">{{
                        s
                      }}</a>
                    }
                  </span>
                } @else {
                  {{ 'state.none' | t }}
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.origin' | t }}</dt>
              <dd>
                @if (store.descriptor(); as d) {
                  {{ d.forge_name }} <code>({{ d.forge_id }})</code>
                  <span class="chip">{{ 'explorer.serving' | t }}</span>
                } @else {
                  <ui-state-badge state="UNVERIFIED" />
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.declaredForge' | t }}</dt>
              <dd>
                @if (declaredForge(sel, knownForges()); as f) {
                  <code>{{ f }}</code>
                } @else {
                  <span class="undecl">{{ 'agents.compare.notDeclared' | t }}</span>
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.compatibleHosts' | t }}</dt>
              <dd>
                @if (sel.hosts.length) {
                  <span class="links">
                    @for (hh of sel.hosts; track hh) {
                      <!-- declared hosts[] — real anchor on the Hosts
                           page (#host-<id>); absent cards just no-op. -->
                      <a class="chip-link" [routerLink]="['/hosts']" [fragment]="'host-' + hh">{{
                        hh
                      }}</a>
                    }
                  </span>
                } @else {
                  <ui-state-badge state="UNVERIFIED" />
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'skills.state' | t }}</dt>
              <dd>
                <ui-state-badge
                  [state]="sel.state === 'available' ? 'supported' : 'unverified'"
                  [labelOverride]="sel.state"
                />
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.tools' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'agents.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.permissions' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'agents.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.deps' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'agents.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'settings.version' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'agents.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.evidence' | t }}</dt>
              <dd><code>GET /api/v1/agents</code></dd>
            </div>
          </dl>
        </section>
      }

      @if (mode() === 'cards') {
        <section class="grid" data-section="cards">
          @for (a of filtered(); track a.id) {
            <article class="card" data-lift>
              <header class="head">
                <h2><ui-icon name="agents" [size]="15" />{{ a.name || a.id }}</h2>
                <ui-state-badge
                  [state]="a.state === 'available' ? 'supported' : 'unverified'"
                  [labelOverride]="a.state"
                />
              </header>
              <p class="role">{{ a.role }}</p>
              <p class="muted">{{ a.description }}</p>
              @if (a.domains.length) {
                <p class="tags">
                  <span>{{ 'agents.domains' | t }}:</span> {{ a.domains.join(', ') }}
                </p>
              }
              @if (a.skills.length) {
                <p class="tags">
                  <span>{{ 'agents.skills' | t }}:</span> {{ a.skills.join(', ') }}
                </p>
              }
              <div class="row">
                <button
                  class="btn btn--mini"
                  data-action="compare"
                  [attr.data-tone]="compareIds().includes(a.id) ? 'accent' : null"
                  [attr.aria-pressed]="compareIds().includes(a.id)"
                  (click)="toggleCompare(a.id)"
                >
                  {{ 'agents.compare.add' | t }}
                </button>
                <button class="btn btn--mini" data-action="detail" (click)="selected.set(a)">
                  {{ 'agents.detail' | t }}
                  <ui-icon name="chevron-right" [size]="13" />
                </button>
              </div>
            </article>
          } @empty {
            @if (!loading()) {
              <ui-empty icon="agents" [title]="'agents.empty' | t" />
            }
          }
        </section>
      }

      @if (mode() === 'table') {
        <section class="card" data-section="table">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">{{ 'table.name' | t }}</th>
                  <th scope="col">{{ 'agents.role' | t }}</th>
                  <th scope="col">{{ 'agents.domains' | t }}</th>
                  <th scope="col">{{ 'agents.skills' | t }}</th>
                  <th scope="col">{{ 'agents.compatibleHosts' | t }}</th>
                  <th scope="col">{{ 'skills.state' | t }}</th>
                  <th scope="col">
                    <span class="sr-only">{{ 'table.actions' | t }}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (a of filtered(); track a.id) {
                  <tr>
                    <td>
                      <strong>{{ a.name || a.id }}</strong>
                      <br /><code class="row-id">{{ a.id }}</code>
                    </td>
                    <td>{{ a.role || '—' }}</td>
                    <td>{{ a.domains.length ? a.domains.join(', ') : '—' }}</td>
                    <td>{{ a.skills.length ? a.skills.join(', ') : '—' }}</td>
                    <td>
                      @if (a.hosts.length) {
                        @for (hh of a.hosts; track hh; let last = $last) {
                          <a class="linklike" [routerLink]="['/hosts']" [fragment]="'host-' + hh">{{
                            hh
                          }}</a
                          >{{ last ? '' : ', ' }}
                        }
                      } @else {
                        <span class="undecl">{{ 'agents.compare.notDeclared' | t }}</span>
                      }
                    </td>
                    <td>
                      <ui-state-badge
                        [state]="a.state === 'available' ? 'supported' : 'unverified'"
                        [labelOverride]="a.state"
                      />
                    </td>
                    <td class="row-actions">
                      <button
                        class="btn btn--mini"
                        data-action="compare"
                        [attr.data-tone]="compareIds().includes(a.id) ? 'accent' : null"
                        [attr.aria-pressed]="compareIds().includes(a.id)"
                        (click)="toggleCompare(a.id)"
                      >
                        {{ 'agents.compare.add' | t }}
                      </button>
                      <button class="btn btn--mini" data-action="detail" (click)="selected.set(a)">
                        {{ 'agents.detail' | t }}
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="empty-cell">{{ 'agents.empty' | t }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      @if (mode() === 'graph') {
        <section class="card" data-section="graph">
          <p class="muted graph__hint">{{ 'agents.graph.hint' | t }}</p>
          @if (subgraph().nodes.length) {
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
              <span class="toolbar-gap"></span>
              <button class="fg-pill" type="button" data-action="reset" (click)="resetLayout()">
                {{ 'graph.canvas.reset' | t }}
              </button>
              <button class="fg-pill" type="button" data-action="fit" (click)="fitCanvas()">
                {{ 'graph.canvas.fit' | t }}
              </button>
              <button class="fg-pill" type="button" data-action="png" (click)="exportPng()">
                PNG
              </button>
              <button class="fg-pill" type="button" data-action="svg" (click)="exportSvg()">
                SVG
              </button>
            </div>
            <div
              #canvasEl
              class="fed__canvas"
              data-canvas="agents"
              role="application"
              [attr.aria-label]="'agents.graph.aria' | t"
            ></div>
            <ul class="fed__legend" [attr.aria-label]="'graph.canvas.legend' | t">
              @for (k of graphKinds(); track k) {
                <li [attr.data-kind]="k">
                  <span
                    class="legend-dot"
                    [style.background]="kindColor(k)"
                    [attr.data-shape]="kindShape(k)"
                  ></span>
                  {{ k }}
                </li>
              }
            </ul>
          } @else {
            <ui-empty icon="network" [title]="'agents.graph.empty' | t" />
          }
        </section>
      }
    } @else if (!error() && !loading()) {
      <ui-empty icon="agents" [title]="'agents.none' | t" />
    }
  `,
  styles: `
    .grid {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
    }
    h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    h2 ui-icon {
      color: var(--accent-ink);
    }
    .role {
      color: var(--accent-ink);
      font-size: var(--font-sm);
      margin: 4px 0;
    }
    .muted {
      color: var(--fg-muted);
      margin: 0;
    }
    .tags {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      margin: 4px 0 0;
    }
    .tags span {
      font-weight: 600;
    }
    .sel {
      width: auto;
      min-width: 12rem;
      padding-block: 2px;
      font-size: var(--font-xs);
    }
    .row {
      margin-top: var(--space-3);
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
    }
    .view-toggle {
      display: inline-flex;
      gap: var(--space-1);
      margin-right: var(--space-2);
    }
    .tray {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
      padding-block: var(--space-2);
    }
    .tray__label {
      font-weight: 650;
      font-size: var(--font-sm);
    }
    .tray__chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: var(--font-xs);
      font-weight: 600;
      color: var(--accent-ink);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 2px 6px 2px 10px;
    }
    .tray__x {
      border: 0;
      background: none;
      color: inherit;
      font-size: var(--font-sm);
      line-height: 1;
      cursor: pointer;
      padding: 0 2px;
    }
    .cmp {
      margin-bottom: var(--space-4);
      border-left: 3px solid var(--info);
    }
    .cmp__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .cmp__table th[scope='row'] {
      text-align: left;
      font-size: var(--font-sm);
      color: var(--fg-muted);
      white-space: nowrap;
    }
    .cmp__table tr[data-differ] td {
      background: color-mix(in srgb, var(--info) 8%, transparent);
    }
    .undecl {
      color: var(--fg-muted);
      font-style: italic;
      font-size: var(--font-xs);
    }
    .row-id {
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .row-actions {
      white-space: nowrap;
      display: flex;
      gap: var(--space-1);
      justify-content: flex-end;
    }
    .empty-cell {
      text-align: center;
      color: var(--fg-muted);
      padding: var(--space-4) !important;
    }
    .table-wrap {
      overflow-x: auto;
    }
    .graph__hint {
      margin: 0 0 var(--space-3);
      font-size: var(--font-sm);
    }
    .fed__toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }
    .toolbar-gap {
      flex: 1;
    }
    .fed__canvas {
      height: 420px;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-elevated);
      overflow: hidden;
    }
    .fed__canvas canvas {
      outline: none;
    }
    .fed__legend {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-3);
      padding: 0;
      margin: var(--space-2) 0 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .fed__legend li {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      display: inline-block;
      border-radius: 3px;
      flex: none;
    }
    .detail {
      margin-bottom: var(--space-4);
      border-left: 3px solid var(--accent);
    }
    .detail__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .detail__actions {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
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
      min-width: 9rem;
      color: var(--fg-muted);
      font-size: var(--font-sm);
      flex: none;
    }
    .kv dd {
      margin: 0;
      min-width: 0;
    }
    .unv-cell {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .links {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    /* .chip/.chip-link consolidated into styles.css shared blocks;
       the page only keeps its offset. */
    .chip {
      margin-left: 4px;
    }
  `,
})
export class AgentsPage implements OnInit {
  private readonly api = inject(PortalApi);
  readonly store = inject(PortalStore);
  private readonly prefs = inject(PrefsStore);
  private readonly destroyRef = inject(DestroyRef);

  /** Route `?q=` deep-link (withComponentInputBinding). */
  readonly q = input('');

  readonly agents = signal<AgentDescriptor[]>([]);
  readonly error = signal<ApiError | null>(null);
  readonly query = signal('');
  readonly domain = signal<string | null>(null);
  readonly skill = signal<string | null>(null);
  readonly host = signal<string | null>(null);
  /** A declared origin id, UNDECLARED, or null = no Forja filter. */
  readonly forge = signal<string | null>(null);
  readonly selected = signal<AgentDescriptor | null>(null);
  readonly loading = signal(true);

  readonly modes: readonly StudioMode[] = ['cards', 'table', 'graph'];
  readonly mode = signal<StudioMode>('cards');
  readonly undeclared = UNDECLARED;

  /** Side-by-side comparison — at most two ids, FIFO when a third is
   *  picked so the gesture never dead-ends. */
  readonly compareIds = signal<string[]>([]);

  /** Skills catalog — only feeds the graph view's `associated` edges.
   *  Its availability joins the subgraph evidence honestly. */
  readonly skillsSrc = new Source<SkillDescriptor[]>();

  readonly layouts = GRAPH_LAYOUTS;
  readonly layoutName = signal<GraphLayoutName>('cose');
  readonly canvasEl = viewChild<ElementRef<HTMLElement>>('canvasEl');
  readonly rendererReady = signal(false);
  private renderer: GraphRenderer | null = null;
  private mounting: HTMLElement | null = null;

  /** Forjas the catalog can legitimately name: the serving one plus
   *  every declared origin observed on the roster. */
  readonly knownForges = computed<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    const serving = this.store.descriptor()?.forge_id;
    if (serving) set.add(serving);
    for (const a of this.agents()) {
      const f = declaredForge(a, set);
      if (f) set.add(f);
    }
    return set;
  });

  readonly domainOpts = computed(() => domainOptions(this.agents()));
  readonly skillOpts = computed(() => skillOptions(this.agents()));
  readonly hostOpts = computed(() => hostOptions(this.agents()));
  readonly forgeOpts = computed(() => forgeOptions(this.agents(), this.knownForges()));

  readonly filtered = computed(() =>
    filterAgents(
      this.agents(),
      {
        query: this.query(),
        domain: this.domain(),
        skill: this.skill(),
        host: this.host(),
        forge: this.forge(),
      },
      this.knownForges(),
    ),
  );

  readonly comparePair = computed<AgentDescriptor[]>(() => {
    const byId = new Map(this.agents().map((a) => [a.id, a]));
    return this.compareIds()
      .map((id) => byId.get(id))
      .filter((a): a is AgentDescriptor => a !== undefined)
      .slice(0, 2);
  });

  readonly compareRows = computed(() => {
    const pair = this.comparePair();
    return pair.length === 2 ? compareAgents(pair[0]!, pair[1]!, this.knownForges()) : null;
  });

  /** Federated model scoped to this page's sources — same builder the
   *  Graph Studio runs, fed only by what this page really loaded. */
  readonly fed = computed(() =>
    buildFederatedGraph({
      agents: this.agents(),
      skills: this.skillsSrc.data(),
      servingForge: this.store.descriptor()?.forge_id ?? null,
      availability: {
        agents: 'loaded',
        skills: this.skillsSrc.data()
          ? 'loaded'
          : this.skillsSrc.unavailable()
            ? 'unavailable'
            : 'unverified',
        bootstrap: this.store.descriptor() ? 'loaded' : 'unverified',
      },
    }),
  );

  /** The filtered agent subgraph — agents matching the active filters
   *  plus the nodes their declared edges point at. */
  readonly subgraph = computed(() =>
    agentSubgraph(this.fed(), new Set(this.filtered().map((a) => a.id))),
  );

  readonly graphKinds = computed<FedNodeKind[]>(() =>
    FED_NODE_KINDS.filter((k) => (this.subgraph().counts[k] ?? 0) > 0),
  );

  protected readonly declaredForge = declaredForge;

  constructor() {
    // Mount/destroy follows the canvas element's presence (graph mode).
    effect(() => {
      const el = this.canvasEl()?.nativeElement ?? null;
      if (el && !this.renderer) void this.mountCanvas(el);
      if (!el && this.renderer) this.destroyCanvas();
    });
    // Subgraph → view model, re-pushed after every rebuild.
    effect(() => {
      this.rendererReady();
      if (this.renderer) this.renderer.setData(toViewModel(this.subgraph()));
    });
    // Selection mirrors the inspector's agent on the canvas.
    effect(() => {
      this.rendererReady();
      const r = this.renderer;
      if (!r) return;
      const sel = this.selected();
      r.select(sel ? `agent:${sel.id}` : null);
      r.highlight(new Set(), new Set());
    });
    // §8.3 — the filter text persists; a `?q=` deep-link wins over the
    // stored value, and whatever wins is kept for the next visit.
    effect(() => this.prefs.setFilter('agents', this.query()));
    this.destroyRef.onDestroy(() => this.destroyCanvas());
    void this.load();
  }

  ngOnInit(): void {
    const seed = this.q();
    if (seed) this.query.set(seed);
    else {
      const saved = this.prefs.filterFor('agents');
      if (saved) this.query.set(saved);
    }
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    const skillsCall = this.skillsSrc.load(() => this.api.skills());
    try {
      this.agents.set(await firstValueFrom(this.api.agents()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
    await skillsCall;
  }

  setMode(m: StudioMode): void {
    this.mode.set(m);
  }

  toggleDomain(d: string): void {
    this.domain.set(this.domain() === d ? null : d);
  }

  onSkill(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.skill.set(v || null);
  }

  onHost(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.host.set(v || null);
  }

  onForge(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.forge.set(v || null);
  }

  labelFor(id: string): string {
    return this.agents().find((a) => a.id === id)?.name || id;
  }

  /** Add/remove an agent from the comparison; a third pick evicts the
   *  oldest so the pair stays at two. */
  toggleCompare(id: string): void {
    const cur = this.compareIds();
    if (cur.includes(id)) {
      this.compareIds.set(cur.filter((x) => x !== id));
      return;
    }
    this.compareIds.set([...cur, id].slice(-2));
  }

  /** The mounted renderer — null outside graph mode or before the lazy
   *  engine import resolves. Exposed for tests and diagnostics. */
  canvasRenderer(): GraphRenderer | null {
    return this.renderer;
  }

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

  /** Canvas taps resolve to the agent inspector only — skill/forge
   *  nodes clear the selection (their evidence stays in the graph). */
  private onCanvasSelect(sel: GraphSelection | null): void {
    if (sel?.type === 'node' && sel.id.startsWith('agent:')) {
      const id = sel.id.slice('agent:'.length);
      this.selected.set(this.agents().find((a) => a.id === id) ?? null);
    } else if (sel === null) {
      this.selected.set(null);
    }
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

  /** Raster export — silently skipped when the host can't rasterize
   *  (the renderer honestly returns null). */
  exportPng(): void {
    const uri = this.renderer?.exportPng();
    if (uri) this.download(uri, 'forge-agents-graph.png');
  }

  exportSvg(): void {
    const svg = this.renderer?.exportSvg();
    if (svg) {
      this.download(
        `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        'forge-agents-graph.svg',
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
}
