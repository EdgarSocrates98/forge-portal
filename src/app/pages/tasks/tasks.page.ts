import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { InstallationReceipt, MetricsReport, TaskExecution } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { ForgeDoc, UiForgeDoc } from '../../shared/forge-doc';
import { UiSkeleton } from '../../shared/skeleton';
import { Source } from '../explorer/forges.data';
import { buildReplay, buildTimeline, fmtTaskDuration } from './tasks.data';

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
 *
 * Cycle 4 §7 additions:
 *  - Execution timeline: bars positioned by the records' real
 *    `started_at`/`finished_at`; unfinished or contradictory ends render
 *    as open bars (never a fake finish) and records without a usable
 *    `started_at` stay undrawn, counting toward a `partial` marker —
 *    the timeline never claims to be the whole history.
 *  - Replay: a click on any record opens its detail plus a stepper over
 *    the *persisted* `/metrics` events sharing its `correlation_id`.
 *    Only recorded events replay — stages the adapter never logged are
 *    never reconstructed; when /metrics or the correlation id is absent
 *    the card says so instead of fabricating steps.
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

    <!-- Execution timeline — bars drawn only from recorded timestamps.
         A PARTIAL badge marks records that could not be placed; open
         bars are tasks with no trustworthy finished_at — never a fake
         finish. -->
    @if (tasks().length) {
      <section class="card" data-section="timeline" aria-labelledby="tl-h">
        <h2 id="tl-h">
          {{ 'tasks.timeline.title' | t }}
          @if (timeline().partial) {
            <ui-state-badge state="PARTIAL" />
          }
        </h2>
        <p class="muted">{{ 'tasks.timeline.hint' | t }}</p>
        @if (timeline(); as tl) {
          @if (tl.rows.length) {
            <div class="tl" role="list" [attr.aria-label]="'tasks.timeline.title' | t">
              <div class="tl__axis" aria-hidden="true">
                <span>{{ fmtAt(tl.windowStart) }}</span>
                <span>{{ fmtAt(tl.windowEnd) }}</span>
              </div>
              @for (r of tl.rows; track r.task.id) {
                <button
                  class="tl__row"
                  type="button"
                  role="listitem"
                  [attr.data-selected]="selectedId() === r.task.id || null"
                  [attr.aria-label]="r.task.label || r.task.verb"
                  (click)="selectTask(r.task)"
                >
                  <span class="tl__label">{{ r.task.label || r.task.verb }}</span>
                  <span class="tl__track">
                    <span
                      class="tl__bar"
                      [attr.data-kind]="stageKind(r.task.stage)"
                      [attr.data-open]="r.endMs === null || null"
                      [style.left.%]="r.leftPct"
                      [style.width.%]="r.widthPct"
                      [title]="tipFor(r)"
                    ></span>
                  </span>
                  <span class="tl__dur num">{{ duration(r.task) }}</span>
                </button>
              }
            </div>
            @if (tl.unplaced.length) {
              <p class="muted tl__unplaced" data-note="unplaced">
                {{ 'tasks.timeline.unplaced' | t: { count: tl.unplaced.length } }}
              </p>
            }
          } @else {
            <ui-empty icon="tasks" [title]="'tasks.timeline.empty' | t" />
          }
        }
      </section>
    }

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
              <tr [attr.data-selected]="selectedId() === t.id || null">
                <td>
                  <button
                    class="linklike"
                    type="button"
                    data-action="inspect"
                    (click)="selectTask(t)"
                  >
                    {{ t.label }}
                  </button>
                </td>
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

    <!-- Task detail + recorded-events replay — opened from the timeline
         or the history table; every field comes from the task record. -->
    @if (selectedTask(); as t) {
      <section class="card detail" data-section="task-detail" aria-live="polite">
        <header class="detail__head">
          <h2><ui-icon name="tasks" [size]="15" />{{ t.label || t.verb }}</h2>
          <button
            class="icon-btn"
            (click)="selectedId.set(null)"
            [attr.aria-label]="'state.close' | t"
          >
            <ui-icon name="chevron-right" [size]="14" />
          </button>
        </header>
        <dl class="plan-card">
          <div class="kv">
            <dt>{{ 'table.id' | t }}</dt>
            <dd>
              <code>{{ t.id }}</code>
            </dd>
          </div>
          <div class="kv">
            <dt>{{ 'table.verb' | t }}</dt>
            <dd>
              <code>{{ t.verb }}</code>
            </dd>
          </div>
          <div class="kv">
            <dt>{{ 'table.stage' | t }}</dt>
            <dd>
              <ui-state-badge [state]="stageKind(t.stage)" [labelOverride]="t.stage" />
            </dd>
          </div>
          <div class="kv">
            <dt>{{ 'table.started' | t }}</dt>
            <dd>{{ t.started_at ? fmtEventAt(t.started_at) : '—' }}</dd>
          </div>
          <div class="kv">
            <dt>{{ 'table.finished' | t }}</dt>
            <dd>{{ t.finished_at ? fmtEventAt(t.finished_at) : '—' }}</dd>
          </div>
          <div class="kv">
            <dt>{{ 'table.duration' | t }}</dt>
            <dd class="num">{{ duration(t) }}</dd>
          </div>
          <div class="kv">
            <dt>{{ 'table.exit' | t }}</dt>
            <dd>{{ t.exit_code ?? '—' }}</dd>
          </div>
          <div class="kv">
            <dt>{{ 'tasks.correlation' | t }}</dt>
            <dd class="corr" [attr.title]="t.correlation_id ?? null">
              <code>{{ t.correlation_id ?? '—' }}</code>
            </dd>
          </div>
          @if (t.refusal) {
            <div class="kv">
              <dt>{{ 'tasks.refusal' | t }}</dt>
              <dd>
                <code>{{ t.refusal }}</code>
              </dd>
            </div>
          }
        </dl>

        @if (replay(); as rep) {
          <div class="replay" data-section="replay">
            <h3 class="replay__title">
              <ui-icon name="history" [size]="14" />
              {{ 'tasks.replay.title' | t }}
              @if (rep.truncated) {
                <ui-state-badge state="PARTIAL" />
              }
            </h3>
            <p class="muted">{{ 'tasks.replay.hint' | t }}</p>

            @switch (rep.state) {
              @case ('ready') {
                <div class="replay__controls">
                  <button
                    class="btn btn--mini"
                    data-action="prev"
                    [disabled]="replayIdx() <= 0"
                    (click)="replayIdx.set(replayIdx() - 1)"
                  >
                    {{ 'tasks.replay.prev' | t }}
                  </button>
                  <span class="muted">
                    {{
                      'tasks.replay.step' | t: { current: replayIdx() + 1, total: rep.steps.length }
                    }}
                  </span>
                  <button
                    class="btn btn--mini"
                    data-action="next"
                    [disabled]="replayIdx() >= rep.steps.length - 1"
                    (click)="replayIdx.set(replayIdx() + 1)"
                  >
                    {{ 'tasks.replay.next' | t }}
                  </button>
                </div>
                <ol class="replay__steps">
                  @for (e of rep.steps; track $index) {
                    <li
                      [attr.data-current]="$index === replayIdx() || null"
                      [attr.data-kind-tone]="statusKind(e.status)"
                    >
                      <button
                        class="replay__step"
                        type="button"
                        [attr.data-current]="$index === replayIdx() || null"
                        (click)="replayIdx.set($index)"
                      >
                        <code class="replay__kind">{{ e.kind }}</code>
                        <span class="replay__at">{{ fmtEventAt(e.at) }}</span>
                        <ui-state-badge [state]="statusKind(e.status)" [labelOverride]="e.status" />
                        @if (e.duration_ms !== null) {
                          <span class="num">{{ e.duration_ms }} ms</span>
                        }
                        <span class="replay__origin">{{ e.origin }}</span>
                        @if (e.detail) {
                          <span class="replay__detail">{{ e.detail }}</span>
                        }
                      </button>
                    </li>
                  }
                </ol>
              }
              @case ('empty') {
                <p class="muted" data-state="empty">{{ 'tasks.replay.empty' | t }}</p>
              }
              @case ('no-correlation') {
                <p class="muted" data-state="no-correlation">
                  {{ 'tasks.replay.noCorrelation' | t }}
                </p>
              }
              @case ('unavailable') {
                <p class="unv-cell" data-state="unavailable">
                  <ui-state-badge state="UNVERIFIED" />
                  <span class="muted">{{ 'tasks.replay.unavailable' | t }}</span>
                </p>
              }
            }
          </div>
        }
      </section>
    }
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
    /* -- execution timeline ------------------------------------- */
    .tl {
      display: grid;
      gap: 4px;
      margin-top: var(--space-3);
    }
    .tl__axis {
      display: flex;
      justify-content: space-between;
      font-size: var(--font-xs);
      color: var(--fg-muted);
      margin-left: 12rem;
      font-variant-numeric: tabular-nums;
    }
    .tl__row {
      display: grid;
      grid-template-columns: 12rem 1fr 5.5rem;
      align-items: center;
      gap: var(--space-2);
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      padding: 3px var(--space-2);
      cursor: pointer;
      width: 100%;
    }
    .tl__row:hover {
      background: var(--bg-hover);
    }
    .tl__row[data-selected] {
      border-color: var(--accent);
      background: var(--accent-bg);
    }
    .tl__label {
      font-size: var(--font-sm);
      font-weight: 550;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tl__track {
      position: relative;
      height: 14px;
      border-radius: var(--radius-pill);
      background: var(--bg);
      border: 1px solid var(--border);
      overflow: hidden;
    }
    .tl__bar {
      position: absolute;
      top: 0;
      bottom: 0;
      min-width: 3px;
      border-radius: var(--radius-pill);
      background: var(--bar-fg, var(--fg-muted));
    }
    .tl__bar[data-open] {
      background: repeating-linear-gradient(
        -45deg,
        var(--bar-fg, var(--fg-muted)) 0 3px,
        transparent 3px 6px
      );
      border-right: 2px dashed var(--bar-fg, var(--fg-muted));
    }
    .tl__bar[data-kind='supported'] {
      --bar-fg: var(--ok);
    }
    .tl__bar[data-kind='error'] {
      --bar-fg: var(--error);
    }
    .tl__bar[data-kind='warn'] {
      --bar-fg: var(--warn);
    }
    .tl__bar[data-kind='info'] {
      --bar-fg: var(--info);
    }
    .tl__dur {
      text-align: right;
    }
    .tl__dur,
    .tl__unplaced,
    .replay__at,
    .replay__origin {
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .tl__unplaced {
      margin: var(--space-2) 0 0;
    }
    /* -- task detail + replay ----------------------------------- */
    .detail {
      border-left: 3px solid var(--accent);
    }
    .detail__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .linklike {
      border: 0;
      background: none;
      padding: 0;
      font: inherit;
      font-weight: 550;
      color: var(--accent);
      cursor: pointer;
      text-align: left;
    }
    .linklike:hover {
      text-decoration: underline;
    }
    tr[data-selected] td {
      background: var(--accent-bg);
    }
    .replay {
      margin-top: var(--space-3);
      border-top: 1px solid var(--border);
      padding-top: var(--space-3);
    }
    .replay__title {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-1);
      font-size: var(--font-md);
    }
    .replay__title ui-icon {
      color: var(--accent);
    }
    .replay__controls {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: var(--space-2) 0;
    }
    .replay__steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 4px;
    }
    .replay__step {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      padding: var(--space-2) var(--space-3);
      cursor: pointer;
    }
    .replay__step:hover,
    .replay__step[data-current] {
      border-color: var(--accent);
    }
    .replay__step[data-current] {
      box-shadow: 0 0 0 1px var(--accent);
      background: var(--accent-bg);
    }
    .replay__kind {
      color: var(--accent);
    }
    .replay__at {
      font-variant-numeric: tabular-nums;
    }
    .replay__detail {
      flex-basis: 100%;
      font-size: var(--font-sm);
      color: var(--fg-muted);
      overflow-wrap: anywhere;
    }
    .unv-cell {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    #tl-h,
    .detail__head h2 {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    @media (max-width: 720px) {
      .tl__axis {
        margin-left: 0;
      }
      .tl__row {
        grid-template-columns: 1fr;
        gap: 2px;
      }
      .tl__dur {
        text-align: left;
      }
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

  /** Cycle 4 §7 — execution intelligence over the same real records:
   *  timeline derived from `started_at`/`finished_at`, and replay fed
   *  by /metrics events linked through the task's `correlation_id`.
   *  /metrics is an auxiliary source — its failure never blocks the
   *  page; the replay card reports `unavailable` instead. */
  readonly metricsSrc = new Source<MetricsReport>();
  readonly selectedId = signal<string | null>(null);
  readonly replayIdx = signal(0);

  readonly timeline = computed(() => buildTimeline(this.tasks()));
  readonly selectedTask = computed(
    () => this.tasks().find((t) => t.id === this.selectedId()) ?? null,
  );
  readonly replay = computed(() => buildReplay(this.metricsSrc.data(), this.selectedTask()));

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    const metricsCall = this.metricsSrc.load(() => this.api.metrics());
    try {
      this.tasks.set(await firstValueFrom(this.api.tasks()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
    await metricsCall;
  }

  /** Open the task detail + replay card — id-keyed so a history
   *  refresh after execute never keeps a stale object. */
  selectTask(t: TaskExecution): void {
    this.selectedId.set(t.id);
    this.replayIdx.set(0);
  }

  /** Axis/tooltip timestamp — localized from the recorded epoch ms. */
  fmtAt(ms: number | null): string {
    return ms === null ? '—' : new Date(ms).toLocaleString();
  }

  /** Event timestamp — localized; the raw value stays when unparsable
   *  (it is still real recorded data). */
  fmtEventAt(at: string): string {
    const ms = Date.parse(at);
    return Number.isNaN(ms) ? at : new Date(ms).toLocaleString();
  }

  /** Bar tooltip — recorded window only; open bars say so. */
  tipFor(r: { task: TaskExecution; startMs: number; endMs: number | null }): string {
    const start = this.fmtAt(r.startMs);
    const end = r.endMs === null ? '—' : this.fmtAt(r.endMs);
    return `${start} → ${end}`;
  }

  /** Badge tone for a free-form event/task status — same mapping the
   *  observability page uses; label stays verbatim. */
  statusKind(status: string): string {
    const s = (status || '').toLowerCase();
    if (['ok', 'done', 'completed', 'success', 'succeeded', 'pass', 'passed'].includes(s))
      return 'supported';
    if (['failed', 'fail', 'error', 'refused', 'denied'].includes(s)) return 'error';
    if (['skipped', 'cancelled', 'canceled', 'partial', 'degraded'].includes(s)) return 'warn';
    if (['running', 'pending', 'started', 'in_progress', 'planning', 'verifying'].includes(s))
      return 'info';
    return 'muted';
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

  /** finished_at − started_at, only when both real timestamps exist —
   *  pure derivation shared with the timeline (tasks.data.ts). */
  duration(t: TaskExecution): string {
    return fmtTaskDuration(t);
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
