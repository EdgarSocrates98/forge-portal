import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  RegistryAction,
  RegistryExecuteResponse,
  RegistryPlanResponse,
  RegistryReceipt,
  RegistryState,
} from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { StateBadge } from '../../shared/state-badge';
import { ErrorState } from '../../shared/error-state';
import { EmptyState } from '../../shared/empty-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { ToastService } from '../../shared/toast';
import { Source, stamp } from './forges.data';

type Phase = 'idle' | 'planning' | 'review' | 'executing' | 'receipt';

interface Row {
  name: string;
  receipt: RegistryReceipt;
}

/**
 * Registry operations — the visual twin of the P1-003 contract:
 * POST /registry/plan → review the CLI-produced preview → explicit
 * confirm → POST /registry/execute with the one-time plan_token →
 * receipt + fresh GET /registry/state. Destructive verbs render the
 * confirm button in danger styling; every absent field is UNVERIFIED,
 * never assumed. pin/unpin plan offline (the CLI verb has no --plan
 * mode) — the panel shows whatever the backend returned.
 */
@Component({
  selector: 'registry-ops-panel',
  standalone: true,
  imports: [TPipe, StateBadge, ErrorState, EmptyState, UiIcon, UiSkeleton],
  template: `
    <section class="card" data-section="registry-ops" aria-labelledby="rops-h">
      <div class="rops__head">
        <div>
          <h2 id="rops-h">{{ 'registry.title' | t }}</h2>
          <p class="src">
            <code
              >POST /api/v1/registry/plan · POST /api/v1/registry/execute · GET
              /api/v1/registry/state</code
            >
            @if (state.loadedAt(); as ts) {
              <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
            }
          </p>
          <p class="muted">{{ 'registry.hint' | t }}</p>
        </div>
        <button
          class="icon-btn"
          (click)="load()"
          [disabled]="busy()"
          [attr.aria-label]="'state.refresh' | t"
        >
          <ui-icon name="refresh" [size]="14" />
        </button>
      </div>

      @if (cliUnavailable()) {
        <div class="unv" role="note">
          <ui-state-badge state="UNVERIFIED" />
          <span>{{ 'registry.cliUnavailable' | t }}</span>
        </div>
      }

      <!-- operation form — every verb goes through plan first -->
      <div class="rops__form">
        <label class="rops__field" for="registry-forge">
          <span class="lbl">{{ 'registry.forge' | t }}</span>
          <input
            id="registry-forge"
            name="registry-forge"
            type="text"
            list="registry-forges"
            autocomplete="off"
            [value]="forge()"
            (input)="forge.set(asText($event))"
            [disabled]="busy()"
            [attr.placeholder]="'registry.forge.hint' | t"
          />
        </label>
        <datalist id="registry-forges">
          @for (name of installedNames(); track name) {
            <option [value]="name"></option>
          }
        </datalist>
        <div class="rops__actions" role="group" [attr.aria-label]="'registry.title' | t">
          @for (a of actions; track a) {
            <button
              class="btn"
              [attr.data-plan]="a"
              [class.btn--danger]="a === 'uninstall'"
              [disabled]="busy() || !forge().trim()"
              (click)="plan(a)"
            >
              {{ 'registry.action.' + a | t }}
            </button>
          }
        </div>
      </div>

      @if (phase() === 'planning') {
        <div class="running" role="status" aria-live="polite" data-section="registry-planning">
          <div class="running__spinner" aria-hidden="true"></div>
          <p class="muted">{{ 'registry.planning' | t }}</p>
        </div>
      }

      <!-- review — the plan the CLI (or the offline preview) produced -->
      @if (phase() === 'review' && planReceipt(); as r) {
        <section
          class="rops__review"
          data-section="registry-review"
          [attr.data-action]="r.plan.action"
          [attr.data-forge]="r.plan.forge"
          [attr.data-status]="r.status"
        >
          <div class="rops__review-head">
            <h3>{{ 'registry.review' | t }}</h3>
            <ui-state-badge [state]="r.status" />
          </div>
          <p class="muted">{{ 'registry.review.hint' | t }}</p>
          <dl class="rops__kv">
            <div>
              <dt>{{ 'registry.op' | t }}</dt>
              <dd>
                <code>{{ r.plan.action }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'registry.forge' | t }}</dt>
              <dd>
                <code>{{ r.plan.forge }}</code>
              </dd>
            </div>
          </dl>
          @if (previewEntries().length) {
            <dl class="rops__kv">
              @for (e of previewEntries(); track e.k) {
                <div>
                  <dt>{{ e.k }}</dt>
                  <dd>{{ e.v }}</dd>
                </div>
              }
            </dl>
          } @else if (previewText(); as t) {
            <pre class="rops__pre">{{ t }}</pre>
          } @else {
            <p class="muted">{{ 'registry.previewEmpty' | t }}</p>
          }
          <details class="raw">
            <summary>{{ 'fdoc.raw' | t }}</summary>
            <pre>{{ planText(r) }}</pre>
          </details>
          <div class="rops__row">
            <button
              class="btn"
              [class.btn--primary]="!destructive()"
              [class.btn--danger]="destructive()"
              [attr.data-exec]="r.plan.action"
              (click)="confirmExecute()"
            >
              <ui-icon name="shield-check" [size]="15" />
              {{ 'install.confirm.execute' | t }}
            </button>
            <button class="btn" (click)="reset()">{{ 'state.cancel' | t }}</button>
          </div>
        </section>
      }

      @if (phase() === 'executing') {
        <div class="running" role="status" aria-live="polite" data-section="registry-executing">
          <div class="running__spinner" aria-hidden="true"></div>
          <p class="muted">{{ 'registry.executing' | t }}</p>
        </div>
      }

      <!-- receipt — CLI verdict + the refreshed registry state -->
      @if (phase() === 'receipt' && execReceipt(); as r) {
        <section
          class="rops__receipt"
          data-section="registry-receipt"
          [attr.data-status]="r.status"
        >
          <div class="rops__review-head">
            <h3>{{ 'registry.receipt' | t }}</h3>
            <ui-state-badge [state]="r.status" />
          </div>
          @if (resultEntries().length) {
            <dl class="rops__kv">
              @for (e of resultEntries(); track e.k) {
                <div>
                  <dt>{{ e.k }}</dt>
                  <dd>{{ e.v }}</dd>
                </div>
              }
            </dl>
          }
          <details class="raw">
            <summary>{{ 'fdoc.raw' | t }}</summary>
            <pre>{{ resultText(r) }}</pre>
          </details>
          <div class="rops__row">
            <button class="btn" (click)="reset()">{{ 'registry.newOp' | t }}</button>
          </div>
        </section>
      }

      @if (error(); as e) {
        <ui-error [error]="e" (retry)="reset()" />
      }

      <!-- registry state — the forge-cli receipts projection -->
      <div class="rops__state" data-section="registry-state">
        <h3>{{ 'registry.state' | t }}</h3>
        @if (state.unavailable()) {
          <div class="unv" role="note">
            <ui-state-badge state="UNVERIFIED" />
            <span>{{ 'registry.unavailable' | t }}</span>
          </div>
        }
        @if (state.error(); as e) {
          <ui-error [error]="e" (retry)="load()" />
        }
        @if (state.loading() && !state.data()) {
          <div role="status" [attr.aria-label]="'state.loading' | t">
            <ui-skeleton kind="row" [lines]="2" />
          </div>
        }
        @if (state.data(); as s) {
          @if (!s.present) {
            <div class="unv" role="note" data-state="absent">
              <ui-state-badge [state]="s.error === 'malformed' ? 'FAILED' : 'UNVERIFIED'" />
              <span>{{
                (s.error === 'malformed' ? 'registry.malformed' : 'registry.absent') | t
              }}</span>
              <code class="muted">{{ s.state_path }}</code>
            </div>
          } @else if (rows().length) {
            <div class="rops__table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">{{ 'registry.forge' | t }}</th>
                    <th scope="col">{{ 'settings.version' | t }}</th>
                    <th scope="col">{{ 'registry.method' | t }}</th>
                    <th scope="col">{{ 'registry.installedAt' | t }}</th>
                    <th scope="col">{{ 'registry.colOps' | t }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.name) {
                    <tr [attr.data-forge]="row.name">
                      <td>
                        <code>{{ row.name }}</code>
                        @if (row.receipt.pinned) {
                          <span class="rops__pin" [attr.title]="'registry.pinned' | t">
                            {{ 'registry.pinned' | t }} {{ row.receipt.pinned }}
                          </span>
                        }
                      </td>
                      <td>{{ row.receipt.version ?? '—' }}</td>
                      <td>
                        <code>{{ row.receipt.method ?? row.receipt.dist ?? '—' }}</code>
                      </td>
                      <td>{{ row.receipt.installedAt ?? '—' }}</td>
                      <td>
                        <div class="rops__row-ops">
                          @for (a of rowActions(row); track a) {
                            <button
                              class="rops__op"
                              [class.rops__op--danger]="a === 'uninstall'"
                              [attr.data-plan]="a"
                              [attr.data-forge]="row.name"
                              [disabled]="busy()"
                              (click)="plan(a, row.name)"
                            >
                              {{ 'registry.action.' + a | t }}
                            </button>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <ui-empty icon="gem" [title]="'registry.none' | t" />
          }
        }
      </div>
    </section>
  `,
  styles: `
    .rops__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .rops__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .src {
      margin: 4px 0 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .unv {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-3);
      padding: var(--space-3);
      margin-bottom: var(--space-3);
      border: 1px dashed color-mix(in srgb, var(--warn) 55%, transparent);
      border-radius: var(--radius-md);
      background: var(--warn-bg);
      font-size: var(--font-sm);
    }
    .rops__form {
      display: grid;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .rops__field input {
      width: min(30rem, 100%);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-md);
      background: var(--bg);
      color: var(--fg);
      font: inherit;
    }
    .rops__actions {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .rops__review,
    .rops__receipt {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-3);
      margin-bottom: var(--space-3);
      background: var(--bg-elevated);
    }
    .rops__review-head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .rops__review-head h3 {
      margin: 0;
      font-size: var(--font-md);
    }
    .rops__kv {
      display: grid;
      gap: var(--space-2);
      margin: var(--space-3) 0 0;
    }
    .rops__kv div {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
    }
    .rops__kv dt {
      min-width: 8rem;
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
    .rops__kv dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .rops__pre {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      overflow-x: auto;
      font-size: var(--font-xs);
      white-space: pre-wrap;
    }
    .rops__row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-3);
    }
    .rops__state {
      margin-top: var(--space-4);
    }
    .rops__state h3 {
      margin: 0 0 var(--space-2);
      font-size: var(--font-md);
    }
    .rops__table-wrap {
      overflow-x: auto;
    }
    .rops__pin {
      display: inline-block;
      margin-left: var(--space-2);
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent-ink);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .rops__row-ops {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .rops__op {
      padding: 2px 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--fg-muted);
      font-size: var(--font-xs);
      font-weight: 600;
      cursor: pointer;
    }
    .rops__op:hover {
      color: var(--fg);
      border-color: var(--border-strong);
      background: var(--bg-hover);
    }
    .rops__op--danger {
      color: var(--error);
      border-color: color-mix(in srgb, var(--error) 45%, transparent);
    }
    .rops__op--danger:hover {
      background: color-mix(in srgb, var(--error) 12%, transparent);
      color: var(--error);
    }
    .rops__op:disabled {
      opacity: 0.5;
      cursor: default;
    }
  `,
})
export class RegistryOpsPanel {
  private readonly api = inject(PortalApi);
  private readonly toast = inject(ToastService);

