import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { HostDetection, HostLifecycleState } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { ToastService } from '../../shared/toast';
import { Source, stamp } from '../explorer/forges.data';

/**
 * Host Integration Center (spec §4.1) — the host probe exactly as the
 * adapter reports it, plus the only real ops it exposes:
 *
 * - INVENTORY: one card per host with presence, version, supported,
 *   tri-state auth (`logged_in === null` renders UNVERIFIED — auth is
 *   never inferred from detection), lifecycle badge, launchable, detail
 *   and command_hint, plus a computed summary strip.
 * - LIFECYCLE: a mini stepper mapping HostLifecycleState onto the seven
 *   ordered stages detect→install→configure→mcp→handshake→tools→exec.
 *   FAILED/BLOCKED render as terminal markers — never as a stage claim,
 *   because the probe does not say where it stopped. Unknown adapter
 *   strings map to "no position reached" (all todo).
 * - REQUEST INTEGRATION: POST /hosts/launch returns the command for the
 *   user's own terminal (or a refusal) — the portal never launches.
 * - VERIFY: refresh re-probes /hosts and records the real transition a
 *   host made, with a per-host checked timestamp.
 * - PLAN/FIX/DISABLE: the adapter exposes none of these — they render
 *   once as honest UNVERIFIED capabilities, never as buttons.
 */

/** Ordered lifecycle stages — the label of each stage is the state that
 *  satisfies it, so `hostState.*` keys double as stage labels. */
const STAGES = [
  { id: 'detect', state: 'DETECTED' },
  { id: 'install', state: 'INSTALLED' },
  { id: 'configure', state: 'CONFIGURED' },
  { id: 'mcp', state: 'MCP_REGISTERED' },
  { id: 'handshake', state: 'HANDSHAKE_VERIFIED' },
  { id: 'tools', state: 'TOOLS_DISCOVERED' },
  { id: 'exec', state: 'EXECUTION_VERIFIED' },
] as const;

const STAGE_INDEX: Record<string, number> = {
  DETECTED: 0,
  INSTALLED: 1,
  CONFIGURED: 2,
  MCP_REGISTERED: 3,
  HANDSHAKE_VERIFIED: 4,
  TOOLS_DISCOVERED: 5,
  EXECUTION_VERIFIED: 6,
};

/** States at/after INSTALLED count as "integrated" in the summary strip.
 *  NOT_DETECTED/DETECTED are pre-integration; FAILED/BLOCKED and unknown
 *  adapter strings are never counted. */
const INTEGRATED_STATES: ReadonlySet<string> = new Set([
  'INSTALLED',
  'CONFIGURED',
  'MCP_REGISTERED',
  'HANDSHAKE_VERIFIED',
  'TOOLS_DISCOVERED',
  'EXECUTION_VERIFIED',
]);

/** Result of POST /hosts/launch — the adapter never launches: it returns
 *  the command for the user's own terminal, a refusal, or nothing. */
interface LaunchOutcome {
  command: string | null;
  refusal: string | null;
  detail: string | null;
  at: string;
}

/** Per-host probe bookkeeping — lets each card show "checked at" and the
 *  real transition a refresh observed instead of pretending nothing moved. */
interface HostCheck {
  at: string;
  changed: boolean;
  from: HostLifecycleState | null;
}

