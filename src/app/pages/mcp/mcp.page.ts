import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { InstallationReceipt, McpServerDescriptor, McpState } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { ToastService } from '../../shared/toast';
import { Source, stamp, toApiError } from '../explorer/forges.data';

/** Expected handshake progression — spec §4.3 capability matrix columns. */
const STAGES = [
  'CONFIGURED',
  'STARTING',
  'HANDSHAKE_VERIFIED',
  'TOOLS_DISCOVERED',
  'INVOCATION_VERIFIED',
] as const;
type Stage = (typeof STAGES)[number];

const STAGE_ORDER: Record<Stage, number> = {
  CONFIGURED: 0,
  STARTING: 1,
  HANDSHAKE_VERIFIED: 2,
  TOOLS_DISCOVERED: 3,
  INVOCATION_VERIFIED: 4,
};

/**
 * Furthest verified stage per observed state. `FAILED` / `DEGRADED` are
 * off-path terminal/alert states — the state alone cannot say which
 * stage was last verified, so the matrix marks them UNVERIFIED instead
 * of guessing.
 */
const STATE_ORDER: Record<McpState, number | null> = {
  NOT_CONFIGURED: -1,
  CONFIGURED: 0,
  STARTING: 1,
  HANDSHAKE_VERIFIED: 2,
  TOOLS_DISCOVERED: 3,
  INVOCATION_VERIFIED: 4,
  DEGRADED: null,
  FAILED: null,
};

/**
 * MCP operations center — spec §4.3. Everything rendered here comes
 * from `GET /mcp/servers` (registry state reported by the adapter) or
 * the `POST /mcp/verify` receipt (real handshake replay). Adapters do
 * not expose tool/resource/prompt listings — those surfaces render an
 * explicit UNVERIFIED marker, never an invented list. The portal only
 * performs handshake/read-only verification; tool invocation is out of
 * scope and never auto-executed.
 */
