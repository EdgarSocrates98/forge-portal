import { Component, computed, inject, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { FederationSnapshot, TaskExecution } from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, buildForgeRows, stamp } from '../explorer/forges.data';
import { InventoryPanel } from '../explorer/inventory-panel';

/**
 * Dashboard 360° — one honest section per data source. Each section
 * carries its endpoint label, a refresh control and the timestamp of
 * the last real answer; a failed source degrades only its own section
 * (UNVERIFIED / error panel) while the rest keep rendering real data.
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
    <ui-page-header [title]="'dashboard.title' | t" [subtitle]="'dashboard.subtitle' | t">
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
          <div class="stat" [style.--stat-rail]="'var(--fg-muted)'">
            <span class="stat__value">{{ descriptor()?.portal_version ?? '—' }}</span>
            <span class="stat__label">{{ 'dashboard.stat.portal' | t }}</span>
          </div>
        </div>
        <p class="src">
          <code>bootstrap · GET /api/v1/installation/status</code>
          @if (store.refreshedAt(); as ts) {
            <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
          }
        </p>
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
                  <th>{{ 'table.id' | t }}</th>
                  <th>{{ 'skills.state' | t }}</th>
                  <th>{{ 'explorer.checkout' | t }}</th>
                  <th>{{ 'mcp.title' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of forgesRows(); track row.id) {
                  <tr [attr.data-serving]="row.serving || null">
                    <td>
                      <a class="link" [routerLink]="['/forges', row.id]">{{
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
                  <th>{{ 'table.task' | t }}</th>
                  <th>{{ 'table.verb' | t }}</th>
                  <th>{{ 'table.stage' | t }}</th>
                  <th>{{ 'table.exit' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (task of recentTasks(); track task.id) {
                  <tr [attr.data-fail]="taskFailed(task) || null">
                    <td>{{ task.label }}</td>
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
      color: var(--accent-strong);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .fed {
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent);
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
    .chip {
      margin-left: 6px;
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .more {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: var(--space-3);
      font-size: var(--font-sm);
      font-weight: 600;
      text-decoration: none;
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
  `,
})
export class DashboardPage {
  readonly store = inject(PortalStore);
  private readonly api = inject(PortalApi);

  readonly fed = new Source<FederationSnapshot>();
  readonly tasksSrc = new Source<TaskExecution[]>();
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
  };

  constructor() {
    void this.refreshAll();
  }

  async refreshAll(): Promise<void> {
    await Promise.allSettled([
      this.store.refreshHealth(),
      this.loadFederation(),
      this.loadTasks(),
      this.inventory()?.loadCounts() ?? Promise.resolve(),
    ]);
  }

  async loadFederation(): Promise<void> {
    await this.fed.load(() => this.api.federation());
  }

  async loadTasks(): Promise<void> {
    await this.tasksSrc.load(() => this.api.tasks());
  }

  taskFailed(t: TaskExecution): boolean {
    const stage = (t.stage || '').toLowerCase();
    if (['failed', 'refused', 'cancelled'].includes(stage)) return true;
    return t.exit_code !== null && t.exit_code !== 0;
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
