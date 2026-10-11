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

interface PendingPlan {
  plan_token: string;
  plan: Record<string, unknown>;
}

/** Tarefas — intent → plano → revisão → execução, com recibo real. */
@Component({
  selector: 'page-tasks',
  standalone: true,
  imports: [FormsModule, TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon],
  template: `
    <ui-page-header [title]="'tasks.title' | t" [subtitle]="'tasks.subtitle' | t" />

    <section class="card">
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
        <button class="btn btn--primary" [disabled]="busy() || !intent().trim()" (click)="plan()">
          <ui-icon name="tasks" [size]="14" />
          {{ 'tasks.intent.run' | t }}
        </button>
      </div>
    </section>

    @if (pending(); as p) {
      <section class="card" data-lift>
        <h2>{{ 'tasks.plan' | t }}</h2>
        <p class="muted">{{ 'tasks.plan.review' | t }}</p>
        <pre class="plan">{{ planText(p.plan) }}</pre>
        <div class="row">
          <button
            class="btn btn--primary"
            [disabled]="busy()"
            (click)="execute(p.plan, p.plan_token)"
          >
            {{ 'tasks.execute' | t }}
          </button>
          <button class="btn" (click)="pending.set(null)">{{ 'state.cancel' | t }}</button>
        </div>
      </section>
    }

    @if (receipt(); as r) {
      <section class="card" data-lift>
        <h2>{{ 'tasks.result' | t }}</h2>
        <p class="receipt__status">
          <ui-state-badge [state]="r.status" />
          @if (r.detail) {
            <span>{{ r.detail }}</span>
          }
        </p>
        @if (r.refusal) {
          <p class="refusal">
            <code>{{ r.refusal }}</code>
            @if (r.unlock) {
              — {{ r.unlock }}
            }
          </p>
        }
      </section>
    }

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    <section class="card">
      <h2>{{ 'tasks.recent' | t }}</h2>
      @if (loading()) {
        <div class="skeleton skeleton--block"></div>
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
    .plan {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      overflow-x: auto;
      font-size: var(--font-sm);
    }
    .row {
      display: flex;
      gap: var(--space-2);
      margin-top: var(--space-3);
    }
    .muted {
      color: var(--fg-muted);
    }
    .refusal {
      color: var(--warn);
    }
    .receipt__status {
      display: flex;
      align-items: center;
      gap: var(--space-3);
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
  readonly busy = signal(false);
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
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await firstValueFrom(this.api.tasksPlan({ intent: this.intent() }));
      this.pending.set(r);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async execute(plan: Record<string, unknown>, planToken: string): Promise<void> {
    this.busy.set(true);
    try {
      this.receipt.set(await firstValueFrom(this.api.tasksExecute(plan, planToken)));
      this.pending.set(null);
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  planText(plan: Record<string, unknown>): string {
    return JSON.stringify(plan, null, 2);
  }

  stageKind(stage: string): string {
    if (stage === 'completed') return 'supported';
    if (['failed', 'refused'].includes(stage)) return 'error';
    if (['running', 'planning', 'verifying'].includes(stage)) return 'info';
    return 'muted';
  }
}
