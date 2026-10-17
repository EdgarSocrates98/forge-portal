import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { InstallationReceipt, TaskExecution } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { ForgeDoc, UiForgeDoc } from '../../shared/forge-doc';
import { UiSkeleton } from '../../shared/skeleton';

interface PendingPlan {
  plan_token: string;
  plan: Record<string, unknown>;
  /** Envelope-level correlation_id never reaches the page — the client's
   *  unwrap() returns `data` only. We surface the payload field when the
   *  server puts it there; otherwise the plan card shows '—'. */
  correlation_id: string | null;
}

/**
 * Tarefas — §5.3 Execution Center. intent → plan → review → execute →
 * receipt, all bound to real adapter ops:
 *  - correlation ids are surfaced wherever the payload actually carries
 *    them (TaskExecution.correlation_id, plan/receipt payload fields);
 *    unreachable ids render '—', never a fabricated value;
 *  - the result card exports the real receipt payload as
 *    receipt-<task_id>.json via a Blob download;
 *  - PORTAL-PLAN-STALE surfaces a dedicated regenerate-plan action —
 *    execute is never silently retried with a dead token;
 *  - the ops card documents capability honesty: cancel is UNVERIFIED
 *    because the adapter exposes no cancel op, and a muted note states
 *    that mutating ops are rate-limited + plan-token bound;
 *  - stage transitions come from real TaskExecution records — no fake
 *    progress, no simulated stages.
 */