  readonly state = new Source<RegistryState>();
  readonly phase = signal<Phase>('idle');
  readonly forge = signal('');
  readonly planReceipt = signal<RegistryPlanResponse | null>(null);
  readonly execReceipt = signal<RegistryExecuteResponse | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly cliUnavailable = signal(false);

  readonly actions: RegistryAction[] = [
    'install',
    'update',
    'reinstall',
    'rollback',
    'pin',
    'unpin',
    'repair',
    'uninstall',
  ];

  readonly busy = computed(() => this.phase() === 'planning' || this.phase() === 'executing');
  readonly destructive = computed(() => {
    const a = this.planReceipt()?.plan.action;
    return a === 'uninstall' || a === 'rollback';
  });
  readonly rows = computed<Row[]>(() =>
    Object.entries(this.state.data()?.forges ?? {}).map(([name, receipt]) => ({
      name,
      receipt,
    })),
  );
  readonly installedNames = computed(() => this.rows().map((r) => r.name));

  readonly previewEntries = computed(() => entries(this.planReceipt()?.plan.preview));
  readonly previewText = computed(() => {
    const p = this.planReceipt()?.plan.preview;
    return typeof p === 'string' ? p : null;
  });
  readonly resultEntries = computed(() => entries(this.execReceipt()?.result));