@Component({
  selector: 'page-hosts',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'hosts.title' | t" [subtitle]="'hosts.subtitle' | t">
      <button class="btn" [disabled]="src.loading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (src.error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    <!-- /hosts absent on this adapter → UNVERIFIED, never a fake list -->
    @if (src.unavailable()) {
      <section class="card unverified-panel" role="note">
        <ui-state-badge state="unverified" />
        <p class="muted">{{ 'hosts.ops.unsupported' | t }}</p>
      </section>
    }

    @if (src.loading() && !hosts()) {
      <section class="grid" role="status" aria-live="polite">
        @for (i of [1, 2, 3]; track i) {
          <ui-skeleton kind="card" />
        }
      </section>
    }

    @if (hosts(); as list) {
      <!-- Summary — counts computed from the probe, nothing assumed. -->
      <section class="card summary" aria-labelledby="summary-h">
        <h2 id="summary-h">{{ 'dashboard.inventory' | t }}</h2>
        <div class="stats">
          <span class="stat">
            <strong>{{ summary().detected }}</strong>
            {{ 'hosts.detected' | t }}
          </span>
          <span class="stat">
            <strong>{{ summary().integrated }}</strong>
            {{ 'hosts.installed' | t }}
          </span>
          <span class="stat" [attr.data-warn]="summary().unknown > 0 || null">
            <strong>{{ summary().unknown }}</strong>
            {{ 'hosts.auth.unknown' | t }}
          </span>
        </div>
        @if (src.loadedAt(); as at) {
          <p class="probe muted">{{ 'common.updatedAt' | t: { time: stamp(at) } }}</p>
        }
      </section>

      <section class="grid">
        @for (h of list; track h.host) {
          <article
            class="card host"
            data-lift
            [attr.data-off]="!h.detected || null"
            [attr.data-host]="h.host"
          >
            <header class="card__head">
              <h2><ui-icon name="hosts" [size]="16" />{{ h.host }}</h2>
              <ui-state-badge [state]="h.integration" />
            </header>

            <!-- Lifecycle — current state highlighted; FAILED/BLOCKED render
                 as a terminal marker because the probe does not report the
                 stage where it stopped. -->
            <ol class="lc" [attr.aria-label]="'hosts.integration' | t" [attr.data-lc]="h.host">
              @for (s of stages; track s.id; let i = $index) {
                <li
                  [attr.data-state]="stageState(h, i)"
                  [attr.aria-current]="stageState(h, i) === 'active' ? 'step' : null"
                >
                  <span class="dot" aria-hidden="true">
                    @if (stageState(h, i) === 'done') {
                      <ui-icon name="check" [size]="11" />
                    }
                  </span>
                  {{ 'hostState.' + s.state | t }}
                </li>
              }
              @if (terminalState(h); as t) {
                <li class="terminal" [attr.data-state]="t">
                  <span class="dot" aria-hidden="true">
                    <ui-icon name="alert" [size]="11" />
                  </span>
                  {{ 'hostState.' + h.integration | t }}
                </li>
              }
            </ol>

            <dl class="kv">
              <div>
                <dt>{{ 'hosts.detected' | t }}</dt>
                <dd>{{ (h.detected ? 'state.yes' : 'state.no') | t }}</dd>
              </div>
              <div>
                <dt>{{ 'hosts.version' | t }}</dt>
                <dd>{{ h.version ?? ('state.unknown' | t) }}</dd>
              </div>
              <div>
                <dt>{{ 'hosts.supported' | t }}</dt>
                <dd>
                  <ui-state-badge [state]="h.supported ? 'supported' : 'unsupported'" />
                </dd>
              </div>
              <div>
                <dt>{{ 'hosts.auth' | t }}</dt>
                <dd>
                  @if (h.logged_in === null) {
                    <ui-state-badge state="unverified" />
                  } @else {
                    {{ authLabel(h) | t }}
                  }
                </dd>
              </div>
              <div>
                <dt>{{ 'hosts.launchable' | t }}</dt>
                <dd>{{ (h.launchable ? 'state.yes' : 'state.no') | t }}</dd>
              </div>
              @if (h.command_hint) {
                <div class="kv__cmd">
                  <dt>{{ 'hosts.commandHint' | t }}</dt>
                  <dd>
                    <code>{{ h.command_hint }}</code>
                  </dd>
                </div>
              }
            </dl>
            @if (h.detail) {
              <p class="muted">{{ h.detail }}</p>
            }

            <!-- Verification bookkeeping — the real transition this refresh
                 observed, or just the probe timestamp. -->
            @if (checks()[h.host]; as c) {
              <p class="checked">
                <ui-icon name="check" [size]="12" />
                <span>{{ 'common.updatedAt' | t: { time: stamp(c.at) } }}</span>
                @if (c.changed && c.from) {
                  <span class="transition">
                    <ui-state-badge [state]="c.from" />
                    <ui-icon name="chevron-right" [size]="12" />
                    <ui-state-badge [state]="h.integration" />
                  </span>
                }
              </p>
            }

            <div class="row">
              <button
                class="btn"
                [class.btn--primary]="h.detected"
                [disabled]="launchBusy() !== null"
                (click)="requestIntegration(h)"
              >
                <ui-icon name="terminal" [size]="14" />
                {{ 'hosts.request' | t }}
              </button>
            </div>

            <!-- Launch outcome — always a command for the user's terminal or
                 a refusal; the portal itself never launches anything. -->
            @if (launch()[h.host]; as o) {
              <div
                class="outcome"
                [attr.data-kind]="o.command ? 'command' : o.refusal ? 'refusal' : 'none'"
              >
                @if (o.command) {
                  <div class="outcome__head">
                    <p class="outcome__title">
                      <ui-icon name="terminal" [size]="13" />{{ 'hosts.launch.copyHint' | t }}
                    </p>
                    <button
                      class="btn btn--mini"
                      (click)="copyCommand(h.host, o.command)"
                      [attr.aria-label]="'state.copy' | t"
                    >
                      <ui-icon [name]="copied() === h.host ? 'check' : 'copy'" [size]="13" />
                      {{ (copied() === h.host ? 'state.copied' : 'state.copy') | t }}
                    </button>
                  </div>
                  <code class="outcome__cmd">{{ o.command }}</code>
                } @else if (o.refusal) {
                  <p class="refusal" role="alert">
                    <strong>{{ 'install.refused' | t }}</strong>
                    <code>{{ o.refusal }}</code>
                    @if (o.detail) {
                      — {{ o.detail }}
                    }
                  </p>
                } @else {
                  <p class="muted">
                    {{ 'hosts.launch.unavailable' | t }}
                    @if (o.detail) {
                      <span>— {{ o.detail }}</span>
                    }
                  </p>
                }
              </div>
            }
          </article>
        } @empty {
          @if (!src.error() && !src.loading()) {
            <ui-empty icon="hosts" [title]="'empty.noData' | t" [hint]="'empty.noData.hint' | t" />
          }
        }
      </section>

      <!-- Adapter capabilities — the adapter exposes no plan/files/fix/disable
           op for hosts, so each renders UNVERIFIED instead of a dead button. -->
      <section class="card" aria-labelledby="caps-h">
        <h2 id="caps-h">{{ 'install.ops.title' | t }}</h2>
        <ul class="capability">
          @for (cap of capabilities; track cap) {
            <li>
              <ui-state-badge state="unverified" />
              <span class="capability__body muted">
                <strong>{{ cap | t }}</strong>
                <small>{{ 'hosts.ops.unsupported' | t }}</small>
              </span>
            </li>
          }
        </ul>
      </section>
    }
  `,
  /* .muted, .refusal color, .capability/.capability__body were
     consolidated into the "shared feature styles" section of
     src/styles.css — only host-specific rules remain here. */
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    .card h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .card > h2 {
      margin-bottom: var(--space-3);
    }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .stat {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      font-size: var(--font-sm);
      color: var(--fg-muted);
    }
    .stat strong {
      color: var(--fg);
      font-size: var(--font-md);
    }
    .stat[data-warn],
    .stat[data-warn] strong {
      color: var(--warn);
    }
    .stat[data-warn] {
      border-color: color-mix(in srgb, var(--warn) 45%, transparent);
    }
    .probe {
      margin: var(--space-2) 0 0;
      font-size: var(--font-xs);
    }
    .grid {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      margin-bottom: var(--space-4);
    }
    .host[data-off] {
      /* "off" cue without opacity: an alpha < 1 blend drops badge text below
         WCAG AA (axe §1.4.3) — desaturate + dashed border instead */
      filter: grayscale(0.6);
      border-style: dashed;
    }
    .card__head,
    .outcome__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
    }
    .card__head {
      margin-bottom: var(--space-3);
    }
    .card__head h2 {
      text-transform: capitalize;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .card__head ui-icon {
      color: var(--accent-ink);
    }
    /* vertical mini stepper — one row per lifecycle stage */
    .lc {
      list-style: none;
      margin: 0 0 var(--space-3);
      padding: 0;
      display: grid;
    }
    .lc li {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: 3px 0;
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .lc li:not(:last-child)::after {
      content: '';
      position: absolute;
      left: 7px;
      top: 21px;
      bottom: -3px;
      width: 2px;
      border-radius: 1px;
      background: var(--border);
    }
    .lc .dot {
      position: relative;
      display: grid;
      place-items: center;
      width: 16px;
      height: 16px;
      flex: none;
      border-radius: 50%;
      border: 1.5px solid var(--border-strong);
      background: var(--bg-elevated);
    }
    .lc li[data-state='done'],
    .lc li[data-state='active'] {
      color: var(--fg);
    }
    .lc li[data-state='done'] .dot {
      background: var(--ok);
      border-color: var(--ok);
      color: var(--on-color);
    }
    .lc li[data-state='done']:not(:last-child)::after {
      background: var(--ok);
    }
    .lc li[data-state='active'] {
      font-weight: 650;
    }
    .lc li[data-state='active'] .dot {
      border-color: var(--accent-ink);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
    }
    .lc li[data-state='warn'],
    .lc li[data-state='error'] {
      margin-top: 2px;
      font-weight: 600;
    }
    .lc li[data-state='warn'] {
      color: var(--warn);
    }
    .lc li[data-state='error'] {
      color: var(--error);
    }
    .lc li[data-state='warn'] .dot,
    .lc li[data-state='error'] .dot {
      color: var(--on-color);
    }
    .lc li[data-state='warn'] .dot {
      background: var(--warn);
      border-color: var(--warn);
    }
    .lc li[data-state='error'] .dot {
      background: var(--error);
      border-color: var(--error);
    }
    .kv {
      display: grid;
      gap: 6px;
      margin: 0 0 var(--space-3);
    }
    .kv div {
      display: flex;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .kv dt {
      color: var(--fg-muted);
    }
    .kv dd {
      margin: 0;
    }
    .kv__cmd code,
    .outcome__cmd,
    .refusal code {
      font-family: var(--font-mono);
      font-size: var(--font-xs);
      overflow-wrap: anywhere;
    }
    .checked {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin: 0 0 var(--space-2);
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .checked ui-icon {
      color: var(--ok);
    }
    .transition {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--fg-muted);
    }
    .row {
      margin-top: var(--space-3);
    }
    .outcome {
      margin-top: var(--space-3);
      padding: var(--space-3);
      border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
      border-radius: var(--radius-md);
      background: var(--accent-bg);
      display: grid;
      gap: 4px;
    }
    .outcome[data-kind='refusal'] {
      border-color: color-mix(in srgb, var(--warn) 45%, transparent);
      background: var(--warn-bg);
    }
    .outcome__title {
      margin: 0;
      font-size: var(--font-xs);
      font-weight: 600;
      color: var(--accent-ink);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
    }
    .outcome__cmd {
      font-size: var(--font-sm);
      word-break: break-all;
    }
    .refusal {
      margin: 0;
    }
    .unverified-panel {
      display: flex;
      gap: var(--space-3);
    }
  `,
})
export class HostsPage {
  private readonly api = inject(PortalApi);
  private readonly toast = inject(ToastService);

