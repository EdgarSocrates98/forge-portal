import { Component, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  ComponentId,
  ExecutionProfile,
  HostDetection,
  HostId,
  InstallationReceipt,
  TaskExecution,
} from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { ErrorState } from '../../shared/error-state';
import { EmptyState } from '../../shared/empty-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { ConfirmService } from '../../shared/confirm-dialog';

/**
 * Installation Center — the exact 9-step contract:
 *   1 Discover · 2 Select · 3 Configure · 4 Plan · 5 Review diff ·
 *   6 Confirm · 7 Execute · 8 Verify · 9 Receipt.
 * Steps 4→6→7 are gated by the phase machine: the plan_token only
 * enters the flow at Execute, after review AND an explicit confirm
 * click. Repair/uninstall run as quick ops confirmed through
 * ConfirmService; "update" has no dedicated adapter op, so it is
 * rendered UNVERIFIED instead of being faked by another route.
 */
type Phase =
  | 'idle'
  | 'planning'
  | 'review'
  | 'confirming'
  | 'executing'
  | 'verifying'
  | 'receipt'
  | 'refused'
  | 'error';

type QuickOp = 'repair' | 'uninstall';

interface DiffRow {
  path: string;
  before: string | null;
  after: string | null;
}

interface HostChoice {
  id: string;
  label?: string;
  labelKey?: string;
}

