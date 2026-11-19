import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import {
  FederationSnapshot,
  HealthCheck,
  HostDetection,
  PortalHealth,
  RegistryState,
  VersionInfo,
  WorkspaceResources,
} from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { StateBadge } from '../../shared/state-badge';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, stamp } from '../explorer/forges.data';

/**
 * Workspace Overview (cycle 16.1 §11.1) — every row is sourced from a
 * real endpoint the page labels; a source that never answered renders
 * UNVERIFIED, never a guessed value.
 *
 *  name/root          bootstrap descriptor + /health.workspace
 *  repositories       GET /api/v1/resources → members[] (marker-based)
 *  technologies       the declared member markers verbatim — no
 *                     detection engine runs here, so nothing is inferred
 *  hosts              GET /api/v1/hosts (detected/total)
 *  specialists        GET /api/v1/federation (catalog/installed)
 *  capabilities       bootstrap capabilities (supported/total)
 *  profile            /health.profile — the recorded install profile
 *  gateway            no adapter surface reports it → UNVERIFIED
 *  state              /health.state + lifecycle block when forwarded
 *  conflicts          doctor checks reporting conflicts (drift:* /
 *                     cross-forge-*) — absent check ≠ no conflict
 *  drift              /health.checks drift:* rows + drift block when
 *                     the adapter forwards one
 *  last install       registry receipts installedAt · /versions
 *                     history · forge_portal.installed_at — newest
 *                     observed stamp wins, source labeled
 *  last verification  /health.updated_at (the status checked_at)
 */
@Component({
  selector: 'workspace-panel',
  standalone: true,
  imports: [RouterLink, TPipe, StateBadge, UiIcon, UiSkeleton],
  template: `
    <section class="card ws" data-section="workspace" [attr.aria-label]="'ws.title' | t">
      <div class="sec__head">
        <div>
          <h2>{{ 'ws.title' | t }}</h2>
          <p class="src">
            <code
              >bootstrap · GET /api/v1/installation/status · GET /api/v1/resources · GET
              /api/v1/hosts · GET /api/v1/federation · GET /api/v1/registry/state · GET
              /api/v1/versions</code
            >
            @if (res.loadedAt(); as ts) {
              <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
            }
          </p>
        </div>
        <button class="icon-btn" (click)="load()" [attr.aria-label]="'state.refresh' | t">
          <ui-icon name="refresh" [size]="14" />
        </button>
      </div>

      @if (res.loading() && !res.data()) {
        <div role="status"><ui-skeleton kind="row" [lines]="2" /></div>
      }

      <dl class="ws__grid">
        <div class="ws__row">
          <dt>{{ 'ws.name' | t }}</dt>
          <dd>{{ store.workspace()?.name ?? ('state.absent' | t) }}</dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.root' | t }}</dt>
          <dd>
            @if (root(); as r) {
              <code class="path" [attr.title]="r">{{ r }}</code>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.repos' | t }}</dt>
          <dd>
            @if (members() !== null) {
              <a class="linklike" routerLink="/resources">{{ members()!.length }}</a>
              <span class="muted">{{ memberNames() }}</span>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.technologies' | t }}</dt>
          <dd>
            @if (markers().length) {
              <code>{{ markers().join(', ') }}</code>
              <small class="muted">{{ 'ws.technologies.hint' | t }}</small>
            } @else if (res.data()) {
              <span class="muted">{{ 'state.none' | t }}</span>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.hosts' | t }}</dt>
          <dd>
            @if (hosts(); as hs) {
              <a class="linklike" routerLink="/hosts">{{ detectedHosts(hs) }}/{{ hs.length }}</a>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.specialists' | t }}</dt>
          <dd>
            @if (federation(); as snap) {
              <a class="linklike" routerLink="/federation"
                >{{ snap.summary.installed }}/{{ snap.summary.catalog }}</a
              >
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.capabilities' | t }}</dt>
          <dd>{{ capsSupported() }}/{{ store.capabilities().length }}</dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'dashboard.profile' | t }}</dt>
          <dd>
            @if (health()?.profile; as p) {
              <code>{{ p }}</code>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.gateway' | t }}</dt>
          <dd>
            @if (health()?.context?.profile; as gp) {
              <code>{{ gp }}</code>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
              <small class="muted">{{ 'ws.gateway.hint' | t }}</small>
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.state' | t }}</dt>
          <dd class="ws__states">
            <ui-state-badge [state]="health()?.state ?? 'UNVERIFIED'" />
            @if (health()?.lifecycle; as lc) {
              <ui-state-badge [state]="lc.state" />
              @if (lc.detail) {
                <small class="muted">{{ lc.detail }}</small>
              }
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.drift' | t }}</dt>
          <dd>
            @if (driftChecks() !== null) {
              @if (driftChecks()!.length) {
                <ui-state-badge state="DEGRADED" />
                <span class="muted">{{ driftChecks()!.length }}</span>
              } @else {
                <span class="muted">{{ 'ws.drift.none' | t }}</span>
              }
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.conflicts' | t }}</dt>
          <dd>
            @if (conflictChecks() !== null) {
              @if (conflictChecks()!.length) {
                <ui-state-badge state="PARTIAL" />
                <span class="muted">{{ conflictChecks()!.length }}</span>
              } @else {
                <span class="muted">{{ 'ws.conflicts.none' | t }}</span>
              }
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.lastInstall' | t }}</dt>
          <dd>
            @if (lastInstall(); as li) {
              <code>{{ stamp(li.at) }}</code>
              <small class="muted">{{ li.source }}</small>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
        <div class="ws__row">
          <dt>{{ 'ws.lastVerification' | t }}</dt>
          <dd>
            @if (health()?.updated_at; as ts) {
              <code>{{ stamp(ts) }}</code>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
          </dd>
        </div>
      </dl>
    </section>
  `,
  styles: `
    .ws {
      margin-bottom: var(--space-4);
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
    .src {
      margin: 4px 0 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .muted {
      color: var(--fg-muted);
    }
    .ws__grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: var(--space-2) var(--space-4);
      margin: var(--space-3) 0 0;
    }
    .ws__row {
      display: grid;
      gap: 2px;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--bg-hover) 35%, transparent);
      min-width: 0;
    }
    .ws__row dt {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .ws__row dd {
      margin: 0;
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 4px 8px;
      min-width: 0;
      font-size: var(--font-sm);
    }
    .ws__states {
      align-items: center;
    }
    .path {
      max-width: 42ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: inline-block;
      vertical-align: bottom;
    }
  `,
})
export class WorkspacePanel {
  readonly store = inject(PortalStore);
  private readonly api = inject(PortalApi);