  /** Single probe source — a 404/PORTAL-NOT-FOUND marks the panel
   *  UNVERIFIED instead of crashing or fabricating a host list. */
  readonly src = new Source<HostDetection[]>();
  readonly hosts = computed(() => this.src.data());
  readonly checks = signal<Record<string, HostCheck>>({});
  readonly launch = signal<Record<string, LaunchOutcome>>({});
  readonly launchBusy = signal<string | null>(null);
  readonly copied = signal<string | null>(null);
  readonly stages = STAGES;
  readonly capabilities = [
    'hosts.ops.plan',
    'hosts.ops.files',
    'hosts.ops.fix',
    'hosts.ops.disable',
  ] as const;

  readonly summary = computed(() => {
    const list = this.hosts() ?? [];
    return {
      detected: list.filter((h) => h.detected).length,
      integrated: list.filter((h) => INTEGRATED_STATES.has(h.integration)).length,
      /** logged_in === null means the adapter could not verify auth —
       *  counted as unknown, never as authenticated. */
      unknown: list.filter((h) => h.logged_in === null).length,
    };
  });

  constructor() {
    void this.load();
  }

  /** Probe (or re-probe) /hosts. On success each host records when it was
   *  checked and which transition — if any — the refresh observed. */
  async load(): Promise<void> {
    const prev = this.src.data() ?? [];
    await this.src.load(() => this.api.hosts());
    const next = this.src.data();
    if (!next) return;
    const at = this.src.loadedAt() ?? new Date().toISOString();
    const checks = { ...this.checks() };
    for (const h of next) {
      const before = prev.find((p) => p.host === h.host);
      const from = before && before.integration !== h.integration ? before.integration : null;
      checks[h.host] = { at, changed: from !== null, from };
    }
    this.checks.set(checks);
  }

