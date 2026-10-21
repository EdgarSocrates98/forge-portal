import { Component, computed, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import {
  FederationSnapshot,
  GraphBundle,
  HostDetection,
  McpServerDescriptor,
  RegistryState,
  TaskExecution,
  VersionInfo,
} from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { PrefsStore, routeLabelKey } from '../../core/prefs/prefs.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, buildForgeRows, stamp } from '../explorer/forges.data';
import { InventoryPanel } from '../explorer/inventory-panel';
import { buildAlerts, buildVersionRows, isFailedTask, registryInstallCount } from './ops.data';

/**
 * Operational control center — one honest section per data source.
 * Each section carries its endpoint label, a refresh control and the
 * timestamp of the last real answer; a failed source degrades only its
 * own section (UNVERIFIED / error panel) while the rest keep rendering
 * real data. Alerts derive from already-fetched payloads and always
 * link to the page where the operator resolves them — nothing is
 * inferred beyond what each endpoint answered.
 */
@Component({
  selector: 'page-dashboard',
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
    InventoryPanel,
  ],
  template: `
    <ui-page-header
      [title]="'dashboard.title' | t"
      [subtitle]="'dashboard.subtitle' | t"
      hintId="start"
    >
      <button class="btn" (click)="refreshAll()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (store.status() === 'booting' && !health()) {
      <div class="boot" role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="card" />
        <ui-skeleton kind="row" [lines]="4" />
      </div>
    } @else {
      <section class="card status" data-section="status">
        <div class="status__top">
          <div class="status__id">
            <strong>{{ store.forgeName() }}</strong>
            @if (descriptor()?.forge_version; as v) {
              <code class="ver">v{{ v }}</code>
            }
            @if (store.federated()) {
              <span class="fed">{{ 'settings.federated' | t }}</span>
            }
          </div>
          <button
            class="icon-btn"
            (click)="store.refreshHealth()"
            [attr.aria-label]="'state.refresh' | t"
          >
            <ui-icon name="refresh" [size]="14" />
          </button>
        </div>
        <div class="status__meta">
          <ui-state-badge [state]="health()?.state ?? 'UNVERIFIED'" />
          <span class="meta">
            <ui-icon name="folder" [size]="13" />{{
              store.workspace()?.name ?? ('dashboard.noWorkspace' | t)
            }}
          </span>
          <span class="meta">
            {{ 'dashboard.profile' | t }}:
            @if (health(); as h) {
              {{ h.profile ?? ('state.none' | t) }}
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </span>
          <span class="meta">
            {{ 'dashboard.accountEnvironment' | t }}
            @if (store.accountEnvironment(); as env) {
              <ui-state-badge [state]="env.state" />
            } @else {
              <ui-state-badge state="MISSING" />
            }
          </span>
          @if (lastArea(); as la) {
            <span class="meta">
              <ui-icon name="history" [size]="13" />
              {{ 'dashboard.lastArea' | t }}
              <a class="linklike" [routerLink]="la.url">{{
                la.labelKey ? (la.labelKey | t) : la.url
              }}</a>
            </span>
          }
        </div>
        <p class="src">
          <code>bootstrap · GET /api/v1/installation/status</code>
          @if (store.refreshedAt(); as ts) {
            <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
          }
        </p>
      </section>

      <section data-section="stats">
        <div class="stats stagger">
          <div class="stat" [style.--stat-rail]="'var(--accent)'">
            <span class="stat__value">
              <ui-state-badge [state]="health()?.state ?? 'UNVERIFIED'" />
            </span>
            <span class="stat__label">{{ 'dashboard.stat.state' | t }}</span>
          </div>
          <div class="stat" [style.--stat-rail]="'var(--ok)'">
            <span class="stat__value">{{ capsSupported() }}/{{ store.capabilities().length }}</span>
            <span class="stat__label">{{ 'dashboard.stat.capabilities' | t }}</span>
          </div>
          <div class="stat" [style.--stat-rail]="'var(--info)'">
            <span class="stat__value">{{ checksOk() }}/{{ health()?.checks.length ?? 0 }}</span>
            <span class="stat__label">{{ 'dashboard.stat.checks' | t }}</span>
          </div>
          <div class="stat" [style.--stat-rail]="'var(--accent)'">
            <span class="stat__value">
              @if (registryCount() !== null) {
                {{ registryCount() }}
              } @else {
                <ui-state-badge state="UNVERIFIED" />
              }
            </span>
            <span class="stat__label">{{ 'dashboard.stat.registryInstalls' | t }}</span>
          </div>
          <div class="stat" [style.--stat-rail]="'var(--info)'">
            <span class="stat__value">
              @if (fed.data(); as snap) {
                {{ snap.specialists.length }}
              } @else {
                <ui-state-badge state="UNVERIFIED" />
              }
            </span>
            <span class="stat__label">{{ 'dashboard.stat.discovered' | t }}</span>
          </div>
          <div class="stat" [style.--stat-rail]="'var(--fg-muted)'">
            <span class="stat__value">{{ descriptor()?.portal_version ?? '—' }}</span>
            <span class="stat__label">{{ 'dashboard.stat.portal' | t }}</span>
          </div>
        </div>
        <p class="src">
          <code
            >bootstrap · GET /api/v1/installation/status · GET /api/v1/registry/state · GET
            /api/v1/federation</code
          >
          @if (store.refreshedAt(); as ts) {
            <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
          }
        </p>
      </section>

      <section class="card" data-section="alerts">
        <div class="sec__head">
          <div>
            <h2>
              {{ 'ops.alerts.title' | t }}
              @if (alerts().length) {
                <span class="failn" [attr.data-alerts]="alerts().length">{{
                  alerts().length
                }}</span>
              }
            </h2>
            <p class="src">
              <code>derived · {{ alertSources }}</code>
            </p>
          </div>
          <button class="icon-btn" (click)="refreshAll()" [attr.aria-label]="'state.refresh' | t">
            <ui-icon name="refresh" [size]="14" />
          </button>
        </div>
        <p class="muted sec__hint">{{ 'ops.alerts.hint' | t }}</p>

        @if (alertsLoading()) {
          <div role="status"><ui-skeleton kind="row" [lines]="3" /></div>
        } @else if (alerts().length) {
          <ul class="alerts">
            @for (a of alerts(); track a.id) {
              <li class="alert" [attr.data-severity]="a.severity" [attr.data-alert-id]="a.id">
                <ui-icon class="alert__icon" name="alert" [size]="15" />
                <div class="alert__body">
                  <span>{{ a.titleKey | t: a.params }}</span>
                  @if (a.detail) {
                    <small class="alert__detail">{{ a.detail }}</small>
                  }
                </div>
                <a class="alert__go" [routerLink]="a.route"
                  >{{ a.linkKey | t }}<ui-icon name="chevron-right" [size]="13"
                /></a>
              </li>
            }
          </ul>
        } @else {
          <ui-empty
            icon="shield-check"
            [title]="'ops.alerts.empty' | t"
            [hint]="'ops.alerts.emptyHint' | t"
          />
        }
      </section>

      <section class="card" data-section="forges">
        <div class="sec__head">
          <div>
            <h2>{{ 'dashboard.forges' | t }}</h2>
            <p class="src">
              <code>GET /api/v1/federation</code>
              @if (fed.loadedAt(); as ts) {
                <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
              }
            </p>
          </div>
          <button
            class="icon-btn"
            (click)="loadFederation()"
            [attr.aria-label]="'state.refresh' | t"
          >
            <ui-icon name="refresh" [size]="14" />
          </button>
        </div>
        <p class="muted sec__hint">{{ 'dashboard.forges.hint' | t }}</p>

        @if (fed.unavailable()) {
          <div class="unv" role="note">
            <ui-state-badge state="UNVERIFIED" />
            <span>{{ 'federation.unavailable' | t }}</span>
          </div>
        }
        @if (fed.error(); as e) {
          <ui-error [error]="e" (retry)="loadFederation()" />
        }
        @if (fed.loading() && !fed.data()) {
          <div role="status"><ui-skeleton kind="row" [lines]="3" /></div>
        }
        @if (forgesRows().length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">{{ 'table.id' | t }}</th>
                  <th scope="col">{{ 'skills.state' | t }}</th>
                  <th scope="col">{{ 'explorer.checkout' | t }}</th>
                  <th scope="col">{{ 'mcp.title' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of forgesRows(); track row.id) {
                  <tr [attr.data-serving]="row.serving || null">
                    <td>
                      <a class="linklike" [routerLink]="['/forges', row.id]">{{
                        row.name ?? row.id
                      }}</a>
                      @if (row.serving) {
                        <span class="chip">{{ 'explorer.serving' | t }}</span>
                      }
                    </td>
                    <td><ui-state-badge [state]="row.state ?? 'UNVERIFIED'" /></td>
                    <td>
                      @if (row.checkout === undefined) {
                        <ui-state-badge state="UNVERIFIED" />
                      } @else if (row.checkout === null) {
                        <span class="muted">{{ 'state.absent' | t }}</span>
                      } @else {
                        <code class="path" [attr.title]="row.checkout">{{ row.checkout }}</code>
                      }
                    </td>
                    <td>
                      @if (row.mcp === undefined) {
                        <ui-state-badge state="UNVERIFIED" />
                      } @else {
                        <span class="muted">{{
                          (row.mcp === null ? 'federation.mcpAbsent' : 'federation.mcpReady') | t
                        }}</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (fed.attempted() && !fed.loading() && !fed.error()) {
          <ui-empty icon="network" [title]="'federation.empty' | t" />
        }
        <a class="more" routerLink="/forges">
          {{ 'state.viewDetails' | t }}<ui-icon name="chevron-right" [size]="14" />
        </a>
      </section>

      <section class="card" data-section="capabilities">
        <div class="sec__head">
          <div>
            <h2>{{ 'dashboard.capabilities' | t }}</h2>
            <p class="src">
              <code>bootstrap</code>
              @if (store.refreshedAt(); as ts) {
                <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
              }
            </p>
          </div>
          <button
            class="icon-btn"
            (click)="store.refreshHealth()"
            [attr.aria-label]="'state.refresh' | t"
          >
            <ui-icon name="refresh" [size]="14" />
          </button>
        </div>
        @if (store.capabilities().length) {
          <div class="caps">
            @for (cap of store.capabilities(); track cap.id) {
              <span class="cap" [attr.data-state]="cap.state" [attr.title]="cap.state">
                <ui-icon [name]="capIcon(cap.id)" [size]="15" />
                <span class="cap__id">{{ cap.id }}</span>
                <i class="cap__dot" aria-hidden="true"></i>
              </span>
            }
          </div>
        } @else {
          <ui-empty icon="dashboard" [title]="'dashboard.none' | t" />
        }
      </section>

      <inventory-panel />

      <section class="card" data-section="versions">
        <div class="sec__head">
          <div>
            <h2>{{ 'ops.versions.title' | t }}</h2>
            <p class="src">
              <code
                >GET /api/v1/registry/state · bootstrap · GET /api/v1/federation · GET
                /api/v1/versions</code
              >
              @if (registrySrc.loadedAt(); as ts) {
                <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
              }
            </p>
          </div>
          <button class="icon-btn" (click)="loadVersions()" [attr.aria-label]="'state.refresh' | t">
            <ui-icon name="refresh" [size]="14" />
          </button>
        </div>
        <p class="muted sec__hint">{{ 'ops.versions.hint' | t }}</p>

        @if (registrySrc.unavailable()) {
          <div class="unv" role="note">
            <ui-state-badge state="UNVERIFIED" />
            <span>{{ 'ops.registry.unavailable' | t }}</span>
          </div>
        }
        @if (registrySrc.error(); as e) {
          <ui-error [error]="e" (retry)="loadVersions()" />
        }
        @if (versionsLoading()) {
          <div role="status"><ui-skeleton kind="row" [lines]="3" /></div>
        }
        @if (versionRows().length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">{{ 'table.id' | t }}</th>
                  <th scope="col">{{ 'ops.versions.col.installed' | t }}</th>
                  <th scope="col">{{ 'ops.versions.col.pinned' | t }}</th>
                  <th scope="col">{{ 'ops.versions.col.method' | t }}</th>
                  <th scope="col">{{ 'ops.versions.col.source' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of versionRows(); track row.id) {
                  <tr [attr.data-serving]="row.serving || null">
                    <td>
                      <a class="linklike" [routerLink]="['/forges', row.id]">{{ row.id }}</a>
                      @if (row.serving) {
                        <span class="chip">{{ 'explorer.serving' | t }}</span>
                      }
                    </td>
                    <td>
                      @if (row.version) {
                        <code>{{ row.version }}</code>
                      } @else {
                        <ui-state-badge state="UNVERIFIED" />
                      }
                      @if (row.updateTo; as next) {
                        <span class="chip chip--update" [attr.data-update]="next">
                          {{ 'ops.versions.update' | t: { version: next } }}
                        </span>
                      }
                    </td>
                    <td>
                      @if (row.pinned) {
                        <code>{{ row.pinned }}</code>
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td>
                      @if (row.method) {
                        <code>{{ row.method }}</code>
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td>
                      <code class="src-cell">{{ row.source }}</code>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (versionsSettled()) {
          <ui-empty
            icon="history"
            [title]="'ops.versions.empty' | t"
            [hint]="'ops.versions.emptyHint' | t"
          />
        }
        <a class="more" routerLink="/versions">
          {{ 'state.viewDetails' | t }}<ui-icon name="chevron-right" [size]="14" />
        </a>
      </section>

      <section class="card" data-section="tasks">
        <div class="sec__head">
          <div>
            <h2>
              {{ 'tasks.recent' | t }}
              @if (failures()) {
                <span class="failn" [attr.data-failures]="failures()">{{ failures() }}</span>
              }
            </h2>
            <p class="src">
              <code>GET /api/v1/tasks</code>
              @if (tasksSrc.loadedAt(); as ts) {
                <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
              }
            </p>
          </div>
          <button class="icon-btn" (click)="loadTasks()" [attr.aria-label]="'state.refresh' | t">
            <ui-icon name="refresh" [size]="14" />
          </button>
        </div>

        @if (tasksSrc.unavailable()) {
          <div class="unv" role="note">
            <ui-state-badge state="UNVERIFIED" />
            <span>{{ 'federation.unavailable' | t }}</span>
          </div>
        }
        @if (tasksSrc.error(); as e) {
          <ui-error [error]="e" (retry)="loadTasks()" />
        }
        @if (tasksSrc.loading() && !tasksSrc.data()) {
          <div role="status"><ui-skeleton kind="row" [lines]="3" /></div>
        }
        @if (recentTasks().length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">{{ 'table.task' | t }}</th>
                  <th scope="col">{{ 'table.verb' | t }}</th>
                  <th scope="col">{{ 'table.stage' | t }}</th>
                  <th scope="col">{{ 'table.exit' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (task of recentTasks(); track task.id) {
                  <tr [attr.data-fail]="taskFailed(task) || null">
                    <td>
                      <!-- actionable row: opens the task detail card on
                           /tasks — the id is a real record id, not a
                           fabricated route segment -->
                      <a
                        class="linklike"
                        [routerLink]="['/tasks']"
                        [queryParams]="{ task: task.id }"
                        >{{ task.label }}</a
                      >
                    </td>
                    <td>
                      <code>{{ task.verb }}</code>
                    </td>
                    <td>
                      <ui-state-badge [state]="taskState(task)" [labelOverride]="task.stage" />
                    </td>
                    <td>{{ task.exit_code ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (
          tasksSrc.attempted() &&
          !tasksSrc.loading() &&
          !tasksSrc.error() &&
          !tasksSrc.unavailable()
        ) {
          <ui-empty icon="tasks" [title]="'tasks.empty' | t" />
        }
        <a class="more" routerLink="/tasks">
          {{ 'state.viewDetails' | t }}<ui-icon name="chevron-right" [size]="14" />
        </a>
      </section>

      <section class="card" data-section="diagnostics">
        <div class="sec__head">
          <div>
            <h2>{{ 'ops.diagnostics.title' | t }}</h2>
          </div>
        </div>
        <p class="muted sec__hint">{{ 'ops.diagnostics.hint' | t }}</p>
        <div class="shortcuts">
          @for (s of shortcuts; track s.route) {
            <a class="shortcut" [routerLink]="s.route" [attr.data-shortcut]="s.id">
              <ui-icon [name]="s.icon" [size]="16" />
              <span class="shortcut__label">{{ s.labelKey | t }}</span>
              <ui-icon name="chevron-right" [size]="14" />
            </a>
          }
        </div>
      </section>
    }
  `,
  styles: `
    .card,
    .boot {
      margin-bottom: var(--space-4);
    }
    .status__top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
    }
    .status__id {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--font-lg);
      font-weight: 700;
      letter-spacing: -0.01em;
      min-width: 0;
    }
    .ver {
      font-size: var(--font-xs);
      font-weight: 600;
      background: var(--accent-bg);
      color: var(--accent-ink);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .fed {
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent-ink);
      border: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
      background: var(--accent-bg);
    }
    .status__meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      margin-top: var(--space-3);
    }
    .meta {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: var(--font-sm);
      color: var(--fg-muted);
    }
    .src {
      margin: var(--space-3) 0 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .sec__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
    }
    .sec__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .sec__head .src {
      margin-top: 4px;
    }
    .sec__hint {
      margin: 2px 0 var(--space-3);
      font-size: var(--font-sm);
    }
    .muted {
      color: var(--fg-muted);
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-4);
    }
    .unv {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      margin-bottom: var(--space-3);
      border: 1px dashed color-mix(in srgb, var(--warn) 55%, transparent);
      border-radius: var(--radius-md);
      background: var(--warn-bg);
      font-size: var(--font-sm);
    }
    .table-wrap {
      overflow-x: auto;
      margin-top: var(--space-2);
    }
    .path {
      display: inline-block;
      max-width: 34ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: bottom;
    }
    /* .chip consolidated into styles.css shared blocks; the page keeps
       its offset and the update tone. */
    .chip {
      margin-left: 6px;
    }
    .chip--update {
      color: var(--info);
      background: var(--info-bg);
    }
    .src-cell {
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    /* in-table links use the shared .linklike affordance */
    .more {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      margin-top: var(--space-3);
      padding-block: 2px;
      font-size: var(--font-sm);
      font-weight: 600;
      text-decoration: none;
      transition: color var(--motion-fast);
    }
    .more:hover {
      color: var(--accent-ink);
    }
    .failn {
      display: inline-grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      margin-left: 6px;
      padding: 0 6px;
      border-radius: var(--radius-pill);
      background: var(--error-bg);
      color: var(--error);
      font-size: var(--font-xs);
      font-weight: 700;
      vertical-align: 2px;
    }
    tr[data-fail] td {
      background: color-mix(in srgb, var(--error-bg) 55%, transparent);
    }
    .caps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-3);
    }
    inventory-panel {
      display: block;
      margin-bottom: var(--space-4);
    }
    .alerts {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .alert {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-left: 3px solid var(--alert-fg, var(--border));
      border-radius: var(--radius-md);
      background: var(--bg-elevated);
      font-size: var(--font-sm);
    }
    .alert[data-severity='error'] {
      --alert-fg: var(--error);
      background: color-mix(in srgb, var(--error-bg) 45%, var(--bg-elevated));
    }
    .alert[data-severity='warn'] {
      --alert-fg: var(--warn);
    }
    .alert[data-severity='info'] {
      --alert-fg: var(--info);
    }
    .alert__icon {
      flex-shrink: 0;
      color: var(--alert-fg, var(--fg-muted));
    }
    .alert__body {
      flex: 1;
      min-width: 0;
    }
    .alert__detail {
      display: block;
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .alert__go {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
      min-height: 24px;
      padding-block: 1px;
      font-weight: 600;
      text-decoration: none;
      white-space: nowrap;
    }
    .shortcuts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: var(--space-3);
      margin-top: var(--space-2);
    }
    .shortcut {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      color: var(--fg);
      font-size: var(--font-sm);
      font-weight: 600;
      text-decoration: none;
    }
    .shortcut:hover {
      border-color: var(--accent-ink);
    }
    .shortcut__label {
      flex: 1;
    }
  `,
})
export class DashboardPage {
  readonly store = inject(PortalStore);
  private readonly api = inject(PortalApi);
  private readonly prefs = inject(PrefsStore);