  /** Live data owned by sibling dashboard sections — passed down so the
   *  panel never double-fetches. */
  readonly health = input<PortalHealth | null>(null);
  readonly federation = input<FederationSnapshot | null>(null);
  readonly hosts = input<HostDetection[] | null>(null);
  readonly registry = input<RegistryState | null>(null);
  readonly versions = input<VersionInfo | null>(null);

  /** The one source the panel owns: workspace members + catalog errors. */
  readonly res = new Source<WorkspaceResources>();

  readonly stamp = stamp;

  readonly root = computed(() => this.store.workspace()?.root ?? this.health()?.workspace ?? null);
  readonly members = computed(() => this.res.data()?.members ?? null);
  readonly memberNames = computed(() =>
    (this.members() ?? [])
      .slice(0, 6)
      .map((m) => m.path)
      .join(', '),
  );
  /** Declared member markers, deduped — verbatim evidence, not a
   *  technology inference. */
  readonly markers = computed(() => {
    const set = new Set<string>();
    for (const m of this.members() ?? []) for (const mk of m.markers) set.add(mk);
    return [...set].sort();
  });
  readonly capsSupported = computed(
    () => this.store.capabilities().filter((c) => c.state === 'supported').length,
  );

  /** Doctor checks named `drift:*` — real drift rows when the adapter
   *  reports them; `null` = health never answered → UNVERIFIED. */
  readonly driftChecks = computed<HealthCheck[] | null>(() => {
    const h = this.health();
    if (!h) return null;
    const rows = h.checks.filter((c) => c.id.startsWith('drift:') && c.state !== 'PASS');
    const drift = h.drift;
    if (drift) {
      const bad =
        (drift.modified?.length ?? 0) + (drift.missing?.length ?? 0) + (drift.unsafe?.length ?? 0);
      if (!rows.length && bad) return new Array(bad).fill({ id: 'drift', state: 'FAIL' });
    }
    return rows;
  });

  /** Doctor checks reporting conflicts — id carries 'conflict'. */
  readonly conflictChecks = computed<HealthCheck[] | null>(() => {
    const h = this.health();
    if (!h) return null;
    return h.checks.filter((c) => c.id.toLowerCase().includes('conflict') && c.state !== 'PASS');
  });

  /** Newest observed install stamp across the three real sources —
   *  each candidate carries its origin label. */
  readonly lastInstall = computed<{ at: string; source: string } | null>(() => {
    const c: { at: string; source: string }[] = [];
    for (const rec of Object.values(this.registry()?.forges ?? {})) {
      if (rec.installedAt) c.push({ at: rec.installedAt, source: 'registry' });
    }
    for (const h of this.versions()?.history ?? []) {
      if (h.at) c.push({ at: h.at, source: 'receipt' });
    }
    const fpAt = this.health()?.forge_portal?.installed_at;
    if (fpAt) c.push({ at: fpAt, source: 'forge-portal' });
    c.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return c[0] ?? null;
  });

  detectedHosts(hs: HostDetection[]): number {
    return hs.filter((h) => h.detected).length;
  }

  async load(): Promise<void> {
    await this.res.load(() => this.api.workspaceResources());
  }

  constructor() {
    void this.load();
  }
}