  /** Position of `state` on the ordered lifecycle, or -1 when the probe
   *  reports a pre-state (NOT_DETECTED), a terminal failure
   *  (FAILED/BLOCKED) or an adapter string this build does not know. */
  stageIndex(state: string): number {
    return STAGE_INDEX[state] ?? -1;
  }

  stageState(h: HostDetection, i: number): 'done' | 'active' | 'todo' {
    const idx = this.stageIndex(h.integration);
    if (i < idx) return 'done';
    if (i === idx) return 'active';
    return 'todo';
  }

  /** FAILED/BLOCKED render as a terminal marker — never mapped onto a
   *  stage, because the probe does not report where the pipeline stopped. */
  terminalState(h: HostDetection): 'error' | 'warn' | null {
    if (h.integration === 'FAILED') return 'error';
    if (h.integration === 'BLOCKED') return 'warn';
    return null;
  }

  authLabel(h: HostDetection): string {
    if (h.logged_in === null) return 'hosts.auth.unknown';
    return h.logged_in ? 'hosts.auth.signedIn' : 'hosts.auth.signedOut';
  }

  /** Request integration — the adapter answers with the command for the
   *  user's terminal (or a refusal). The portal never launches hosts. */
  async requestIntegration(h: HostDetection): Promise<void> {
    if (this.launchBusy() !== null) return;
    this.launchBusy.set(h.host);
    try {
      const r = await firstValueFrom(this.api.hostsLaunch(h.host));
      const outcome: LaunchOutcome = {
        command: r.command ?? null,
        refusal: r.refusal ?? null,
        detail: r.detail ?? null,
        at: new Date().toISOString(),
      };
      this.launch.update((m) => ({ ...m, [h.host]: outcome }));
      if (outcome.command) this.toast.show('notify.success', 'success');
      else if (outcome.refusal) this.toast.show(outcome.refusal, 'error');
      else this.toast.show('hosts.launch.unavailable', 'info');
    } catch (e) {
      this.src.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.launchBusy.set(null);
    }
  }

  async copyCommand(host: string, cmd: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(cmd);
      this.copied.set(host);
      this.toast.show('state.copied', 'success');
      setTimeout(() => {
        if (this.copied() === host) this.copied.set(null);
      }, 1600);
    } catch {
      // clipboard unavailable — the command stays visible to copy by hand
      this.toast.show('error.generic', 'error');
    }
  }

  protected readonly stamp = stamp;
}
