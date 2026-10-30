import { TPipe } from '../../../core/i18n/i18n.pipe';
import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PfApi } from '../../pf-api.service';
import { ApiError } from '../../../core/api/api.error';
import { PfAuditEvent, PfReport } from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { UiIcon } from '../../../shared/icon';
import { UiSkeleton } from '../../../shared/skeleton';
import { ToastService } from '../../../shared/toast';

/**
 * Reports tab — the executive report generator (engine-composed markdown
 * from real store counts) plus the product's audit trail. Both surfaces
 * are the server's own records — nothing is summarized client-side.
 */
@Component({
  selector: 'pf-reports-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, UiIcon, UiSkeleton, TPipe],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" aria-label="loading reports"><ui-skeleton kind="card" [lines]="3" /></div>
    } @else {
      <section class="card">
        <header class="rhead">
          <h2>{{ 'pf.reports.reports' | t }}</h2>
          <button class="btn btn--primary" [disabled]="generating()" (click)="generate()">
            {{ generating() ? 'Generating…' : 'Generate executive report' }}
          </button>
        </header>
        @if (reports().length) {
          <ul class="rlist">
            @for (r of reports(); track r.id) {
              <li>
                <button class="rrow" (click)="toggle(r.id)">
                  <ui-icon
                    [name]="openId() === r.id ? 'chevron-left' : 'chevron-right'"
                    [size]="14"
                  />
                  <strong>{{ r.kind ?? 'report' }}</strong>
                  <code class="muted small">{{ r.id }}</code>
                  <span class="muted small">{{ r.created_at ?? '' }}</span>
                  @if (r.stats?.['knowledge_score'] !== undefined) {
                    <span class="fg-pill">knowledge {{ r.stats!['knowledge_score'] }}</span>
                  }
                </button>
                @if (openId() === r.id) {
                  <pre class="md fg-enter">{{ r.markdown }}</pre>
                }
              </li>
            }
          </ul>
        } @else {
          <ui-empty
            icon="diff"
            title="No reports generated"
            hint="Generate the first executive report — the engine composes it from live counts."
          />
        }
      </section>

      <section class="card">
        <h2>{{ 'pf.reports.auditTrail' | t }}</h2>
        @if (audit().length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'pf.reports.when' | t }}</th>
                <th scope="col">{{ 'pf.reports.action' | t }}</th>
                <th scope="col">{{ 'pf.reports.resource' | t }}</th>
                <th scope="col">{{ 'pf.reports.actor' | t }}</th>
                <th scope="col">{{ 'pf.reports.correlation' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (a of audit(); track a.id) {
                <tr>
                  <td class="muted small">{{ a.created_at ?? '—' }}</td>
                  <td>
                    <code>{{ a.action ?? '—' }}</code>
                  </td>
                  <td>
                    <span class="muted small">{{ a.resource_type ?? '' }}</span>
                    <code class="muted small"> {{ a.resource_id ?? '' }}</code>
                  </td>
                  <td>{{ a.actor ?? '—' }}</td>
                  <td>
                    <code class="muted small">{{ a.correlation_id || '—' }}</code>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <ui-empty icon="history" title="No audit events for this product" />
        }
      </section>
    }
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .rhead {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
      flex-wrap: wrap;
    }
    .rlist {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .rrow {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      text-align: left;
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-hover);
      color: var(--fg);
      cursor: pointer;
      font: inherit;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast);
    }
    .rrow:hover {
      border-color: var(--border-strong);
      background: var(--bg-elevated);
    }
    .md {
      margin: var(--space-2) 0 0;
      white-space: pre-wrap;
      font-family: var(--font-mono);
      font-size: var(--font-xs);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      background: var(--bg-elevated);
      max-height: 30rem;
      overflow: auto;
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
  `,
})
export class PfReportsTab implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly pid = input.required<string>();

  readonly reports = signal<PfReport[]>([]);
  readonly audit = signal<PfAuditEvent[]>([]);
  readonly loading = signal(true);
  readonly generating = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly openId = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const [reps, aud] = await Promise.all([
        firstValueFrom(this.api.reports(this.pid())),
        firstValueFrom(this.api.audit(this.pid())),
      ]);
      this.reports.set(reps.items ?? []);
      this.audit.set(aud.items ?? []);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string): void {
    this.openId.set(this.openId() === id ? null : id);
  }

  async generate(): Promise<void> {
    if (this.generating()) return;
    this.generating.set(true);
    try {
      const rec = await firstValueFrom(this.api.generateExecutiveReport(this.pid()));
      this.toast.show('Executive report generated', 'success');
      this.openId.set(rec.id);
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.generating.set(false);
    }
  }
}
