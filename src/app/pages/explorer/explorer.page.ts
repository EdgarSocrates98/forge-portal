import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { FederationSnapshot } from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, buildForgeRows, stamp } from './forges.data';

/**
 * Forja explorer — every Forja the workspace can verify: the Forja
 * serving this portal (bootstrap) plus the federation specialists
 * (GET /api/v1/federation). When the registry op does not exist on this
 * Forja the page still renders the serving row and marks everything
 * else UNVERIFIED — nothing is hidden, nothing is invented.
 */
@Component({
  selector: 'page-explorer',
  standalone: true,
  imports: [RouterLink, TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'explorer.title' | t" [subtitle]="'explorer.subtitle' | t">
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <section class="card" data-section="forges">
      <p class="src">
        <code>bootstrap · GET /api/v1/federation</code>
        @if (fed.loadedAt(); as ts) {
          <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
        }
      </p>

      @if (fed.data(); as snap) {
        <p class="sum">
          <span>{{ 'federation.catalog' | t }}: {{ snap.summary.catalog }}</span>
          <span>{{ 'federation.installed' | t }}: {{ snap.summary.installed }}</span>
          <span>{{ 'federation.mcp' | t }}: {{ snap.summary.with_mcp }}</span>
          <span>{{ 'federation.checkouts' | t }}: {{ snap.summary.with_checkout }}</span>
        </p>
      }

      @if (fed.unavailable()) {
        <div class="unv" role="note">
          <ui-state-badge state="UNVERIFIED" />
          <span>{{ 'federation.unavailable' | t }}</span>
        </div>
      }
      @if (fed.error(); as e) {
        <ui-error [error]="e" (retry)="load()" />
      }
      @if (fed.loading() && !fed.data()) {
        <div role="status" [attr.aria-label]="'state.loading' | t">
          <ui-skeleton kind="row" [lines]="4" />
        </div>
      }

      @if (rows().length) {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'table.id' | t }}</th>
                <th scope="col">{{ 'skills.state' | t }}</th>
                <th scope="col">{{ 'settings.version' | t }}</th>
                <th scope="col">{{ 'explorer.checkout' | t }}</th>
                <th scope="col">{{ 'mcp.title' | t }}</th>
                <th scope="col">
                  <span class="sr-only">{{ 'state.viewDetails' | t }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.id) {
                <tr [attr.data-serving]="row.serving || null">
                  <td>
                    <div class="id">
                      @if (row.serving) {
                        <ui-icon name="gem" [size]="15" />
                      }
                      <div class="id__text">
                        <strong>{{ row.name ?? row.id }}</strong>
                        <code class="id__slug">{{ row.id }}</code>
                      </div>
                      @if (row.serving) {
                        <span class="chip">{{ 'explorer.serving' | t }}</span>
                      }
                      @if (row.registryOnly) {
                        <span class="chip chip--mut">{{ 'explorer.registryOnly' | t }}</span>
                      }
                    </div>
                  </td>
                  <td><ui-state-badge [state]="row.state ?? 'UNVERIFIED'" /></td>
                  <td>{{ row.version ?? '—' }}</td>
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
                  <td>
                    <a
                      class="icon-btn"
                      [routerLink]="['/forges', row.id]"
                      [attr.aria-label]="'state.viewDetails' | t"
                    >
                      <ui-icon name="chevron-right" [size]="15" />
                    </a>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (fed.attempted() && !fed.loading() && !fed.error() && !fed.unavailable()) {
        <ui-empty icon="network" [title]="'explorer.empty' | t" />
      }
    </section>
  `,
  styles: `
    .card {
      padding: var(--space-3);
    }
    .src {
      margin: 0 0 var(--space-2);
      padding: 0 var(--space-2);
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .sum {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      margin: 0 0 var(--space-3);
      padding: 0 var(--space-2);
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .unv {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      margin: 0 var(--space-2) var(--space-3);
      border: 1px dashed color-mix(in srgb, var(--warn) 55%, transparent);
      border-radius: var(--radius-md);
      background: var(--warn-bg);
      font-size: var(--font-sm);
    }
    .table-wrap {
      overflow-x: auto;
    }
    .table {
      min-width: 640px;
    }
    .id {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
    }
    .id ui-icon {
      color: var(--accent-ink);
      flex: none;
    }
    .id__text {
      display: grid;
      min-width: 0;
    }
    .id__slug {
      color: var(--fg-muted);
      font-size: var(--font-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chip {
      flex: none;
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent-ink);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .chip--mut {
      color: var(--fg-muted);
      background: var(--bg-hover);
    }
    .muted {
      color: var(--fg-muted);
    }
    .path {
      display: inline-block;
      max-width: 38ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      vertical-align: bottom;
    }
  `,
})
export class ExplorerPage {
  private readonly api = inject(PortalApi);
  readonly store = inject(PortalStore);
  readonly fed = new Source<FederationSnapshot>();
  readonly rows = computed(() =>
    buildForgeRows(this.store.descriptor(), this.store.health(), this.fed.data()),
  );
  readonly stamp = stamp;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    await Promise.allSettled([
      this.store.refreshHealth(),
      this.fed.load(() => this.api.federation()),
    ]);
  }
}
