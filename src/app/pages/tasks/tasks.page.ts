import { ElementRef } from '@angular/core';
import { Component, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  InstallationReceipt,
  InvestigationReceipt,
  MetricsEvent,
  MetricsReport,
  TaskExecution,
} from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { ForgeDoc, UiForgeDoc } from '../../shared/forge-doc';
import { UiSkeleton } from '../../shared/skeleton';
import { UiPager, pageSlice } from '../../shared/pager';
import { Source } from '../explorer/forges.data';
import { PfApi } from '../../pf/pf-api.service';
import { PfInvestigationImport, PfProduct } from '../../pf/pf.models';
import { buildReplay, buildTimeline, fmtTaskDuration } from './tasks.data';

interface PendingPlan {
  plan_token: string;
  plan: Record<string, unknown>;
  kind?: 'task' | 'investigation';
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
    RouterLink,
    TPipe,
    PageHeader,
    StateBadge,
    EmptyState,
    ErrorState,
    UiIcon,
    UiForgeDoc,
    UiSkeleton,
    UiPager,
  ],
  template: `
    <ui-page-header [title]="'tasks.title' | t" [subtitle]="'tasks.subtitle' | t" hintId="diagnose">
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
            #intentInput
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

    @if (newInvestigation() === '1') {
      <section class="card investigation-start" data-section="new-investigation">
        <h2>{{ 'tasks.newInvestigation' | t }}</h2>
        <p class="muted">{{ 'tasks.newInvestigation.hint' | t }}</p>
        <div class="investigation-grid">
          <div>
            <span class="lbl">{{ 'tasks.investigation.evidence' | t }}</span>
            <div
              class="evidence-list"
              role="group"
              [attr.aria-label]="'tasks.investigation.evidence' | t"
            >
              @for (item of investigationEvidence; track item.id) {
                <label class="evidence-choice">
                  <input
                    type="checkbox"
                    [checked]="investigationInputs().includes(item.id)"
                    (change)="toggleInvestigationInput(item.id)"
                    [disabled]="busy()"
                  />
                  <span>
                    <strong>{{ item.label }}</strong>
                    <small>{{ item.hint }}</small>
                  </span>
                </label>
              }
            </div>
          </div>
          <div class="investigation-safety">
            <span class="eyebrow">{{ 'tasks.investigation.safety' | t }}</span>
            <p class="muted">{{ 'tasks.investigation.safetyHint' | t }}</p>
            <code>LOCAL_READ · max 4 specialists</code>
          </div>
        </div>
        <button
          class="btn btn--primary investigation-cta"
          data-action="investigation-plan"
          [disabled]="busy() || !intent().trim()"
          (click)="plan()"
        >
          <ui-icon name="tasks" [size]="14" />
          {{ 'tasks.investigation.plan' | t }}
        </button>
      </section>
    }

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
        <h2>
          {{
            p.kind === 'investigation' ? ('tasks.investigation.planTitle' | t) : ('tasks.plan' | t)
          }}
        </h2>
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
          @if (p.kind === 'investigation') {
            <div class="kv">
              <dt>{{ 'tasks.investigation.evidence' | t }}</dt>
              <dd>{{ planList(p.plan, 'inputs') }}</dd>
            </div>
            <div class="kv">
              <dt>{{ 'tasks.investigation.safety' | t }}</dt>
              <dd>
                <code>{{ planList(p.plan, 'authorized_risks') }}</code>
              </dd>
            </div>
          }
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
            {{
              p.kind === 'investigation'
                ? ('tasks.investigation.execute' | t)
                : ('tasks.execute' | t)
            }}
          </button>
          <button class="btn" (click)="pending.set(null)">{{ 'state.cancel' | t }}</button>
        </div>
      </section>
    }

    @if (investigationReceipt(); as r) {
      <section
        class="card investigation-receipt"
        data-lift
        data-section="investigation-receipt"
        aria-live="polite"
      >
        <h2>{{ 'tasks.investigation.receipt' | t }}</h2>
        <p class="receipt__status">
          <ui-state-badge [state]="r.status" />
          <span class="muted">{{ r.path }}</span>
        </p>
        <p class="muted">{{ 'tasks.investigation.receiptHint' | t }}</p>
        <details class="raw">
          <summary>{{ 'fdoc.raw' | t }}</summary>
          <pre>{{ investigationReceiptText(r) }}</pre>
        </details>
        <div class="row">
          <button class="btn" data-action="export-investigation" (click)="exportInvestigation(r)">
            <ui-icon name="install" [size]="14" />
            {{ 'tasks.export' | t }}
          </button>
          <button class="btn" (click)="investigationReceipt.set(null)">
            {{ 'state.close' | t }}
          </button>
        </div>

        <section
          class="handoff"
          data-section="investigation-handoff"
          aria-labelledby="handoff-title"
        >
          <div>
            <h3 id="handoff-title">{{ 'tasks.investigation.handoff.title' | t }}</h3>
            <p class="muted">{{ 'tasks.investigation.handoff.hint' | t }}</p>
          </div>
          @if (pfProductsState() === 'idle') {
            <button
              class="btn"
              data-action="load-product-forge"
              [disabled]="pfBusy()"
              (click)="loadProductForgeProducts()"
            >
              <ui-icon name="search" [size]="14" />
              {{ 'tasks.investigation.handoff.findProducts' | t }}
            </button>
          } @else if (pfProductsState() === 'loading') {
            <p class="muted" role="status">{{ 'tasks.investigation.handoff.loading' | t }}</p>
          } @else if (pfProducts().length) {
            <div class="handoff__controls">
              <label class="lbl" for="handoff-product">{{
                'tasks.investigation.handoff.product' | t
              }}</label>
              <select
                id="handoff-product"
                class="input"
                [ngModel]="pfProductId()"
                (ngModelChange)="pfProductId.set($event)"
                [disabled]="pfBusy()"
              >
                <option value="">{{ 'tasks.investigation.handoff.choose' | t }}</option>
                @for (product of pfProducts(); track product.id) {
                  <option [value]="product.id">{{ product.name }} · {{ product.id }}</option>
                }
              </select>
              <button
                class="btn btn--primary"
                data-action="import-investigation"
                [disabled]="pfBusy() || !pfProductId()"
                (click)="importInvestigation(r)"
              >
                <ui-icon name="knowledge" [size]="14" />
                {{ 'tasks.investigation.handoff.import' | t }}
              </button>
            </div>
          } @else {
            <p class="muted" role="status">
              {{ 'tasks.investigation.handoff.unavailable' | t }}
              <a class="linklike" routerLink="/pf/settings">{{
                'tasks.investigation.handoff.settings' | t
              }}</a>
            </p>
          }
          @if (pfImportError(); as e) {
            <p class="refusal" role="alert">
              <code>{{ e.body.code }}</code> {{ e.body.message }}
            </p>
          }
          @if (pfImportResult(); as result) {
            <p class="handoff__success" role="status">
              <ui-state-badge state="supported" />
              {{ 'tasks.investigation.handoff.done' | t }}
              <a
                class="linklike"
                [routerLink]="['/pf/products', pfProductId()]"
                [queryParams]="{ tab: 'knowledge' }"
              >
                {{ 'tasks.investigation.handoff.open' | t }}
              </a>
              @if (result.suggested_obsidian_path) {
                <code>{{ result.suggested_obsidian_path }}</code>
              }
            </p>
          }
        </section>
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
              @for (r of pagedTlRows(); track r.task.id) {
                <!-- listitem wraps the button — <button> cannot carry
                     role="listitem" itself (axe aria-allowed-role) -->
                <div
                  class="tl__item"
                  role="listitem"
                  [attr.aria-setsize]="tl.rows.length"
                  [attr.aria-posinset]="tlSlice().start + $index + 1"
                >
                  <!-- no aria-label: accessible name = visible content
                       (axe label-content-name-mismatch) -->
                  <button
                    class="tl__row"
                    type="button"
                    [attr.data-selected]="selectedId() === r.task.id || null"
                    (click)="selectTask(r.task)"
                  >
                    <span class="tl__label" [attr.title]="r.task.label || r.task.verb">{{
                      r.task.label || r.task.verb
                    }}</span>
                    <span class="tl__track">
                      <span
                        class="tl__bar"
                        [attr.data-kind]="stageKind(r.task.stage)"
                        [attr.data-open]="r.endMs === null || null"
                        [style.left]="'clamp(0px, ' + r.leftPct + '%, calc(100% - 3px))'"
                        [style.width.%]="r.widthPct"
                        [title]="tipFor(r)"
                      ></span>
                    </span>
                    <span class="tl__dur num">{{ duration(r.task) }}</span>
                  </button>
                </div>
              }
            </div>
            <ui-pager
              [total]="tl.rows.length"
              [pageSize]="LIST_PAGE"
              [page]="tlSlice().page"
              [label]="'tasks.timeline.title' | t"
              (pageChange)="tlPage.set($event)"
            />
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
        <table class="table" [attr.aria-rowcount]="tasks().length + 1">
          <thead>
            <tr>
              <th scope="col">
                <span class="sr-only">{{ 'table.task' | t }}</span>
              </th>
              <th scope="col">{{ 'table.verb' | t }}</th>
              <th scope="col">{{ 'table.stage' | t }}</th>
              <th scope="col">{{ 'table.correlation' | t }}</th>
              <th scope="col">{{ 'table.duration' | t }}</th>
              <th scope="col">{{ 'table.exit' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (t of pagedTasks(); track t.id) {
              <tr
                [attr.data-selected]="selectedId() === t.id || null"
                [attr.aria-rowindex]="histSlice().start + $index + 2"
              >
                <td>
                  <!-- Real link, not a fake button: /tasks?task=<id> is
                       shareable and the route input selects the record. -->
                  <a
                    class="linklike"
                    data-action="inspect"
                    [routerLink]="['/tasks']"
                    [queryParams]="{ task: t.id }"
                  >
                    {{ t.label }}
                  </a>
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
        <ui-pager
          [total]="tasks().length"
          [pageSize]="LIST_PAGE"
          [page]="histSlice().page"
          [label]="'tasks.recent' | t"
          (pageChange)="histPage.set($event)"
        />
      } @else {
        @if (!loading()) {
          <ui-empty icon="tasks" [title]="'tasks.empty' | t" />
        }
      }
    </section>

    <!-- Task detail + recorded-events replay — opened from the timeline
         or the history table; every field comes from the task record. -->
    @if (selectedTask(); as t) {
      <section class="card detail fg-enter" data-section="task-detail" aria-live="polite">
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
              <!-- /observe?cid= is a real filter binding — only linked
                   when the record actually carries a correlation_id. -->
              @if (t.correlation_id; as cid) {
                <a
                  class="linklike corr__events"
                  data-action="correlated"
                  [routerLink]="['/observe']"
                  [queryParams]="{ cid }"
                >
                  {{ 'tasks.events' | t }}
                </a>
              }
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
                    (click)="stepReplay(-1)"
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
                    (click)="stepReplay(1)"
                  >
                    {{ 'tasks.replay.next' | t }}
                  </button>
                </div>
                <ol class="replay__steps">
                  @for (e of pagedReplaySteps(rep.steps); track e.i) {
                    <li
                      [attr.data-current]="e.i === replayIdx() || null"
                      [attr.data-kind-tone]="statusKind(e.step.status)"
                      [attr.aria-setsize]="rep.steps.length"
                      [attr.aria-posinset]="e.i + 1"
                    >
                      <button
                        class="replay__step"
                        type="button"
                        [attr.data-current]="e.i === replayIdx() || null"
                        (click)="replayIdx.set(e.i)"
                      >
                        <code class="replay__kind">{{ e.step.kind }}</code>
                        <span class="replay__at">{{ e.at }}</span>
                        <ui-state-badge
                          [state]="statusKind(e.step.status)"
                          [labelOverride]="e.step.status"
                        />
                        @if (e.step.duration_ms !== null) {
                          <span class="num">{{ e.step.duration_ms }} ms</span>
                        }
                        <span class="replay__origin">{{ e.step.origin }}</span>
                        @if (e.step.detail) {
                          <span class="replay__detail">{{ e.step.detail }}</span>
                        }
                      </button>
                    </li>
                  }
                </ol>
                <ui-pager
                  [total]="rep.steps.length"
                  [pageSize]="LIST_PAGE"
                  [page]="replaySlice(rep.steps.length).page"
                  [label]="'tasks.replay.title' | t"
                  (pageChange)="replayManual.set($event)"
                />
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
  /* Styles shared with the rest of the portal (.muted, .lbl, .num,
     .running, .raw, .actions base, .ops/.op, .plan-card, .intent-*,
     .linklike, .unv-cell, .stale, .refusal, tr[data-selected]) were
     consolidated into the "shared feature styles" section of
     src/styles.css — only page-local rules remain here. */
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
    .corr__events {
      font-size: var(--font-xs);
    }
    .limits {
      margin: var(--space-3) 0 0;
      font-size: var(--font-xs);
    }
    .receipt__status {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-3);
    }
    .actions {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
      margin: 0 0 var(--space-3);
      max-height: 200px;
      overflow: auto;
    }
    .actions li code {
      color: var(--accent-ink);
      flex: none;
    }
    .actions__kind {
      color: var(--fg-muted) !important;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-3);
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
      transition:
        background var(--motion-fast),
        border-color var(--motion-fast);
    }
    .tl__row:hover {
      background: var(--bg-hover);
    }
    .tl__row[data-selected] {
      border-color: var(--accent-ink);
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
      color: var(--accent-ink);
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
      transition:
        border-color var(--motion-fast),
        box-shadow var(--motion-fast),
        background var(--motion-fast);
    }
    .replay__step:hover,
    .replay__step[data-current] {
      border-color: var(--accent-ink);
    }
    .replay__step[data-current] {
      box-shadow: 0 0 0 1px var(--accent);
      background: var(--accent-bg);
    }
    .replay__kind {
      color: var(--accent-ink);
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
  private readonly pf = inject(PfApi);

  /** Route `?task=` deep-link (withComponentInputBinding) — dashboard
   *  rows, graph/knowledge inspectors and the history row links all
   *  land here. Applied once per distinct value so closing the detail
   *  card is never undone by a background refresh; an id that no
   *  record matches is consumed silently — never a fake selection. */
  readonly task = input('');
  /** Route `?new=1` opens the same canonical task flow as a guided entry point. */
  /** Public route input is `?new=1`; the property keeps the domain meaning. */
  readonly newInvestigation = input('', { alias: 'new' });
  private readonly intentInput = viewChild<ElementRef<HTMLInputElement>>('intentInput');

  readonly intent = signal('');
  readonly investigationInputs = signal<string[]>(['runtime_log']);
  readonly investigationReceipt = signal<InvestigationReceipt | null>(null);
  readonly pfProducts = signal<PfProduct[]>([]);
  readonly pfProductId = signal('');
  readonly pfProductsState = signal<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  readonly pfImportResult = signal<PfInvestigationImport | null>(null);
  readonly pfImportError = signal<ApiError | null>(null);
  readonly pfBusy = signal(false);
  readonly investigationEvidence = [
    {
      id: 'runtime_log',
      label: 'Runtime logs',
      hint: 'Use logs already available in the workspace.',
    },
    {
      id: 'spark_event_log',
      label: 'Spark event log',
      hint: 'Include Spark event evidence when present.',
    },
    {
      id: 'configuration',
      label: 'Configuration',
      hint: 'Let specialists inspect local configuration metadata.',
    },
  ] as const;
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
  /** Last ?task= value already applied — prevents the effect from
   *  re-opening a detail the user closed while the param stays put. */
  private readonly deepApplied = signal<string | null>(null);

  /** Cycle 4 §7 paging — history table, timeline rows and detail replay
   *  steps render page-size slices so a growing task_log stays bounded
   *  in the DOM. `replayManual` holds a user-picked replay page; unset,
   *  the page follows replayIdx so transport keeps the step in view. */
  readonly histPage = signal(0);
  readonly tlPage = signal(0);
  readonly replayManual = signal<number | null>(null);
  readonly LIST_PAGE = 50;

  readonly timeline = computed(() => buildTimeline(this.tasks()));
  readonly selectedTask = computed(
    () => this.tasks().find((t) => t.id === this.selectedId()) ?? null,
  );
  readonly replay = computed(() => buildReplay(this.metricsSrc.data(), this.selectedTask()));

  /** History-table slice. */
  readonly histSlice = computed(() =>
    pageSlice(this.tasks().length, this.LIST_PAGE, this.histPage()),
  );
  readonly pagedTasks = computed(() =>
    this.tasks().slice(this.histSlice().start, this.histSlice().end),
  );

  /** Timeline slice — group rows stay bounded at any record count. */
  readonly tlSlice = computed(() =>
    pageSlice(this.timeline().rows.length, this.LIST_PAGE, this.tlPage()),
  );
  readonly pagedTlRows = computed(() =>
    this.timeline().rows.slice(this.tlSlice().start, this.tlSlice().end),
  );

  /** Replay-step slice — the page follows replayIdx unless the user
   *  paged away manually. */
  replaySlice(total: number) {
    const manual = this.replayManual();
    const page = manual ?? Math.floor(this.replayIdx() / this.LIST_PAGE);
    return pageSlice(total, this.LIST_PAGE, page);
  }

  /** Replay transport — a manual page pick yields to the step so the
   *  current marker is never paged out of view. */
  stepReplay(delta: number): void {
    this.replayManual.set(null);
    const steps = this.replay()?.steps ?? [];
    const next = this.replayIdx() + delta;
    this.replayIdx.set(Math.max(0, Math.min(next, steps.length - 1)));
  }

  /** The visible replay steps tagged with their real global index —
   *  `data-current` and step numbering stay honest across pages. */
  pagedReplaySteps(
    steps: readonly MetricsEvent[],
  ): { step: MetricsEvent; i: number; at: string }[] {
    const s = this.replaySlice(steps.length);
    return steps.slice(s.start, s.end).map((step, i) => ({
      step,
      i: s.start + i,
      at: this.fmtEventAt(step.at),
    }));
  }

  constructor() {
    // The dashboard entry point is a focus aid, not a second workflow. The
    // existing plan/review/execute lifecycle remains the only task state
    // machine and the focus is applied only for a fresh-investigation link.
    effect(() => {
      if (this.newInvestigation() !== '1') return;
      const input = this.intentInput();
      if (input) queueMicrotask(() => input.nativeElement.focus());
    });
    // Deep link: once the records answer, a new ?task= value selects its
    // row (same path as a row click — detail + replay reset together).
    effect(() => {
      const id = this.task();
      if (!id || id === this.deepApplied() || this.loading()) return;
      this.deepApplied.set(id);
      if (this.tasks().some((t) => t.id === id)) {
        this.selectedId.set(id);
        this.replayIdx.set(0);
      }
    });
    // Data changes re-slice the windows — reset every pager so a stale
    // offset can never render an empty view.
    effect(() => {
      this.tasks();
      this.histPage.set(0);
      this.tlPage.set(0);
    });
    effect(() => {
      this.replay();
      this.replayManual.set(null);
    });
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
    this.pfImportResult.set(null);
    this.pfImportError.set(null);
    try {
      const investigation = this.newInvestigation() === '1';
      const r = investigation
        ? await firstValueFrom(
            this.api.investigationPlan({
              intent: this.intent(),
              inputs: this.investigationInputs(),
            }),
          )
        : await firstValueFrom(this.api.tasksPlan({ intent: this.intent() }));
      const cid = (r as Record<string, unknown>)['correlation_id'];
      this.pending.set({
        plan_token: r.plan_token,
        plan: r.plan as Record<string, unknown>,
        kind: investigation ? 'investigation' : 'task',
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
      if (plan['operation'] === 'federated_investigation') {
        this.investigationReceipt.set(
          await firstValueFrom(this.api.investigationRun(plan, planToken)),
        );
        this.pfProducts.set([]);
        this.pfProductId.set('');
        this.pfProductsState.set('idle');
        this.pfImportResult.set(null);
        this.pfImportError.set(null);
      } else {
        this.receipt.set(await firstValueFrom(this.api.tasksExecute(plan, planToken)));
      }
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

  toggleInvestigationInput(id: string): void {
    const current = this.investigationInputs();
    this.investigationInputs.set(
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  planList(plan: Record<string, unknown>, key: string): string {
    const value = plan[key];
    return Array.isArray(value) && value.length ? value.map(String).join(', ') : '—';
  }

  investigationReceiptText(r: InvestigationReceipt): string {
    return JSON.stringify(r, null, 2);
  }

  exportInvestigation(r: InvestigationReceipt): void {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'investigation-receipt.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async loadProductForgeProducts(): Promise<void> {
    if (this.pfBusy() || this.pfProductsState() === 'loading') return;
    this.pfBusy.set(true);
    this.pfProductsState.set('loading');
    this.pfImportError.set(null);
    try {
      const result = await firstValueFrom(this.pf.products());
      this.pfProducts.set(result.items ?? []);
      this.pfProductsState.set('ready');
    } catch (e) {
      this.pfProducts.set([]);
      this.pfProductsState.set('unavailable');
      this.pfImportError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.pfBusy.set(false);
    }
  }

  async importInvestigation(r: InvestigationReceipt): Promise<void> {
    const productId = this.pfProductId();
    if (this.pfBusy() || !productId || !r.report || typeof r.report !== 'object') return;
    this.pfBusy.set(true);
    this.pfImportError.set(null);
    try {
      this.pfImportResult.set(
        await firstValueFrom(this.pf.importInvestigation(productId, r.report, 'internal')),
      );
    } catch (e) {
      this.pfImportError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.pfBusy.set(false);
    }
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