@Component({
  selector: 'page-mcp',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'mcp.title' | t" [subtitle]="'mcp.subtitle' | t">
      <button class="btn btn--primary" data-action="verify" [disabled]="busy()" (click)="verify()">
        <ui-icon name="shield-check" [size]="15" />
        {{ 'mcp.verify' | t }}
      </button>
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <!-- Safety scope — handshake/read-only verification only. -->
    <p class="safety" data-section="safety" role="note">
      <ui-icon name="shield-check" [size]="15" />
      <span>{{ 'mcp.safety' | t }}</span>
    </p>

    @if (busy() || receipt() || verifyError()) {
      <section class="card" data-section="verify" data-lift>
        <div class="sec__head">
          <div>
            <h2>{{ 'install.receipt' | t }}</h2>
            <p class="src"><code>POST /api/v1/mcp/verify</code></p>
          </div>
          @if (receipt(); as r) {
            <ui-state-badge [state]="r.status" />
          }
        </div>

        @if (busy()) {
          <p class="running" role="status" aria-live="polite">
            <ui-icon name="refresh" [size]="14" />
            {{ 'mcp.verifying' | t }}
          </p>
        }
        @if (verifyError(); as e) {
          <ui-error [error]="e" (retry)="verify()" />
        }
        @if (receipt(); as r) {
          @if (r.stage) {
            <p class="muted">
              <code>{{ r.stage }}</code>
            </p>
          }
          @if (r.detail) {
            <p>{{ r.detail }}</p>
          }
          @if (r.refusal) {
            <p class="refusal" role="alert">
              <code>{{ r.refusal }}</code>
              @if (r.unlock) {
                — {{ r.unlock }}
              }
            </p>
          }
          @if (r.actions?.length) {
            <h3 class="subhead">{{ 'federation.actions' | t }}</h3>
            <ul class="actions">
              @for (a of r.actions; track $index) {
                <li>
                  <code class="actions__status">{{ a.status }}</code>
                  <span class="muted">{{ a.kind }}</span>
                  <code class="path">{{ a.path }}</code>
                </li>
              }
            </ul>
          }
          @if (latencyMs() !== null) {
            <p class="latency">
              <span>{{ 'mcp.receipt.latency' | t }}</span>
              <strong data-latency>{{ latencyMs() }} ms</strong>
              <small class="muted">{{ 'mcp.receipt.latencyHint' | t }}</small>
            </p>
          }
        }
      </section>
    }

    <!-- Diagnostics — FAILED / DEGRADED servers surface evidence first. -->
    @if (attention().length) {
      <section class="card diag" data-section="diagnostics">
        <div class="sec__head">
          <div>
            <h2><ui-icon name="alert" [size]="15" />{{ 'mcp.diag.title' | t }}</h2>
            <p class="src">{{ 'mcp.diag.hint' | t }}</p>
          </div>
        </div>
        @for (s of attention(); track s.id) {
          <article class="diag__item" [attr.data-state]="s.state">
            <header class="diag__head">
              <code class="diag__id">{{ s.id }}</code>
              <ui-state-badge [state]="s.state" />
              <button class="btn btn--mini" data-diag-retry [disabled]="busy()" (click)="verify()">
                <ui-icon name="refresh" [size]="13" />
                {{ 'error.retry' | t }}
              </button>
            </header>
            @if (s.detail) {
              <p class="diag__detail">{{ s.detail }}</p>
            }
            @if (s.limitations?.length) {
              <ul class="limits">
                @for (l of s.limitations; track l) {
                  <li>{{ l }}</li>
                }
              </ul>
            }
          </article>
        }
      </section>
    }

    <!-- Registry — every server the adapter reports, raw fields only. -->
    <section class="card" data-section="registry">
      <div class="sec__head">
        <div>
          <h2>{{ 'mcp.servers' | t }}</h2>
          <p class="src">
            <code>GET /api/v1/mcp/servers</code>
            @if (src.loadedAt(); as ts) {
              <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
            }
          </p>
        </div>
        <button class="icon-btn" (click)="load()" [attr.aria-label]="'state.refresh' | t">
          <ui-icon name="refresh" [size]="14" />
        </button>
      </div>

      @if (src.unavailable()) {
        <div class="unv" role="note">
          <ui-state-badge state="UNVERIFIED" />
          <span>{{ 'empty.noData.hint' | t }}</span>
        </div>
      }
      @if (src.error(); as e) {
        <ui-error [error]="e" (retry)="load()" />
      }
      @if (src.loading() && !src.data()) {
        <div role="status" [attr.aria-label]="'state.loading' | t">
          <ui-skeleton kind="row" [lines]="3" />
        </div>
      }

      @if (servers().length) {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>{{ 'table.id' | t }}</th>
                <th>{{ 'skills.state' | t }}</th>
                <th>{{ 'table.host' | t }}</th>
                <th>{{ 'mcp.surface.tools' | t }}</th>
                <th>{{ 'mcp.lastVerify' | t }}</th>
                <th>{{ 'mcp.limitations' | t }}</th>
                <th>
                  <span class="sr-only">{{ 'state.viewDetails' | t }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (s of servers(); track s.id) {
                <tr [attr.data-selected]="selectedId() === s.id || null">
                  <td>
                    <div class="id">
                      <ui-icon name="mcp" [size]="15" />
                      <code>{{ s.id }}</code>
                    </div>
                  </td>
                  <td><ui-state-badge [state]="s.state" /></td>
                  <td>
                    @if (s.host) {
                      <code>{{ s.host }}</code>
                    } @else {
                      <span class="muted" data-unbound>{{ 'mcp.host.unbound' | t }}</span>
                    }
                  </td>
                  <td>
                    @if (s.tools_count !== null) {
                      {{ s.tools_count }}
                    } @else {
                      <ui-state-badge state="UNVERIFIED" />
                    }
                  </td>
                  <td>
                    @if (s.last_verify) {
                      {{ fmt(s.last_verify) }}
                    } @else {
                      <span class="muted">{{ 'mcp.never' | t }}</span>
                    }
                  </td>
                  <td>{{ s.limitations?.length ?? ('state.none' | t) }}</td>
                  <td>
                    <button
                      class="icon-btn"
                      [attr.data-inspect]="s.id"
                      [attr.aria-label]="'state.viewDetails' | t"
                      (click)="select(s)"
                    >
                      <ui-icon name="chevron-right" [size]="15" />
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (src.attempted() && !src.loading() && !src.error() && !src.unavailable()) {
        <ui-empty icon="mcp" [title]="'empty.noData' | t" [hint]="'empty.noData.hint' | t" />
      }
    </section>

    <!-- Inspector — all reported fields + the three MCP surfaces. -->
    <section class="card" data-section="inspector">
      <div class="sec__head">
        <div>
          <h2><ui-icon name="compass" [size]="15" />{{ 'mcp.inspector' | t }}</h2>
          <p class="src"><code>GET /api/v1/mcp/servers</code></p>
        </div>
        @if (selected()) {
          <button class="btn btn--mini" (click)="selectedId.set(null)">
            {{ 'state.close' | t }}
          </button>
        }
      </div>

      @if (selected(); as s) {
        <header class="insp__head">
          <h3>
            <ui-icon name="mcp" [size]="16" />
            <code>{{ s.id }}</code>
          </h3>
          <ui-state-badge [state]="s.state" />
        </header>
        <p class="explain">{{ explainKey(s.state) | t }}</p>

        <dl class="kv">
          <div>
            <dt>{{ 'table.id' | t }}</dt>
            <dd>
              <code>{{ s.id }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ 'skills.state' | t }}</dt>
            <dd>
              <ui-state-badge [state]="s.state" />
            </dd>
          </div>
          <div>
            <dt>{{ 'table.host' | t }}</dt>
            <dd>
              @if (s.host) {
                <code>{{ s.host }}</code>
              } @else {
                <span class="muted">{{ 'mcp.host.unbound' | t }}</span>
              }
            </dd>
          </div>
          <div>
            <dt>{{ 'mcp.surface.tools' | t }}</dt>
            <dd>
              @if (s.tools_count !== null) {
                {{ 'mcp.tools' | t: { count: s.tools_count } }}
              } @else {
                <ui-state-badge state="UNVERIFIED" />
              }
            </dd>
          </div>
          <div>
            <dt>{{ 'mcp.lastVerify' | t }}</dt>
            <dd>
              @if (s.last_verify) {
                {{ fmt(s.last_verify) }}
              } @else {
                <span class="muted">{{ 'mcp.never' | t }}</span>
              }
            </dd>
          </div>
          @if (s.detail) {
            <div>
              <dt>{{ 'mcp.detail' | t }}</dt>
              <dd>{{ s.detail }}</dd>
            </div>
          }
        </dl>

        @if (s.limitations?.length) {
          <h3 class="subhead">{{ 'mcp.limitations' | t }}</h3>
          <ul class="limits">
            @for (l of s.limitations; track l) {
              <li>{{ l }}</li>
            }
          </ul>
        }

        <!-- Explorers: adapters report only tools_count — listings are
             never invented; unexposed surfaces render UNVERIFIED. -->
        <div class="surfaces">
          <section class="surface" data-surface="tools">
            <h4><ui-icon name="settings" [size]="14" />{{ 'mcp.surface.tools' | t }}</h4>
            @if (s.tools_count !== null) {
              <p class="surface__value">{{ 'mcp.tools' | t: { count: s.tools_count } }}</p>
              <p class="muted">{{ 'mcp.surface.countOnly' | t }}</p>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
              <p class="muted">{{ 'mcp.surface.noTools' | t }}</p>
            }
          </section>
          <section class="surface" data-surface="resources">
            <h4><ui-icon name="folder" [size]="14" />{{ 'mcp.surface.resources' | t }}</h4>
            <ui-state-badge state="UNVERIFIED" />
            <p class="muted">{{ 'mcp.surface.notExposed' | t }}</p>
          </section>
          <section class="surface" data-surface="prompts">
            <h4><ui-icon name="terminal" [size]="14" />{{ 'mcp.surface.prompts' | t }}</h4>
            <ui-state-badge state="UNVERIFIED" />
            <p class="muted">{{ 'mcp.surface.notExposed' | t }}</p>
          </section>
        </div>
      } @else {
        <p class="muted">{{ 'mcp.selectHint' | t }}</p>
      }
    </section>

    <!-- Compatibility report — observed state vs expected progression. -->
    <section class="card" data-section="compat">
      <div class="sec__head">
        <div>
          <h2>{{ 'mcp.compat.title' | t }}</h2>
          <p class="src">{{ 'mcp.compat.hint' | t }}</p>
        </div>
      </div>

      @if (servers().length) {
        <div class="table-wrap">
          <table class="table compat">
            <thead>
              <tr>
                <th>{{ 'table.id' | t }}</th>
                <th>{{ 'skills.state' | t }}</th>
                @for (st of stages; track st) {
                  <th>{{ 'mcpState.' + st | t }}</th>
                }
                <th>{{ 'mcp.limitations' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (s of servers(); track s.id) {
                <tr>
                  <td>
                    <code>{{ s.id }}</code>
                  </td>
                  <td><ui-state-badge [state]="s.state" /></td>
                  @if (abnormal(s)) {
                    <td [attr.colspan]="stages.length" class="stage">
                      <ui-state-badge state="UNVERIFIED" />
                    </td>
                  } @else {
                    @for (st of stages; track st) {
                      <td class="stage">
                        @if (reached(s, st)) {
                          <ui-icon name="check" [size]="14" class="stage__yes" />
                          <span class="sr-only">{{ 'state.yes' | t }}</span>
                        } @else {
                          <span class="stage__no" aria-hidden="true">—</span>
                          <span class="sr-only">{{ 'state.no' | t }}</span>
                        }
                      </td>
                    }
                  }
                  <td>{{ s.limitations?.length ?? ('state.none' | t) }}</td>
                </tr>
                @if (s.limitations?.length) {
                  <tr class="lim">
                    <td [attr.colspan]="stages.length + 3">
                      <ul class="limits">
                        @for (l of s.limitations; track l) {
                          <li>{{ l }}</li>
                        }
                      </ul>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      } @else if (src.attempted() && !src.loading()) {
        <p class="muted">{{ 'state.none' | t }}</p>
      }
    </section>
  `,
  styles: `
    .safety {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-4);
      padding: var(--space-3);
      border: 1px solid color-mix(in srgb, var(--info) 40%, transparent);
      border-radius: var(--radius-md);
      background: var(--info-bg);
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
    .safety ui-icon {
      color: var(--info);
      flex: none;
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
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .sec__head h2 ui-icon {
      color: var(--accent);
    }
    .src {
      margin: 4px 0 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .subhead {
      margin: var(--space-3) 0 var(--space-2);
      font-size: var(--font-sm);
      font-weight: 650;
    }
    .muted {
      color: var(--fg-muted);
    }
    .path {
      overflow-wrap: anywhere;
    }
    .running {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
      color: var(--fg-muted);
    }
    .refusal {
      color: var(--warn);
    }
    .actions {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .actions li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
    }
    .actions__status {
      flex: none;
      font-weight: 600;
    }
    .latency {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin: var(--space-3) 0 0;
      padding-top: var(--space-3);
      border-top: 1px dashed var(--border);
    }
    .latency strong {
      font-family: var(--font-mono);
    }
    .unv {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 1px dashed color-mix(in srgb, var(--warn) 55%, transparent);
      border-radius: var(--radius-md);
      background: var(--warn-bg);
      font-size: var(--font-sm);
    }
    .diag {
      border-left: 3px solid var(--error);
    }
    .diag__item {
      padding: var(--space-3);
      border: 1px solid color-mix(in srgb, var(--error) 40%, transparent);
      border-radius: var(--radius-md);
      background: var(--error-bg);
    }
    .diag__item + .diag__item {
      margin-top: var(--space-3);
    }
    .diag__item[data-state='DEGRADED'] {
      border-color: color-mix(in srgb, var(--warn) 55%, transparent);
      background: var(--warn-bg);
    }
    .diag__head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .diag__id {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .diag__detail {
      margin: var(--space-2) 0 0;
      font-size: var(--font-sm);
    }
    .limits {
      margin: var(--space-2) 0 0;
      padding-left: var(--space-5);
      display: grid;
      gap: 4px;
      font-size: var(--font-sm);
      color: var(--fg-muted);
    }
    .table-wrap {
      overflow-x: auto;
    }
    .table {
      min-width: 720px;
    }
    .id {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
    }
    .id ui-icon {
      color: var(--accent);
      flex: none;
    }
    tr[data-selected] td {
      background: var(--accent-bg);
    }
    .insp__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .insp__head h3 {
      margin: 0;
      font-size: var(--font-md);
      font-weight: 650;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-width: 0;
    }
    .insp__head h3 ui-icon {
      color: var(--accent);
    }
    .explain {
      margin: var(--space-2) 0 var(--space-3);
      color: var(--fg-muted);
      font-size: var(--font-sm);
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
    .surfaces {
      display: grid;
      gap: var(--space-3);
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      margin-top: var(--space-4);
    }
    .surface {
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--bg-hover) 40%, transparent);
    }
    .surface h4 {
      margin: 0 0 var(--space-2);
      font-size: var(--font-sm);
      font-weight: 650;
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .surface h4 ui-icon {
      color: var(--accent);
    }
    .surface p {
      margin: var(--space-2) 0 0;
      font-size: var(--font-sm);
    }
    .surface__value {
      font-weight: 650;
    }
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
    }
    .compat .stage {
      text-align: center;
      white-space: nowrap;
    }
    .stage__yes {
      color: var(--ok);
    }
    .stage__no {
      color: var(--fg-muted);
    }
    tr.lim td {
      padding-top: 0;
      border-top: 0;
      background: color-mix(in srgb, var(--bg-hover) 40%, transparent);
    }
    tr.lim .limits {
      margin-top: 0;
    }
  `,
})
export class McpPage {
  private readonly api = inject(PortalApi);
  private readonly toast = inject(ToastService);

  /** Registry slice — 404 → unavailable (UNVERIFIED), other → error. */
  readonly src = new Source<McpServerDescriptor[]>();
  readonly servers = computed(() => this.src.data() ?? []);
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(
    () => this.servers().find((s) => s.id === this.selectedId()) ?? null,
  );
  /** Servers needing attention — diagnostics never hide them. */
  readonly attention = computed(() =>
    this.servers().filter((s) => s.state === 'FAILED' || s.state === 'DEGRADED'),
  );

  readonly receipt = signal<InstallationReceipt | null>(null);
  /** Portal-measured HTTP round-trip — not MCP protocol latency. */
  readonly latencyMs = signal<number | null>(null);
  readonly verifyError = signal<ApiError | null>(null);
  readonly busy = signal(false);

  readonly stages = STAGES;
  readonly stamp = stamp;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    await this.src.load(() => this.api.mcpServers());
  }

  select(s: McpServerDescriptor): void {
    this.selectedId.set(s.id);
  }

  /** i18n key of the per-state explanation shown in the inspector. */
  explainKey(state: McpState): string {
    return `mcp.explain.${state}`;
  }

  /** FAILED / DEGRADED — the state cannot say which stage was reached. */
  abnormal(s: McpServerDescriptor): boolean {
    return STATE_ORDER[s.state] === null;
  }

  /** Whether the observed state has passed the given matrix stage. */
  reached(s: McpServerDescriptor, stage: Stage): boolean {
    const idx = STATE_ORDER[s.state];
    return idx !== null && idx >= STAGE_ORDER[stage];
  }

  /** Localized date+time; falls back to the raw value — still real data. */
  fmt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  /**
   * Read-only handshake verification — `POST /mcp/verify` replays the
   * handshake server-side (confirm handled there). The latency shown is
   * the portal's own HTTP round-trip measurement, honestly labelled.
   */
  async verify(): Promise<void> {
    this.busy.set(true);
    this.verifyError.set(null);
    this.receipt.set(null);
    this.latencyMs.set(null);
    const t0 = performance.now();
    try {
      const r = await firstValueFrom(this.api.mcpVerify());
      this.latencyMs.set(Math.max(0, Math.round(performance.now() - t0)));
      this.receipt.set(r);
      this.toast.show('notify.success', 'success');
      await this.load();
    } catch (err) {
      this.verifyError.set(toApiError(err));
      this.toast.show('notify.error', 'error');
    } finally {
      this.busy.set(false);
    }
  }
}