@Component({
  selector: 'page-tasks',
  standalone: true,
  imports: [
    FormsModule,
    TPipe,
    PageHeader,
    StateBadge,
    EmptyState,
    ErrorState,
    UiIcon,
    UiForgeDoc,
    UiSkeleton,
  ],
  template: `
    <ui-page-header [title]="'tasks.title' | t" [subtitle]="'tasks.subtitle' | t">
      <button class="btn" [disabled]="busy()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <section class="card" data-section="intent">
      <label class="lbl" for="intent">{{ 'tasks.intent.label' | t }}</label>
      <div class="intent-row">
        <div class="search-field intent-field">
          <ui-icon name="terminal" [size]="15" />
          <input
            id="intent"
            class="input"
            type="text"
            [placeholder]="'tasks.intent.placeholder' | t"
            [ngModel]="intent()"
            (ngModelChange)="intent.set($event)"
            (keydown.enter)="plan()"
            [disabled]="busy()"
          />
        </div>
        <button
          class="btn btn--primary"
          data-action="plan"
          [disabled]="busy() || !intent().trim()"
          (click)="plan()"
        >
          <ui-icon name="tasks" [size]="14" />
          {{ 'tasks.intent.run' | t }}
        </button>
      </div>
    </section>

    @if (executing()) {
      <section class="card running" role="status" aria-live="polite" data-section="running">
        <div class="running__spinner" aria-hidden="true"></div>
        <p class="muted">{{ 'tasks.executing' | t }}</p>
      </section>
    }

    @if (stale(); as s) {
      <section class="card stale" role="alert" data-section="stale">
        <h2>{{ 'tasks.stale.title' | t }}</h2>
        <p>
          <code>{{ s.body.code }}</code>
          {{ s.body.message }}
        </p>
        <p class="muted">{{ 'tasks.stale.hint' | t }}</p>
        <div class="row">
          <button
            class="btn btn--primary"
            data-action="regenerate"
            [disabled]="busy()"
            (click)="regenerate()"
          >
            <ui-icon name="refresh" [size]="14" />
            {{ 'tasks.stale.regenerate' | t }}
          </button>
          <button class="btn" (click)="stale.set(null)">{{ 'state.close' | t }}</button>
        </div>
      </section>
    }

    @if (pending(); as p) {
      <section class="card" data-lift data-section="plan">
        <h2>{{ 'tasks.plan' | t }}</h2>
        <p class="muted">{{ 'tasks.plan.review' | t }}</p>

        <dl class="plan-card">
          <div class="kv">
            <dt>{{ 'tasks.plan.task' | t }}</dt>
            <dd>{{ planField(p.plan, 'label') || planField(p.plan, 'verb') }}</dd>
          </div>
          <div class="kv">
            <dt>{{ 'tasks.plan.verb' | t }}</dt>
            <dd>
              <code>{{ planField(p.plan, 'verb') }}</code>
            </dd>
          </div>
          <div class="kv">
            <dt>{{ 'tasks.plan.intent' | t }}</dt>
            <dd>{{ planField(p.plan, 'intent') }}</dd>
          </div>
          <div class="kv">
            <dt>{{ 'tasks.correlation' | t }}</dt>
            <dd class="corr" [attr.title]="realCorrelation(planCorrelation(p))">
              <code>{{ planCorrelation(p) }}</code>
            </dd>
          </div>
          @for (arg of planArgs(p.plan); track arg[0]) {
            <div class="kv">
              <dt>
                <code>{{ arg[0] }}</code>
              </dt>
              <dd>{{ arg[1] }}</dd>
            </div>
          }
        </dl>

        <details class="raw">
          <summary>{{ 'fdoc.raw' | t }}</summary>
          <pre>{{ planText(p.plan) }}</pre>
        </details>

        <div class="row">
          <button
            class="btn btn--primary"
            data-action="execute"
            [disabled]="busy()"
            (click)="execute(p.plan, p.plan_token)"
          >
            <ui-icon name="tasks" [size]="14" />
            {{ 'tasks.execute' | t }}
          </button>
          <button class="btn" (click)="pending.set(null)">{{ 'state.cancel' | t }}</button>
        </div>
      </section>
    }

    @if (receipt(); as r) {
      <section class="card" data-lift data-section="receipt" aria-live="polite">
        <h2>{{ 'tasks.result' | t }}</h2>
        <p class="receipt__status">
          <ui-state-badge [state]="r.status" />
          @if (r.task?.stage) {
            <ui-state-badge [state]="stageKind(r.task!.stage)" [labelOverride]="r.task!.stage" />
          }
          @if (r.task?.exit_code !== null && r.task?.exit_code !== undefined) {
            <span class="muted">exit {{ r.task!.exit_code }}</span>
          }
          @if (r.detail) {
            <span>{{ r.detail }}</span>
          }
        </p>

        <dl class="plan-card">
          <div class="kv">
            <dt>{{ 'tasks.correlation' | t }}</dt>
            <dd class="corr" [attr.title]="realCorrelation(receiptCorrelation(r))">
              <code>{{ receiptCorrelation(r) }}</code>
            </dd>
          </div>
          @if (r.task) {
            <div class="kv">
              <dt>{{ 'table.task' | t }}</dt>
              <dd>{{ r.task!.label }}</dd>
            </div>
            <div class="kv">
              <dt>{{ 'table.duration' | t }}</dt>
              <dd class="num">{{ duration(r.task!) }}</dd>
            </div>
          }
        </dl>

        @if (r.refusal || r.task?.refusal) {
          <p class="refusal" role="alert">
            <code>{{ r.refusal ?? r.task!.refusal }}</code>
            @if (r.unlock) {
              — {{ r.unlock }}
            }
          </p>
        }
        @if (r.actions?.length) {
          <ul class="actions">
            @for (a of r.actions; track $index) {
              <li>
                <code>{{ a.status }}</code>
                <code class="actions__kind">{{ a.kind }}</code>
                <span>{{ a.path }}</span>
              </li>
            }
          </ul>
        }
        @if (receiptDoc(r); as d) {
          <ui-forge-doc [doc]="d" />
        }
        <details class="raw">
          <summary>{{ 'fdoc.raw' | t }}</summary>
          <pre>{{ receiptText(r) }}</pre>
        </details>
        <div class="row">
          <button class="btn" data-action="export" (click)="exportReceipt(r)">
            <ui-icon name="install" [size]="14" />
            {{ 'tasks.export' | t }}
          </button>
          <button class="btn" (click)="receipt.set(null)">{{ 'state.close' | t }}</button>
        </div>
      </section>
    }

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    <!-- Ops capabilities — plan/execute are real adapter ops; the adapter
         exposes no cancel, so that row is UNVERIFIED, never a dead button. -->
    <section class="card ops" aria-labelledby="ops-h" data-section="ops">
      <h2 id="ops-h">{{ 'tasks.ops.title' | t }}</h2>
      <ul class="ops__list">
        <li class="op" data-op="plan">
          <span class="op__body">
            <strong>{{ 'tasks.intent.run' | t }}</strong>
            <small class="muted">{{ 'tasks.ops.plan.hint' | t }}</small>
          </span>
          <ui-state-badge state="supported" />
        </li>
        <li class="op" data-op="execute">
          <span class="op__body">
            <strong>{{ 'tasks.execute' | t }}</strong>
            <small class="muted">{{ 'tasks.ops.execute.hint' | t }}</small>
          </span>
          <ui-state-badge state="supported" />
        </li>
        <li class="op" data-op="cancel" data-state="unverified">
          <span class="op__body">
            <strong>{{ 'state.cancel' | t }}</strong>
            <small class="muted">{{ 'tasks.ops.cancel.hint' | t }}</small>
          </span>
          <ui-state-badge state="unverified" />
        </li>
      </ul>
      <p class="muted limits">{{ 'tasks.limits' | t }}</p>
    </section>

    <section class="card" data-section="history">
      <h2>{{ 'tasks.recent' | t }}</h2>
      @if (loading()) {
        <ui-skeleton kind="card" />
      }
      @if (tasks().length) {
        <table class="table">
          <thead>
            <tr>
              <th>
                <span class="sr-only">{{ 'table.task' | t }}</span>
              </th>
              <th>{{ 'table.verb' | t }}</th>
              <th>{{ 'table.stage' | t }}</th>
              <th>{{ 'table.correlation' | t }}</th>
              <th>{{ 'table.duration' | t }}</th>
              <th>{{ 'table.exit' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (t of tasks(); track t.id) {
              <tr>
                <td>{{ t.label }}</td>
                <td>
                  <code>{{ t.verb }}</code>
                </td>
                <td><ui-state-badge [state]="stageKind(t.stage)" [labelOverride]="t.stage" /></td>
                <td class="corr" [attr.title]="t.correlation_id ?? null">
                  <code>{{ t.correlation_id ?? '—' }}</code>
                </td>
                <td class="num">{{ duration(t) }}</td>
                <td>{{ t.exit_code ?? '—' }}</td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        @if (!loading()) {
          <ui-empty icon="tasks" [title]="'tasks.empty' | t" />
        }
      }
    </section>
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .lbl {
      display: block;
      font-weight: 600;
      margin-bottom: var(--space-2);
    }
    .intent-row {
      display: flex;
      gap: var(--space-2);
    }
    .intent-field {
      flex: 1;
      max-width: none;
      margin-bottom: 0;
    }
    .plan-card {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--space-2) var(--space-4);
      margin: var(--space-3) 0;
    }
    .kv dt {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .kv dd {
      margin: 0;
      font-weight: 550;
      word-break: break-all;
    }
    .corr {
      max-width: 170px;
    }
    .corr code {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .num {
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .raw {
      margin: var(--space-2) 0;
    }
    .raw pre {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      overflow-x: auto;
      font-size: var(--font-xs);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-3);
    }
    .muted {
      color: var(--fg-muted);
    }
    .limits {
      margin: var(--space-3) 0 0;
      font-size: var(--font-xs);
    }
    .refusal {
      color: var(--warn);
    }
    .receipt__status {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .running {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .running p {
      margin: 0;
    }
    .running__spinner {
      width: 18px;
      height: 18px;
      flex: none;
      border-radius: 50%;
      border: 2px solid var(--accent-bg);
      border-top-color: var(--accent);
      animation: fg-spin 0.8s linear infinite;
    }
    @keyframes fg-spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .running__spinner {
        animation: none;
        border-top-color: var(--border-strong);
      }
    }
    .stale {
      border-left: 3px solid var(--warn);
    }
    .stale p code {
      color: var(--warn);
    }
    .actions {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
      list-style: none;
      padding: 0;
      margin: 0 0 var(--space-3);
      display: grid;
      gap: 6px;
      max-height: 200px;
      overflow: auto;
    }
    .actions li {
      display: flex;
      gap: var(--space-2);
      overflow-wrap: anywhere;
    }
    .actions li code {
      color: var(--accent);
      flex: none;
    }
    .actions__kind {
      color: var(--fg-muted) !important;
    }
    .ops__list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: var(--space-2);
    }
    .op {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }
    .op[data-state='unverified'] {
      border-style: dashed;
      opacity: 0.8;
    }
    .op__body {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .op__body small {
      color: var(--fg-muted);
    }
  `,
})
export class TasksPage {
  private readonly api = inject(PortalApi);
  readonly intent = signal('');
  readonly pending = signal<PendingPlan | null>(null);
  readonly receipt = signal<InstallationReceipt | null>(null);
  readonly tasks = signal<TaskExecution[]>([]);
  readonly error = signal<ApiError | null>(null);
  /** PORTAL-PLAN-STALE — surfaced as a regenerate-plan card, never an
   *  automatic retry. */
  readonly stale = signal<ApiError | null>(null);
  readonly busy = signal(false);
  readonly executing = signal(false);
  readonly loading = signal(true);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    try {
      this.tasks.set(await firstValueFrom(this.api.tasks()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  async plan(): Promise<void> {
    if (this.busy() || !this.intent().trim()) return;
    this.busy.set(true);
    this.error.set(null);
    this.stale.set(null);
    this.receipt.set(null);
    try {
      const r = await firstValueFrom(this.api.tasksPlan({ intent: this.intent() }));
      const cid = (r as Record<string, unknown>)['correlation_id'];
      this.pending.set({
        plan_token: r.plan_token,
        plan: r.plan,
        correlation_id: typeof cid === 'string' && cid ? cid : null,
      });
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async execute(plan: Record<string, unknown>, planToken: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.executing.set(true);
    this.error.set(null);
    try {
      this.receipt.set(await firstValueFrom(this.api.tasksExecute(plan, planToken)));
      this.pending.set(null);
      await this.load();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0);
      if (err.body.code === 'PORTAL-PLAN-STALE') {
        // the token is dead — drop the doomed plan and ask the user to
        // regenerate with the same intent; execute never retries itself
        this.pending.set(null);
        this.stale.set(err);
      } else {
        this.error.set(err);
      }
    } finally {
      this.busy.set(false);
      this.executing.set(false);
    }
  }

  /** Re-plan with the same intent after a PORTAL-PLAN-STALE — an explicit
   *  user action, not a silent retry of the dead token. */
  async regenerate(): Promise<void> {
    if (this.busy() || !this.stale()) return;
    this.stale.set(null);
    await this.plan();
  }

  /** Download the real receipt payload — the server already scrubbed it. */
  exportReceipt(r: InstallationReceipt): void {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = r.task?.id ? `receipt-${r.task.id}.json` : 'receipt.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  planText(plan: Record<string, unknown>): string {
    return JSON.stringify(plan, null, 2);
  }

  receiptText(r: InstallationReceipt): string {
    return JSON.stringify(r, null, 2);
  }

  /** Correlation id shown on the plan card — payload field first, then a
   *  `correlation_id` embedded in the plan body; '—' when unreachable. */
  planCorrelation(p: PendingPlan): string {
    if (p.correlation_id) return p.correlation_id;
    const inner = p.plan['correlation_id'];
    return typeof inner === 'string' && inner ? inner : '—';
  }

  /** Correlation id on the result card — the task record is authoritative;
   *  the receipt payload field is the only other honest source. */
  receiptCorrelation(r: InstallationReceipt): string {
    const task = r.task?.correlation_id;
    if (task) return task;
    const top = (r as unknown as Record<string, unknown>)['correlation_id'];
    return typeof top === 'string' && top ? top : '—';
  }

  /** Hover title only when the id is real — '—' is not a tooltip value. */
  realCorrelation(cid: string): string | null {
    return cid === '—' ? null : cid;
  }

  /** finished_at − started_at, only when both real timestamps exist. */
  duration(t: TaskExecution): string {
    if (!t.started_at || !t.finished_at) return '—';
    const ms = Date.parse(t.finished_at) - Date.parse(t.started_at);
    if (!Number.isFinite(ms) || ms < 0) return '—';
    if (ms < 1000) return `${ms} ms`;
    const s = ms / 1000;
    if (s < 60) return `${Number(s.toFixed(1))} s`;
    const m = Math.floor(s / 60);
    return `${m}m ${Math.round(s - m * 60)}s`;
  }

  planField(plan: Record<string, unknown>, key: string): string {
    const v = plan[key];
    return v === undefined || v === null ? '' : String(v);
  }

  planArgs(plan: Record<string, unknown>): Array<[string, string]> {
    const args = plan['args'];
    if (!args || typeof args !== 'object') return [];
    return Object.entries(args as Record<string, unknown>).map(([k, v]) => [
      k,
      typeof v === 'object' ? JSON.stringify(v) : String(v),
    ]);
  }

  /** The inner forge/* doc of a task receipt — rendered by ui-forge-doc. */
  receiptDoc(r: InstallationReceipt): ForgeDoc | null {
    const inner = r.task?.receipt;
    return inner && typeof inner === 'object' ? (inner as ForgeDoc) : null;
  }

  stageKind(stage: string): string {
    const s = (stage || '').toLowerCase();
    if (s === 'completed') return 'supported';
    if (['failed', 'refused', 'cancelled'].includes(s)) return 'error';
    if (['awaiting_approval', 'partial'].includes(s)) return 'warn';
    if (['running', 'planning', 'verifying'].includes(s)) return 'info';
    return 'muted';
  }
}