  readonly stamp = stamp;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    await this.state.load(() => this.api.registryState());
  }

  rowActions(row: Row): RegistryAction[] {
    const out: RegistryAction[] = ['update', 'reinstall', 'rollback', 'repair'];
    out.push(row.receipt.pinned ? 'unpin' : 'pin');
    out.push('uninstall');
    return out;
  }

  /** Step 1 — plan. The CLI validates the verb; a 'plan-failed' status
   *  is a receipt, still reviewable, never an exception. */
  async plan(action: RegistryAction, forge?: string): Promise<void> {
    const name = (forge ?? this.forge()).trim();
    if (this.busy() || !name) return;
    if (forge !== undefined) this.forge.set(forge);
    this.error.set(null);
    this.planReceipt.set(null);
    this.execReceipt.set(null);
    this.phase.set('planning');
    try {
      const r = await firstValueFrom(this.api.registryPlan({ action, forge: name }));
      this.planReceipt.set(r);
      this.phase.set('review');
      if (r.status === 'planned') {
        this.toast.show('registry.toast.planned', 'info', {
          params: { action, forge: name },
        });
      }
    } catch (e) {
      this.fail(e);
    }
  }

  /** Step 2 — confirm click binds the one-time plan_token to THIS plan. */
  async confirmExecute(): Promise<void> {
    const r = this.planReceipt();
    if (this.phase() !== 'review' || !r) return;
    this.error.set(null);
    this.phase.set('executing');
    try {
      const res = await firstValueFrom(
        this.api.registryExecute({
          action: r.plan.action as RegistryAction,
          forge: r.plan.forge,
          plan: r.plan as unknown as Record<string, unknown>,
          planToken: r.plan_token,
        }),
      );
      this.execReceipt.set(res);
      this.phase.set('receipt');
      this.toast.show('registry.toast.executed', res.status === 'executed' ? 'success' : 'error', {
        params: { action: r.plan.action, forge: r.plan.forge, status: res.status },
      });
      await this.load();
    } catch (e) {
      this.fail(e);
    }
  }

  reset(): void {
    this.phase.set('idle');
    this.planReceipt.set(null);
    this.execReceipt.set(null);
    this.error.set(null);
  }

  asText(event: Event): string {
    return (event.target as HTMLInputElement | null)?.value ?? '';
  }

  planText(r: RegistryPlanResponse): string {
    return JSON.stringify(r.plan, null, 2);
  }

  resultText(r: RegistryExecuteResponse): string {
    return JSON.stringify(r.result ?? r, null, 2);
  }

  private fail(e: unknown): void {
    const err = e instanceof ApiError ? e : new ApiError(0);
    if (err.body.code === 'PORTAL-CLI-UNAVAILABLE') this.cliUnavailable.set(true);
    this.error.set(err);
    this.phase.set('idle');
  }
}

/** Top-level scalar-ish entries of an arbitrary preview/result doc —
 *  nested containers render as compact JSON, capped so a huge receipt
 *  never floods the card (the raw <details> keeps the whole doc). */
function entries(doc: unknown): { k: string; v: string }[] {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
  const out: { k: string; v: string }[] = [];
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    if (out.length >= 14) break;
    out.push({
      k,
      v:
        v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v),
    });
  }
  return out;
}