@Component({
  selector: 'page-install',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, ErrorState, EmptyState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'install.title' | t" [subtitle]="'install.subtitle' | t">
      <button class="btn" [disabled]="busy()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <section class="card">
      <ol class="stepper" [attr.aria-label]="'install.title' | t">
        @for (s of stepKeys; track s; let i = $index) {
          <li
            class="stepper__step"
            [attr.data-state]="stepState(i)"
            [attr.aria-current]="i === stepIndex() ? 'step' : null"
          >
            <span class="stepper__dot" aria-hidden="true">
              @if (stepState(i) === 'done') {
                <ui-icon name="check" [size]="13" />
              } @else if (stepState(i) === 'warn') {
                <ui-icon name="alert" [size]="13" />
              } @else {
                {{ i + 1 }}
              }
            </span>
            <span class="stepper__label">{{ s | t }}</span>
          </li>
        }
      </ol>
    </section>

    <!-- Step 1 · Discover — everything below is backend-reported state. -->
    <section class="card discover" aria-labelledby="discover-h">
      <div class="card__heading">
        <h2 id="discover-h">
          <span class="stepnum" aria-hidden="true">1</span>{{ 'install.step.discover' | t }}
        </h2>
        @if (store.health(); as h) {
          <ui-state-badge [state]="h.state" />
        }
      </div>

      @if (store.health(); as h) {
        <dl class="discover__kv">
          <div>
            <dt>{{ 'dashboard.workspace' | t }}</dt>
            <dd>{{ h.workspace ?? ('dashboard.noWorkspace' | t) }}</dd>
          </div>
          <div>
            <dt>{{ 'dashboard.profile' | t }}</dt>
            <dd>{{ h.profile ?? ('state.unknown' | t) }}</dd>
          </div>
          <div>
            <dt>{{ 'install.receipt.status' | t }}</dt>
            <dd>{{ h.updated_at ?? ('state.unknown' | t) }}</dd>
          </div>
        </dl>
        @if (h.checks.length) {
          <ul class="checks">
            @for (c of h.checks; track c.id) {
              <li>
                <ui-state-badge [state]="c.state" [labelOverride]="c.id" />
                @if (c.detail) {
                  <small class="muted">{{ c.detail }}</small>
                }
              </li>
            }
          </ul>
        }
        @if (h.forge_portal; as fp) {
          <div class="portal-row" [attr.data-state]="fp.state">
            <ui-icon name="gem" [size]="15" />
            <span class="portal-row__body">
              <strong>{{ 'install.portal.' + fp.state | t }}</strong>
              <small class="mono">{{
                fp.install_root || fp.manifest || ('install.portal.vendored.hint' | t)
              }}</small>
            </span>
          </div>
        }
      } @else {
        <ui-skeleton kind="row" [lines]="2" />
      }

      <h3 class="subhead">{{ 'install.discover.hosts' | t }}</h3>
      @if (hostDetections(); as detected) {
        @if (detected.length) {
          <ul class="hostlist">
            @for (d of detected; track d.host) {
              <li>
                <strong>{{ d.host }}</strong>
                <ui-state-badge [state]="d.integration" />
                <span class="muted">{{
                  (d.detected ? 'hosts.detected' : 'hostState.NOT_DETECTED') | t
                }}</span>
              </li>
            }
          </ul>
        } @else {
          <p class="muted">{{ 'hosts.notDetected' | t }}</p>
        }
      } @else {
        <ui-skeleton kind="row" [lines]="2" />
      }
    </section>

    <div class="config-grid">
      <section class="card">
        <!-- Step 2 · Select — scope + components -->
        <h2><span class="stepnum" aria-hidden="true">2</span>{{ 'install.step.select' | t }}</h2>
        <h3 class="subhead">{{ 'install.scope' | t }}</h3>
        <div class="scopes" role="radiogroup" [attr.aria-label]="'install.scope' | t">
          @for (s of scopes; track s.id) {
            <label class="scope" [attr.data-active]="scope() === s.id || null">
              <input
                type="radio"
                name="scope"
                [value]="s.id"
                [checked]="scope() === s.id"
                [disabled]="locked()"
                (change)="scope.set(s.id)"
              />
              <span>
                <strong>{{ s.label | t }}</strong>
                <small>{{ s.hint | t }}</small>
              </span>
            </label>
          }
        </div>

        <h3 class="subhead">{{ 'install.components' | t }}</h3>
        <div class="comps">
          @for (c of components; track c.id) {
            <label class="comp" [attr.data-active]="selected().has(c.id) || null">
              <input
                type="checkbox"
                [checked]="selected().has(c.id)"
                [disabled]="locked()"
                (change)="toggle(c.id)"
              />
              <span>{{ c.id }}</span>
            </label>
          }
        </div>

        <!-- Step 3 · Configure — hosts + profiles -->
        <h2><span class="stepnum" aria-hidden="true">3</span>{{ 'install.step.configure' | t }}</h2>
        <h3 class="subhead">{{ 'install.hosts' | t }}</h3>
        <p class="muted">{{ 'install.hosts.hint' | t }}</p>
        <div class="scopes" role="radiogroup" [attr.aria-label]="'install.hosts' | t">
          @for (h of hostChoices; track h.id) {
            <label class="scope" [attr.data-active]="host() === h.id || null">
              <input
                type="radio"
                name="host"
                [value]="h.id"
                [checked]="host() === h.id"
                [disabled]="locked()"
                (change)="host.set(h.id)"
              />
              <span>
                <strong>{{ h.labelKey ? (h.labelKey | t) : h.label }}</strong>
                <small>{{ hostState(h.id) }}</small>
              </span>
            </label>
          }
        </div>

        <h3 class="subhead">{{ 'install.profile' | t }}</h3>
        <div class="scopes" role="radiogroup" [attr.aria-label]="'install.profile' | t">
          @for (p of profiles; track p.id) {
            <label class="scope" [attr.data-active]="profile() === p.id || null">
              <input
                type="radio"
                name="profile"
                [value]="p.id"
                [checked]="profile() === p.id"
                [disabled]="locked()"
                (change)="profile.set(p.id)"
              />
              <span>
                <strong>{{ p.label | t }}</strong>
                <small>{{ p.hint | t }}</small>
              </span>
            </label>
          }
        </div>

        <h3 class="subhead">{{ 'install.executionProfile' | t }}</h3>
        <div class="scopes" role="radiogroup" [attr.aria-label]="'install.executionProfile' | t">
          @for (p of executionProfiles; track p.id) {
            <label class="scope" [attr.data-active]="executionProfile() === p.id || null">
              <input
                type="radio"
                name="execution-profile"
                [value]="p.id"
                [checked]="executionProfile() === p.id"
                [disabled]="locked()"
                (change)="executionProfile.set(p.id)"
              />
              <span>
                <strong>{{ p.label | t }}</strong>
                <small>{{ p.hint | t }}</small>
              </span>
            </label>
          }
        </div>
      </section>

      <aside class="card summary">
        <h2>{{ 'install.summary' | t }}</h2>
        <dl class="summary__kv">
          <div>
            <dt>{{ 'install.summary.scope' | t }}</dt>
            <dd>{{ scopeLabel() | t }}</dd>
          </div>
          <div>
            <dt>{{ 'install.summary.host' | t }}</dt>
            <dd>{{ hostLabel() }}</dd>
          </div>
          <div>
            <dt>{{ 'install.summary.profile' | t }}</dt>
            <dd>{{ profileLabel() | t }}</dd>
          </div>
          <div>
            <dt>{{ 'install.summary.executionProfile' | t }}</dt>
            <dd>{{ executionProfileLabel() | t }}</dd>
          </div>
          <div>
            <dt>{{ 'install.summary.components' | t }}</dt>
            <dd>
              @if (selected().size) {
                <span class="summary__comps">
                  @for (c of selected(); track c) {
                    <code class="summary__chip">{{ c }}</code>
                  }
                </span>
              } @else {
                <span class="muted">{{ 'install.summary.empty' | t }}</span>
              }
            </dd>
          </div>
        </dl>
        <!-- Step 4 · Plan -->
        <button
          class="btn btn--primary"
          [disabled]="locked() || busy() || !selected().size"
          (click)="plan()"
        >
          <ui-icon name="install" [size]="15" />
          {{ 'install.plan' | t }}
        </button>
        <p class="muted">{{ 'install.flow.hint' | t }}</p>
      </aside>
    </div>

    <!-- Step 4 · planning in flight -->
    @if (phase() === 'planning') {
      <section class="card running" role="status" aria-live="polite">
        <div class="running__spinner" aria-hidden="true"></div>
        <p class="muted">{{ 'install.planning' | t }}</p>
      </section>
    }

    <!-- Step 5 · Review diff -->
    @if (phase() === 'review' && planReceipt(); as r) {
      <section class="card plan" data-lift>
        <div class="card__heading">
          <h2>
            <span class="stepnum" aria-hidden="true">5</span>{{ 'install.step.reviewDiff' | t }}
          </h2>
          <ui-state-badge [state]="r.status" />
        </div>
        <p class="muted">
          {{ 'install.plan.changes' | t: { count: r.actions?.length ?? 0 } }}
        </p>

        @if (diffRows(); as rows) {
          @if (rows.length) {
            <ul class="diff">
              @for (d of rows; track d.path) {
                <li class="diff__row">
                  <code class="diff__path">{{ d.path }}</code>
                  <span class="diff__pair">
                    <del class="diff__before">{{ d.before ?? '—' }}</del>
                    <ui-icon name="chevron-right" [size]="13" />
                    <ins class="diff__after">{{ d.after ?? '—' }}</ins>
                  </span>
                </li>
              }
            </ul>
          } @else {
            <p class="diff-none" role="note">
              <ui-icon name="alert" [size]="14" />
              {{ 'install.diff.none' | t }}
            </p>
          }
        }

        @if (r.actions?.length) {
          <h3 class="subhead">{{ 'federation.actions' | t }}</h3>
          <ul class="actions">
            @for (a of r.actions; track $index) {
              <li>
                <code>{{ a.kind }}</code>
                <code class="actions__status">{{ a.status }}</code>
                <span>{{ a.path }}</span>
              </li>
            }
          </ul>
        }

        @if (r.plan) {
          <details class="raw">
            <summary>{{ 'fdoc.raw' | t }}</summary>
            <pre>{{ planText(r.plan) }}</pre>
          </details>
        }

        <div class="row">
          <button class="btn btn--primary" (click)="proceedToConfirm()">
            <ui-icon name="shield-check" [size]="15" />
            {{ 'install.confirm.next' | t }}
          </button>
          <button class="btn" (click)="reset()">{{ 'state.cancel' | t }}</button>
        </div>
      </section>
    }

    <!-- Step 6 · Confirm — explicit typed confirmation, plan_token stays server-side evidence -->
    @if (phase() === 'confirming' && planReceipt(); as r) {
      <section class="card confirm" data-lift>
        <h2><span class="stepnum" aria-hidden="true">6</span>{{ 'install.step.confirm' | t }}</h2>
        <p class="muted">{{ 'install.confirm.hint' | t }}</p>
        <dl class="summary__kv">
          <div>
            <dt>{{ 'install.summary.scope' | t }}</dt>
            <dd>{{ scopeLabel() | t }}</dd>
          </div>
          <div>
            <dt>{{ 'install.summary.host' | t }}</dt>
            <dd>{{ hostLabel() }}</dd>
          </div>
          <div>
            <dt>{{ 'install.summary.profile' | t }}</dt>
            <dd>{{ profileLabel() | t }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.actions' | t }}</dt>
            <dd>{{ r.actions?.length ?? 0 }}</dd>
          </div>
        </dl>
        <div class="row">
          <button class="btn btn--primary" (click)="confirmExecute()">
            <ui-icon name="shield-check" [size]="15" />
            {{ 'install.confirm.execute' | t }}
          </button>
          <button class="btn" (click)="backToReview()">{{ 'install.confirm.back' | t }}</button>
          <button class="btn" (click)="reset()">{{ 'state.cancel' | t }}</button>
        </div>
      </section>
    }

    <!-- Step 7 · Execute -->
    @if (phase() === 'executing') {
      <section class="card running" role="status" aria-live="polite">
        <div class="running__spinner" aria-hidden="true"></div>
        <p class="muted">{{ 'install.running' | t }}</p>
      </section>
    }

    <!-- Step 8 · Verify — auto-refresh + receipt checks; UNVERIFIED when the backend sends none -->
    @if (phase() === 'verifying') {
      <section class="card running" role="status" aria-live="polite">
        <div class="running__spinner" aria-hidden="true"></div>
        <p class="muted">{{ 'install.verify.running' | t }}</p>
      </section>
    }

    @if (phase() === 'receipt' && result() && !result()!.refusal) {
      <section class="card verify">
        <h2><span class="stepnum" aria-hidden="true">8</span>{{ 'install.step.verify' | t }}</h2>
        <div class="verify__row">
          @if (store.health(); as h) {
            <ui-state-badge [state]="h.state" />
          }
          @if (result()!.checks?.length) {
            <ul class="checks">
              @for (c of result()!.checks!; track $index) {
                <li>
                  <ui-state-badge
                    [state]="c.status ?? 'unverified'"
                    [labelOverride]="c.status ?? null"
                  />
                  <code>{{ c.id ?? '—' }}</code>
                  @if (c.detail) {
                    <small class="muted">{{ c.detail }}</small>
                  }
                  @if (c.repairable) {
                    <span class="repairable">{{ 'fdoc.repairable' | t }}</span>
                  }
                </li>
              }
            </ul>
          } @else {
            <p class="unverified">
              <ui-state-badge state="unverified" />
              {{ 'install.verify.unverified' | t }}
            </p>
          }
        </div>
      </section>
    }

    <!-- Step 9 · Receipt -->
    @if ((phase() === 'receipt' || phase() === 'refused') && result(); as r) {
      <section class="card receipt" data-lift>
        <div class="card__heading">
          <h2><span class="stepnum" aria-hidden="true">9</span>{{ 'install.step.receipt' | t }}</h2>
          <ui-state-badge [state]="r.status" />
        </div>
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
                <code>{{ a.status }}</code>
                <span>{{ a.path }}</span>
              </li>
            }
          </ul>
        }
        <div class="row">
          <button class="btn" [disabled]="busy()" (click)="reinstall()">
            <ui-icon name="refresh" [size]="15" />
            {{ 'install.reinstall' | t }}
          </button>
          <button class="btn" [disabled]="busy()" (click)="reset()">
            {{ 'install.newPlan' | t }}
          </button>
        </div>
      </section>
    }

    @if (phase() === 'error') {
      <ui-error [error]="error()" (retry)="reset()" />
    }

    <!-- Operations — repair/uninstall are real adapter ops confirmed via
         ConfirmService; update has no dedicated op, so it is UNVERIFIED. -->
    <section class="card ops" aria-labelledby="ops-h">
      <h2 id="ops-h">{{ 'install.ops.title' | t }}</h2>
      <ul class="ops__list">
        <li class="op">
          <span class="op__body">
            <strong>{{ 'install.repair' | t }}</strong>
            <small class="muted">{{ 'install.ops.repair.hint' | t }}</small>
          </span>
          <button class="btn" [disabled]="busy()" (click)="repair()">
            <ui-icon name="refresh" [size]="15" />
            {{ 'install.repair' | t }}
          </button>
        </li>
        <li class="op" data-state="unverified">
          <span class="op__body">
            <strong>{{ 'install.ops.update' | t }}</strong>
            <small class="muted">{{ 'install.ops.update.hint' | t }}</small>
          </span>
          <ui-state-badge state="unverified" />
        </li>
        <li class="op">
          <span class="op__body">
            <strong>{{ 'install.uninstall' | t }}</strong>
            <small class="muted">{{ 'install.uninstall.confirm' | t }}</small>
          </span>
          <button class="btn btn--danger" [disabled]="busy()" (click)="uninstall()">
            <ui-icon name="alert" [size]="15" />
            {{ 'install.uninstall' | t }}
          </button>
        </li>
      </ul>

      @if (opBusy()) {
        <div class="running" role="status" aria-live="polite">
          <div class="running__spinner" aria-hidden="true"></div>
          <p class="muted">{{ 'install.running' | t }}</p>
        </div>
      }
      @if (opError(); as e) {
        <ui-error [error]="e" (retry)="opError.set(null)" />
      }
      @if (opReceipt(); as op) {
        <div class="op-receipt">
          <p class="op-receipt__head">
            <strong>{{ opLabel(op.op) | t }}</strong>
            <ui-state-badge [state]="op.r.status" />
            @if (op.r.detail) {
              <span class="muted">{{ op.r.detail }}</span>
            }
          </p>
          @if (op.r.refusal) {
            <p class="refusal">
              <code>{{ op.r.refusal }}</code>
              @if (op.r.unlock) {
                — {{ op.r.unlock }}
              }
            </p>
          }
          @if (op.r.actions?.length) {
            <ul class="actions">
              @for (a of op.r.actions; track $index) {
                <li>
                  <code>{{ a.status }}</code>
                  <span>{{ a.path }}</span>
                </li>
              }
            </ul>
          }
        </div>
      }
    </section>

    <!-- Operation history — read-only recent executions from the adapter. -->
    <section class="card history" aria-labelledby="history-h">
      <h2 id="history-h">{{ 'tasks.recent' | t }}</h2>
      @if (history(); as items) {
        @if (items.length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'table.task' | t }}</th>
                <th scope="col">{{ 'table.verb' | t }}</th>
                <th scope="col">{{ 'table.stage' | t }}</th>
                <th scope="col">{{ 'table.exit' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (t of items; track t.id) {
                <tr>
                  <td>{{ t.label }}</td>
                  <td>
                    <code>{{ t.verb }}</code>
                  </td>
                  <td><ui-state-badge [state]="stageKind(t.stage)" [labelOverride]="t.stage" /></td>
                  <td>{{ t.exit_code ?? '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <ui-empty icon="tasks" [title]="'tasks.empty' | t" />
        }
      } @else {
        <ui-skeleton kind="row" [lines]="3" />
      }
    </section>
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    .card h2 {
      margin: var(--space-3) 0;
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .card h2:first-child {
      margin-top: 0;
    }
    .card__heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .card__heading h2 {
      margin-bottom: var(--space-2);
    }
    .stepnum {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      flex: none;
      border-radius: 50%;
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent-ink);
      background: var(--accent-bg);
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    }
    .subhead {
      margin: var(--space-4) 0 var(--space-2);
      font-size: var(--font-sm);
      font-weight: 650;
      color: var(--fg-muted);
    }
    .discover__kv {
      display: grid;
      gap: var(--space-2);
      margin: 0 0 var(--space-3);
    }
    .discover__kv > div {
      display: flex;
      justify-content: space-between;
      gap: var(--space-3);
      font-size: var(--font-sm);
    }
    .discover__kv dt {
      color: var(--fg-muted);
    }
    .discover__kv dd {
      margin: 0;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .checks {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--space-3);
      display: grid;
      gap: 6px;
    }
    .checks li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .hostlist {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 6px;
    }
    .hostlist li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: 6px var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }
    .hostlist strong {
      text-transform: capitalize;
      min-width: 72px;
    }
    .config-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 320px);
      gap: var(--space-4);
      align-items: start;
    }
    .summary {
      position: sticky;
      top: calc(var(--topbar-h) + var(--space-4));
    }
    .summary__kv {
      display: grid;
      gap: var(--space-2);
      margin: 0 0 var(--space-4);
    }
    .summary__kv > div {
      display: flex;
      justify-content: space-between;
      gap: var(--space-3);
      padding-bottom: var(--space-2);
      border-bottom: 1px solid var(--border);
      font-size: var(--font-sm);
    }
    .summary__kv > div:last-child {
      border-bottom: 0;
    }
    .summary__kv dt {
      color: var(--fg-muted);
    }
    .summary__kv dd {
      margin: 0;
      font-weight: 600;
      text-align: right;
    }
    .summary__comps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      justify-content: flex-end;
    }
    .summary__chip {
      padding: 2px var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--accent-bg);
      color: var(--accent-ink);
      font-family: var(--font-mono);
      font-size: var(--font-xs);
      font-weight: 600;
    }
    .running {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      margin-top: var(--space-3);
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
      border-top-color: var(--accent-ink);
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
    .diff {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--space-3);
      display: grid;
      gap: 6px;
      max-height: 320px;
      overflow: auto;
    }
    .diff__row {
      display: grid;
      gap: 4px;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg);
    }
    .diff__path {
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .diff__pair {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
      font-family: var(--font-mono);
      font-size: var(--font-xs);
    }
    .diff__before {
      color: var(--error);
      text-decoration: line-through;
      overflow-wrap: anywhere;
    }
    .diff__after {
      color: var(--ok);
      text-decoration: none;
      overflow-wrap: anywhere;
    }
    .diff-none {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--warn);
      font-size: var(--font-sm);
    }
    .actions {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
      max-height: 240px;
      overflow: auto;
      display: grid;
      gap: 6px;
      list-style: none;
      padding: 0;
    }
    .actions li {
      display: flex;
      gap: var(--space-2);
      overflow-wrap: anywhere;
    }
    .actions li code {
      color: var(--accent-ink);
      flex: none;
    }
    .actions__status {
      color: var(--fg-muted) !important;
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
    .verify__row {
      display: grid;
      gap: var(--space-3);
    }
    .unverified {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0;
      color: var(--warn);
      font-weight: 550;
    }
    .repairable {
      color: var(--accent-ink);
      font-size: var(--font-xs);
      font-weight: 650;
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
    .op-receipt {
      margin-top: var(--space-3);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg);
    }
    .op-receipt__head {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin: 0 0 var(--space-2);
    }
    .scopes {
      display: grid;
      gap: var(--space-2);
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    }
    .scope {
      display: flex;
      gap: var(--space-2);
      align-items: flex-start;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      cursor: pointer;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast),
        box-shadow var(--motion-fast);
    }
    .scope:hover {
      border-color: var(--border-strong);
      background: var(--bg-hover);
    }
    .scope:focus-within {
      border-color: var(--fg-focus);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg-focus) 22%, transparent);
    }
    .scope[data-active] {
      border-color: color-mix(in srgb, var(--accent) 55%, transparent);
      background: var(--accent-bg);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
    }
    .scope small {
      display: block;
      color: var(--fg-muted);
    }
    .scope input[type='radio'] {
      accent-color: var(--accent-ink);
      margin-top: 2px;
    }
    .scope input[disabled],
    .comp input[disabled] {
      cursor: not-allowed;
    }
    .comps {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }
    .comp {
      display: flex;
      gap: 6px;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      padding: 4px var(--space-3);
      font-size: var(--font-sm);
      cursor: pointer;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast);
    }
    .comp:hover {
      border-color: var(--border-strong);
      background: var(--bg-hover);
    }
    .comp:focus-within {
      border-color: var(--fg-focus);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--fg-focus) 22%, transparent);
    }
    .comp input[type='checkbox'] {
      accent-color: var(--accent-ink);
    }
    .comp[data-active] {
      border-color: color-mix(in srgb, var(--accent) 55%, transparent);
      background: var(--accent-bg);
      font-weight: 600;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-4);
    }
    .refusal {
      color: var(--warn);
    }
    .muted {
      color: var(--fg-muted);
    }
    .mono {
      font-family: var(--font-mono);
    }
    @media (max-width: 880px) {
      .config-grid {
        grid-template-columns: 1fr;
      }
      .summary {
        position: static;
      }
    }
  `,
})
export class InstallPage {
  private readonly api = inject(PortalApi);
  private readonly i18n = inject(I18nService);
  private readonly confirm = inject(ConfirmService);
  readonly store = inject(PortalStore);

  readonly phase = signal<Phase>('idle');
  /** Furthest step the current flow actually reached — drives done/warn
   *  markers so a refused plan never pretends to be a finished install. */
  private readonly reached = signal(0);
  private readonly failedAt = signal(0);
  readonly scope = signal<'project' | 'workspace' | 'user'>('project');
  readonly host = signal<string>('all');
  readonly profile = signal<'minimal' | 'recommended' | 'full'>('recommended');
  readonly executionProfile = signal<ExecutionProfile>('balanced');
  /** `null` = still loading; `[]` = backend answered with no detections. */
  readonly hostDetections = signal<HostDetection[] | null>(null);
  readonly selected = signal<Set<string>>(new Set(['skills', 'agents', 'mcp']));
  readonly planReceipt = signal<InstallationReceipt | null>(null);
  readonly result = signal<InstallationReceipt | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly history = signal<TaskExecution[] | null>(null);
  readonly opBusy = signal<QuickOp | null>(null);
  readonly opReceipt = signal<{ op: QuickOp; r: InstallationReceipt } | null>(null);
  readonly opError = signal<ApiError | null>(null);

  readonly busy = computed(
    () => ['planning', 'executing', 'verifying'].includes(this.phase()) || this.opBusy() !== null,
  );
  /** Selection is editable only while the flow is in the setup steps. */
  readonly locked = computed(() => this.phase() !== 'idle');

  readonly stepKeys = [
    'install.step.discover',
    'install.step.select',
    'install.step.configure',
    'install.step.plan',
    'install.step.reviewDiff',
    'install.step.confirm',
    'install.step.execute',
    'install.step.verify',
    'install.step.receipt',
  ] as const;

  stepIndex(): number {
    switch (this.phase()) {
      case 'planning':
        return 3;
      case 'review':
        return 4;
      case 'confirming':
        return 5;
      case 'executing':
        return 6;
      case 'verifying':
        return 7;
      case 'receipt':
      case 'refused':
        return 8;
      case 'error':
        return this.failedAt();
      default:
        return 2;
    }
  }

  stepState(i: number): 'done' | 'active' | 'warn' | 'todo' {
    const p = this.phase();
    if (p === 'idle') return i <= 2 ? 'active' : 'todo';
    if (p === 'receipt') return 'done';
    if (p === 'refused' || p === 'error') {
      const at = p === 'refused' ? this.reached() : this.failedAt();
      if (i === at) return 'warn';
      return i < at ? 'done' : 'todo';
    }
    const idx = this.stepIndex();
    if (i < idx) return 'done';
    return i === idx ? 'active' : 'todo';
  }

  /** Field-level diff rows extracted from wherever the plan actually
   *  carries them (plan.diff / plan.changes / per-action before+after).
   *  Empty → the template states plainly that no diff was provided. */
  readonly diffRows = computed<DiffRow[]>(() => {
    const r = this.planReceipt();
    if (!r) return [];
    const out: DiffRow[] = [];
    const seen = new Set<string>();
    const push = (path: unknown, before: unknown, after: unknown) => {
      const p = path === undefined || path === null ? '' : String(path);
      if (!p || seen.has(p)) return;
      seen.add(p);
      out.push({ path: p, before: asText(before), after: asText(after) });
    };
    const plan = r.plan ?? {};
    for (const key of ['diff', 'changes', 'files']) {
      const cand = plan[key];
      if (Array.isArray(cand)) {
        for (const item of cand) {
          if (item && typeof item === 'object') {
            const o = item as Record<string, unknown>;
            push(o['path'] ?? o['file'] ?? o['target'], o['before'], o['after']);
          }
        }
      } else if (cand && typeof cand === 'object') {
        for (const [path, v] of Object.entries(cand as Record<string, unknown>)) {
          if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            push(path, o['before'], o['after']);
          }
        }
      }
    }
    for (const a of r.actions ?? []) {
      const o = a as unknown as Record<string, unknown>;
      if (o['before'] !== undefined || o['after'] !== undefined) {
        push(a.path, o['before'], o['after']);
      }
    }
    return out;
  });

  readonly hostChoices: HostChoice[] = [
    { id: 'all', labelKey: 'install.host.all' },
    { id: 'claude', label: 'Claude' },
    { id: 'devin', label: 'Devin' },
    { id: 'codex', label: 'Codex' },
    { id: 'copilot', label: 'Copilot' },
  ];

  readonly profiles = [
    { id: 'minimal' as const, label: 'profiles.economy', hint: 'profiles.economy.desc' },
    { id: 'recommended' as const, label: 'profiles.balanced', hint: 'profiles.balanced.desc' },
    { id: 'full' as const, label: 'profiles.full', hint: 'profiles.full.desc' },
  ];

  readonly executionProfiles = [
    { id: 'economy' as const, label: 'profiles.economy', hint: 'profiles.economy.desc' },
    { id: 'balanced' as const, label: 'profiles.balanced', hint: 'profiles.balanced.desc' },
    { id: 'deep' as const, label: 'profiles.deep', hint: 'profiles.deep.desc' },
  ];

  readonly scopes = [
    { id: 'project' as const, label: 'install.scope.project', hint: 'install.scope.project.hint' },
    {
      id: 'workspace' as const,
      label: 'install.scope.workspace',
      hint: 'install.scope.workspace.hint',
    },
    { id: 'user' as const, label: 'install.scope.user', hint: 'install.scope.user.hint' },
  ];

  readonly components: { id: ComponentId }[] = [
    { id: 'skills' },
    { id: 'agents' },
    { id: 'mcp' },
    { id: 'tui' },
    { id: 'graph-studio' },
  ];

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    await Promise.all([
      firstValueFrom(this.api.hosts())
        .then((hs) => this.hostDetections.set(hs))
        .catch(() => this.hostDetections.set([])),
      this.loadHistory(),
      this.store.refreshHealth(),
    ]);
  }

  async loadHistory(): Promise<void> {
    try {
      this.history.set(await firstValueFrom(this.api.tasks()));
    } catch {
      this.history.set(this.history() ?? []);
    }
  }

  hostState(id: string): string {
    if (id === 'all') return '—';
    const d = (this.hostDetections() ?? []).find((h) => h.host === id);
    if (!d) return '…';
    return d.detected
      ? this.i18n.t(`hostState.${d.integration}`)
      : this.i18n.t('hostState.NOT_DETECTED');
  }

  scopeLabel(): string {
    return this.scopes.find((s) => s.id === this.scope())?.label ?? this.scope();
  }

  hostLabel(): string {
    const c = this.hostChoices.find((h) => h.id === this.host());
    return c?.labelKey ? this.i18n.t(c.labelKey) : (c?.label ?? this.host());
  }

  profileLabel(): string {
    return this.profiles.find((p) => p.id === this.profile())?.label ?? this.profile();
  }

  executionProfileLabel(): string {
    return (
      this.executionProfiles.find((p) => p.id === this.executionProfile())?.label ??
      `profiles.${this.executionProfile()}`
    );
  }

  opLabel(op: QuickOp): string {
    return op === 'repair' ? 'install.repair' : 'install.uninstall';
  }

  stageKind(stage: string): string {
    const s = (stage || '').toLowerCase();
    if (s === 'completed') return 'supported';
    if (['failed', 'refused', 'cancelled'].includes(s)) return 'error';
    if (['awaiting_approval', 'partial'].includes(s)) return 'warn';
    if (['running', 'planning', 'verifying'].includes(s)) return 'info';
    return 'muted';
  }

  toggle(id: string): void {
    if (this.locked()) return;
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  planText(plan: Record<string, unknown>): string {
    return JSON.stringify(plan, null, 2);
  }

  /** Step 4 — build the plan. Refusals are receipts, not errors. */
  async plan(): Promise<void> {
    if (this.phase() !== 'idle' || this.busy() || this.selected().size === 0) return;
    this.error.set(null);
    this.result.set(null);
    this.planReceipt.set(null);
    this.phase.set('planning');
    this.reached.set(3);
    try {
      const r = await firstValueFrom(this.api.installationPlan(this.selectionPayload()));
      if (r.refusal) {
        this.result.set(r);
        this.phase.set('refused');
        return;
      }
      this.planReceipt.set(r);
      this.reached.set(4);
      this.phase.set('review');
    } catch (e) {
      this.fail(e);
    }
  }

  /** Step 5 → 6 — review acknowledged, show the confirm card. */
  proceedToConfirm(): void {
    if (this.phase() !== 'review' || !this.planReceipt()) return;
    this.reached.set(5);
    this.phase.set('confirming');
  }

  backToReview(): void {
    if (this.phase() !== 'confirming') return;
    this.phase.set('review');
    this.reached.set(4);
  }

  /** Step 6 → 7 — the plan_token only enters the flow here, after the
   *  explicit confirm click. Any call outside 'confirming' is a no-op. */
  async confirmExecute(): Promise<void> {
    const p = this.planReceipt();
    if (this.phase() !== 'confirming' || !p?.plan || !p.plan_token) return;
    this.error.set(null);
    this.phase.set('executing');
    this.reached.set(6);
    try {
      const r = await firstValueFrom(this.api.installationApply(p.plan, p.plan_token));
      this.result.set(r);
      if (r.refusal) {
        this.phase.set('refused');
        return;
      }
      // Step 8 — verify against a fresh status read + receipt checks.
      this.phase.set('verifying');
      this.reached.set(7);
      await this.store.refreshHealth();
      this.reached.set(8);
      this.phase.set('receipt');
      await this.loadHistory();
    } catch (e) {
      this.fail(e);
    }
  }

  /** Plan → confirm → apply again with the same selection. */
  async reinstall(): Promise<void> {
    if (this.busy()) return;
    this.planReceipt.set(null);
    this.result.set(null);
    this.phase.set('idle');
    this.reached.set(0);
    await this.plan();
  }

  /** Repair — destructive enough to require an explicit confirm. */
  async repair(): Promise<void> {
    if (this.opBusy()) return;
    const ok = await this.confirm.ask({
      title: 'install.repair',
      message: 'install.repair.confirm',
      confirmKey: 'install.repair',
      danger: true,
    });
    if (!ok) return;
    await this.runQuickOp('repair', () => this.api.installationRepair());
  }

  /** Uninstall — ConfirmService danger gate, then the real adapter op. */
  async uninstall(): Promise<void> {
    if (this.opBusy()) return;
    const ok = await this.confirm.ask({
      title: 'install.uninstall',
      message: 'install.uninstall.confirm',
      confirmKey: 'install.uninstall.confirmBtn',
      danger: true,
    });
    if (!ok) return;
    await this.runQuickOp('uninstall', () => this.api.installationUninstall());
    if (this.opReceipt() && !this.opReceipt()!.r.refusal && !this.opError()) {
      this.reset();
    }
  }

  private async runQuickOp(
    op: QuickOp,
    call: () => Observable<InstallationReceipt>,
  ): Promise<void> {
    this.opBusy.set(op);
    this.opReceipt.set(null);
    this.opError.set(null);
    try {
      const r = await firstValueFrom(call());
      this.opReceipt.set({ op, r });
    } catch (e) {
      this.opError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.opBusy.set(null);
    }
    await this.store.refreshHealth();
    await this.loadHistory();
  }

  reset(): void {
    this.phase.set('idle');
    this.reached.set(0);
    this.planReceipt.set(null);
    this.result.set(null);
    this.error.set(null);
  }

  private fail(e: unknown): void {
    this.failedAt.set(this.stepIndex());
    this.error.set(e instanceof ApiError ? e : new ApiError(0));
    this.phase.set('error');
  }

  private selectionPayload(): Record<string, unknown> {
    return {
      scope: this.scope(),
      host: this.host(),
      profile: this.profile(),
      hosts:
        this.host() === 'all'
          ? (this.hostChoices.filter((h) => h.id !== 'all').map((h) => h.id) as HostId[])
          : ([this.host()] as HostId[]),
      component_profile: this.profile(),
      execution_profile: this.executionProfile(),
      components: Object.fromEntries([...this.selected()].map((c) => [c, true])),
    };
  }
}

function asText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
