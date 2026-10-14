import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { FederationSnapshot, FederationSpecialist } from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, specialistVersion, stamp } from './forges.data';
import { InventoryPanel } from './inventory-panel';

type DetailView =
  | { kind: 'serving' }
  | { kind: 'specialist'; specialist: FederationSpecialist }
  | { kind: 'registry' }
  | { kind: 'missing' }
  | { kind: 'pending' };

/**
 * Per-Forja detail (/forges/:id). `self` or the serving forge_id shows
 * the bootstrap/health truth plus live catalog counts; any other id is
 * resolved against the federation snapshot. Every absent field renders
 * an explicit UNVERIFIED / absent marker — never a fabricated value.
 */
@Component({
  selector: 'page-forge-detail',
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
    <a class="back" routerLink="/forges">
      <ui-icon name="chevron-left" [size]="14" />{{ 'explorer.back' | t }}
    </a>
    <ui-page-header [title]="title()" [subtitle]="'explorer.detail.subtitle' | t">
      <button class="btn" (click)="reload()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (view().kind === 'serving') {
      <section class="card" data-section="identity">
        <div class="sec__head">
          <div>
            <h2>{{ 'explorer.identity' | t }}</h2>
            <p class="src"><code>bootstrap</code></p>
          </div>
        </div>
        @if (descriptor(); as d) {
          <dl class="kv">
            <div>
              <dt>{{ 'settings.forge' | t }}</dt>
              <dd>
                {{ d.forge_name }} <code>({{ d.forge_id }})</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'settings.cli' | t }}</dt>
              <dd>
                <code>{{ d.cli }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'settings.version' | t }}</dt>
              <dd>{{ d.forge_version }}</dd>
            </div>
            <div>
              <dt>{{ 'settings.portalVersion' | t }}</dt>
              <dd>{{ d.portal_version }}</dd>
            </div>
            <div>
              <dt>{{ 'settings.federated' | t }}</dt>
              <dd>{{ (d.federated ? 'state.yes' : 'state.no') | t }}</dd>
            </div>
            <div>
              <dt>{{ 'dashboard.workspace' | t }}</dt>
              <dd class="path">{{ d.workspace?.root ?? ('dashboard.noWorkspace' | t) }}</dd>
            </div>
          </dl>
        } @else {
          <div class="unv" role="note">
            <ui-state-badge state="UNVERIFIED" />
            <span>{{ 'empty.noData.hint' | t }}</span>
          </div>
        }
      </section>

      <section class="card" data-section="health">
        <div class="sec__head">
          <div>
            <h2>{{ 'dashboard.health' | t }}</h2>
            <p class="src">
              <code>GET /api/v1/installation/status</code>
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
        @if (health(); as h) {
          <p class="meta">
            <ui-state-badge [state]="h.state || 'UNVERIFIED'" />
            <span class="muted"
              >{{ 'dashboard.profile' | t }}: {{ h.profile ?? ('state.none' | t) }}</span
            >
            @if (h.updated_at) {
              <span class="muted">{{ h.updated_at }}</span>
            }
          </p>
          @if (h.checks.length) {
            <ul class="checks">
              @for (c of h.checks; track c.id) {
                <li>
                  <ui-state-badge [state]="c.state || 'UNVERIFIED'" [labelOverride]="c.id" />
                  @if (c.detail) {
                    <small class="muted">{{ c.detail }}</small>
                  }
                </li>
              }
            </ul>
          }
        } @else {
          <div class="unv" role="note">
            <ui-state-badge state="UNVERIFIED" />
            <span>{{ 'empty.noData.hint' | t }}</span>
          </div>
        }
      </section>

      <section class="card" data-section="capabilities">
        <div class="sec__head">
          <div>
            <h2>{{ 'dashboard.capabilities' | t }}</h2>
            <p class="src"><code>bootstrap</code></p>
          </div>
        </div>
        @if (store.capabilities().length) {
          <div class="caps">
            @for (cap of store.capabilities(); track cap.id) {
              <span class="cap" [attr.data-state]="cap.state" [attr.title]="cap.state">
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
    }

    @if (specialist(); as s) {
      <section class="card" data-section="identity">
        <div class="sec__head">
          <div>
            <h2>{{ 'explorer.identity' | t }}</h2>
            <p class="src">
              <code>GET /api/v1/federation</code>
              @if (fed.loadedAt(); as ts) {
                <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
              }
            </p>
          </div>
          <button
            class="icon-btn"
            (click)="loadSpecialists()"
            [attr.aria-label]="'state.refresh' | t"
          >
            <ui-icon name="refresh" [size]="14" />
          </button>
        </div>
        <dl class="kv">
          <div>
            <dt>{{ 'table.id' | t }}</dt>
            <dd>
              <code>{{ s.provider }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ 'skills.state' | t }}</dt>
            <dd><ui-state-badge [state]="s.state ?? s.status ?? 'UNVERIFIED'" /></dd>
          </div>
          <div>
            <dt>{{ 'settings.version' | t }}</dt>
            <dd>{{ specialistVersion(s) ?? '—' }}</dd>
          </div>
          <div>
            <dt>{{ 'settings.cli' | t }}</dt>
            <dd>
              @if (s.cli) {
                <code>{{ s.cli }}</code>
              } @else {
                <ui-state-badge state="UNVERIFIED" />
              }
            </dd>
          </div>
        </dl>
      </section>

      <section class="card" data-section="presence">
        <div class="sec__head">
          <div>
            <h2>{{ 'explorer.presence' | t }}</h2>
            <p class="src"><code>GET /api/v1/federation</code></p>
          </div>
        </div>
        <dl class="kv">
          <div>
            <dt>{{ 'explorer.checkout' | t }}</dt>
            <dd>
              @if (s.checkout === undefined) {
                <ui-state-badge state="UNVERIFIED" />
              } @else if (s.checkout === null) {
                <span class="muted">{{ 'state.absent' | t }}</span>
              } @else {
                <code class="path" [attr.title]="s.checkout">{{ s.checkout }}</code>
              }
            </dd>
          </div>
          <div>
            <dt>{{ 'mcp.title' | t }}</dt>
            <dd>
              @if (s.mcp === undefined) {
                <ui-state-badge state="UNVERIFIED" />
              } @else if (s.mcp === null) {
                <span class="muted">{{ 'federation.mcpAbsent' | t }}</span>
              } @else {
                <span class="muted">{{ 'federation.mcpReady' | t }}</span>
                <span class="mcp-keys">
                  @for (k of mcpKeys(s.mcp); track k) {
                    <code>{{ k }}</code>
                  }
                </span>
              }
            </dd>
          </div>
        </dl>
      </section>

      <section class="card" data-section="checks">
        <div class="sec__head">
          <div>
            <h2>{{ 'fdoc.checks' | t }}</h2>
            <p class="src"><code>GET /api/v1/federation</code></p>
          </div>
        </div>
        @if (s.checks === undefined) {
          <div class="unv" role="note"><ui-state-badge state="UNVERIFIED" /></div>
        } @else if (!s.checks.length) {
          <p class="muted">{{ 'state.none' | t }}</p>
        } @else {
          <ul class="checks">
            @for (c of s.checks; track c.id) {
              <li>
                <ui-state-badge [state]="c.status || 'UNVERIFIED'" [labelOverride]="c.id" />
                @if (c.detail) {
                  <small class="muted">{{ c.detail }}</small>
                }
              </li>
            }
          </ul>
        }
      </section>

      <section class="card" data-section="notes">
        <div class="sec__head">
          <div>
            <h2>{{ 'explorer.notes' | t }}</h2>
            <p class="src"><code>GET /api/v1/federation</code></p>
          </div>
        </div>
        @if (s.notes === undefined) {
          <div class="unv" role="note"><ui-state-badge state="UNVERIFIED" /></div>
        } @else if (!s.notes.length) {
          <p class="muted">{{ 'state.none' | t }}</p>
        } @else {
          <ul class="notes">
            @for (n of s.notes; track n) {
              <li>{{ n }}</li>
            }
          </ul>
        }
      </section>
    }

    @if (view().kind === 'registry') {
      <section class="card" data-section="identity">
        <div class="sec__head">
          <div>
            <h2>{{ 'explorer.identity' | t }}</h2>
            <p class="src"><code>GET /api/v1/federation</code></p>
          </div>
        </div>
        <div class="unv" role="note">
          <ui-state-badge state="UNVERIFIED" />
          <span>{{ 'explorer.registryOnly' | t }}</span>
        </div>
        <dl class="kv">
          <div>
            <dt>{{ 'table.id' | t }}</dt>
            <dd>
              <code>{{ id() }}</code>
            </dd>
          </div>
        </dl>
      </section>
    }

    @if (view().kind === 'missing') {
      <ui-empty icon="search" [title]="'explorer.notFound' | t" />
    }

    @if (view().kind === 'pending') {
      @if (fed.unavailable()) {
        <section class="card">
          <div class="unv" role="note">
            <ui-state-badge state="UNVERIFIED" />
            <span>{{ 'federation.unavailable' | t }}</span>
          </div>
          <dl class="kv">
            <div>
              <dt>{{ 'table.id' | t }}</dt>
              <dd>
                <code>{{ id() }}</code>
              </dd>
            </div>
          </dl>
        </section>
      } @else if (fed.error(); as e) {
        <ui-error [error]="e" (retry)="loadSpecialists()" />
      } @else {
        <div role="status" [attr.aria-label]="'state.loading' | t">
          <ui-skeleton kind="card" />
          <ui-skeleton kind="row" [lines]="4" />
        </div>
      }
    }
  `,
  styles: `
    .back {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-bottom: var(--space-3);
      font-size: var(--font-sm);
      font-weight: 600;
      color: var(--fg-muted);
      text-decoration: none;
    }
    .back:hover {
      color: var(--fg);
    }
    .card {
      margin-bottom: var(--space-4);
    }
    .sec__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .sec__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .src {
      margin: 4px 0 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
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
    }
    .kv dd {
      margin: 0;
      min-width: 0;
    }
    .meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .checks,
    .notes {
      list-style: none;
      margin: var(--space-2) 0 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .checks li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
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
    .caps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .mcp-keys {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-left: 6px;
    }
    .muted {
      color: var(--fg-muted);
    }
    .path {
      display: inline-block;
      max-width: 60ch;
      overflow-wrap: anywhere;
    }
    inventory-panel {
      display: block;
      margin-bottom: var(--space-4);
    }
  `,
})
export class ForgeDetailPage {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(PortalApi);
  readonly store = inject(PortalStore);

  readonly id = signal('self');
  readonly fed = new Source<FederationSnapshot>();
  readonly inventory = viewChild(InventoryPanel);

  readonly health = computed(() => this.store.health());
  readonly descriptor = computed(() => this.store.descriptor());
  readonly view = computed<DetailView>(() => {
    const id = this.id();
    const d = this.descriptor();
    if (id === 'self' || (d !== null && id === d.forge_id)) return { kind: 'serving' };
    const snap = this.fed.data();
    if (!snap) return { kind: 'pending' };
    const s = snap.specialists.find((x) => x.provider === id);
    if (s) return { kind: 'specialist', specialist: s };
    if (snap.installed_forges.includes(id)) return { kind: 'registry' };
    return { kind: 'missing' };
  });
  readonly specialist = computed(() => {
    const v = this.view();
    return v.kind === 'specialist' ? v.specialist : null;
  });
  readonly title = computed(() =>
    this.view().kind === 'serving' ? (this.descriptor()?.forge_name ?? this.id()) : this.id(),
  );

  readonly specialistVersion = specialistVersion;
  readonly stamp = stamp;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const id = params.get('id') ?? 'self';
      this.id.set(id);
      if (id !== 'self' && id !== this.store.descriptor()?.forge_id) {
        void this.loadSpecialists();
      }
    });
  }

  async loadSpecialists(): Promise<void> {
    await this.fed.load(() => this.api.federation());
  }

  async reload(): Promise<void> {
    if (this.view().kind === 'serving') {
      await Promise.allSettled([
        this.store.refreshHealth(),
        this.inventory()?.loadCounts() ?? Promise.resolve(),
      ]);
    } else {
      await this.loadSpecialists();
    }
  }

  mcpKeys(mcp: Record<string, unknown>): string[] {
    return Object.keys(mcp);
  }
}