  readonly fed = new Source<FederationSnapshot>();
  readonly tasksSrc = new Source<TaskExecution[]>();
  readonly registrySrc = new Source<RegistryState>();
  readonly mcpSrc = new Source<McpServerDescriptor[]>();
  readonly hostsSrc = new Source<HostDetection[]>();
  readonly versionsSrc = new Source<VersionInfo>();
  readonly graphsSrc = new Source<GraphBundle>();
  readonly inventory = viewChild(InventoryPanel);

  readonly health = computed(() => this.store.health());
  readonly descriptor = computed(() => this.store.descriptor());
  readonly forgesRows = computed(() =>
    buildForgeRows(this.descriptor(), this.health(), this.fed.data()).slice(0, 8),
  );
  readonly recentTasks = computed(() =>
    [...(this.tasksSrc.data() ?? [])]
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 6),
  );
  readonly failures = computed(() => this.recentTasks().filter((t) => this.taskFailed(t)).length);
  readonly capsSupported = computed(
    () => this.store.capabilities().filter((c) => c.state === 'supported').length,
  );
  readonly checksOk = computed(
    () => (this.health()?.checks ?? []).filter((c) => c.state === 'PASS').length,
  );
  readonly registryCount = computed(() => registryInstallCount(this.registrySrc.data()));

  /** §8.3 — "voltar à última área": the last internal route the user
   *  visited, rendered only when it isn't this page. The label is the
   *  same nav key the sidebar renders — never a guessed name. */
  readonly lastArea = computed(() => {
    const url = this.prefs.lastRoute();
    if (!url || url === '/' || url === '/dashboard') return null;
    return { url, labelKey: routeLabelKey(url) };
  });

  private readonly opsSources = () => [
    this.fed,
    this.tasksSrc,
    this.registrySrc,
    this.mcpSrc,
    this.hostsSrc,
    this.versionsSrc,
    this.graphsSrc,
  ];

  /** Skeleton only during the first fan-out — a refresh keeps the last
   *  derived alerts visible instead of flickering. */
  readonly alertsLoading = computed(() =>
    this.opsSources().some((s) => s.loading() && !s.attempted()),
  );

  readonly alerts = computed(() =>
    buildAlerts({
      health: this.health(),
      accountEnvironment: this.store.accountEnvironment(),
      federation: this.fed.data(),
      mcpServers: this.mcpSrc.data(),
      hosts: this.hostsSrc.data(),
      tasks: this.tasksSrc.data(),
      registry: this.registrySrc.data(),
      versions: this.versionsSrc.data(),
      graphs: this.graphsSrc.data(),
    }),
  );

  readonly versionRows = computed(() =>
    buildVersionRows({
      registry: this.registrySrc.data(),
      federation: this.fed.data(),
      descriptor: this.descriptor(),
      versions: this.versionsSrc.data(),
    }),
  );

  readonly versionsLoading = computed(
    () => this.registrySrc.loading() && !this.registrySrc.attempted(),
  );
  /** Registry answered (or was attempted) AND no rows exist — the honest
   *  "nothing installed via forge-cli" empty state. */
  readonly versionsSettled = computed(
    () =>
      this.registrySrc.attempted() &&
      !this.registrySrc.loading() &&
      !this.registrySrc.error() &&
      !this.registrySrc.unavailable(),
  );

  readonly alertSources =
    '/health · /federation · /mcp/servers · /hosts · /tasks · /registry/state · /versions · /graphs';

  readonly shortcuts = [
    { id: 'hosts', route: '/hosts', icon: 'hosts', labelKey: 'nav.hosts' },
    { id: 'observe', route: '/observe', icon: 'pulse', labelKey: 'nav.observe' },
    { id: 'config', route: '/config', icon: 'key', labelKey: 'nav.config' },
    { id: 'versions', route: '/versions', icon: 'history', labelKey: 'nav.versions' },
    { id: 'mcp', route: '/mcp', icon: 'mcp', labelKey: 'nav.mcp' },
    { id: 'tasks', route: '/tasks', icon: 'tasks', labelKey: 'nav.tasks' },
  ] as const;

  readonly stamp = stamp;

  private readonly capIcons: Record<string, string> = {
    tasks: 'tasks',
    graph: 'graph',
    mcp: 'mcp',
    skills: 'skills',
    agents: 'agents',
    knowledge: 'knowledge',
    hosts: 'hosts',
    install: 'install',
    profiles: 'profiles',
    federation: 'network',
    scan: 'search',
    analyze: 'search',
    docs: 'knowledge',
    specialists: 'gem',
    delegations: 'history',
  };

  constructor() {
    void this.refreshAll();
  }

  async refreshAll(): Promise<void> {
    await Promise.allSettled([
      this.store.refreshHealth(),
      this.loadFederation(),
      this.loadTasks(),
      this.loadVersions(),
      this.loadMcp(),
      this.loadHosts(),
      this.loadGraphs(),
      this.inventory()?.loadCounts() ?? Promise.resolve(),
    ]);
  }

  async loadFederation(): Promise<void> {
    await this.fed.load(() => this.api.federation());
  }

  async loadTasks(): Promise<void> {
    await this.tasksSrc.load(() => this.api.tasks());
  }

  /** Installed versions need the registry receipts plus /versions for
   *  the verifiable "update available" signal. */
  async loadVersions(): Promise<void> {
    await Promise.allSettled([
      this.registrySrc.load(() => this.api.registryState()),
      this.versionsSrc.load(() => this.api.versions()),
    ]);
  }

  async loadMcp(): Promise<void> {
    await this.mcpSrc.load(() => this.api.mcpServers());
  }

  async loadHosts(): Promise<void> {
    await this.hostsSrc.load(() => this.api.hosts());
  }

  async loadGraphs(): Promise<void> {
    await this.graphsSrc.load(() => this.api.graphs());
  }

  taskFailed(t: TaskExecution): boolean {
    return isFailedTask(t);
  }

  taskState(t: TaskExecution): string {
    const s = (t.stage || '').toLowerCase();
    if (s === 'completed') return 'supported';
    if (['failed', 'refused', 'cancelled'].includes(s)) return 'error';
    if (['awaiting_approval', 'partial'].includes(s)) return 'warn';
    if (['running', 'planning', 'verifying', 'started', 'selected'].includes(s)) return 'info';
    return 'muted';
  }

  capIcon(id: string): string {
    return this.capIcons[id] ?? 'check';
  }
}
