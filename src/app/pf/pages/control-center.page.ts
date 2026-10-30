import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApprovalRequest, BridgeSession, DegradedMode, PfBridge } from '../pf-bridge.service';
import { ApiError } from '../../core/api/api.error';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { ToastService } from '../../shared/toast';
import { UiSkeleton } from '../../shared/skeleton';

/**
 * Agent Control Center (Cycle 29) — one surface for everything an agent
 * session is doing right now: live sessions, their states, the pending
 * approval queue, and the bridge's degraded-mode banner. All data comes
 * from the local bridge — nothing is simulated.
 */
@Component({
  selector: 'page-pf-control-center',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [RouterLink, PageHeader, StateBadge, UiSkeleton, EmptyState, ErrorState],
  template: `
    <ui-page-header
      title="Agent Control Center"
      subtitle="Live sessions, pending approvals and bridge health — one place."
    />

    @if (err()) {
      <ui-error [error]="err()!" (retry)="load()" />
    } @else {
      @if (mode() && mode()!.degraded) {
        <section class="card banner" role="alert" aria-live="polite">
          <h2>Degraded mode</h2>
          <p class="muted">
            No authenticated provider is available. Allowed:
            {{ mode()!.allowed_operations.join('; ') }}.
          </p>
          <p class="muted">Never auto-executed: {{ mode()!.forbidden_operations.join('; ') }}.</p>
        </section>
      }

      <div class="grid">
        <section class="card" aria-labelledby="cc-sessions">
          <h2 id="cc-sessions">
            Sessions <span class="muted">({{ sessions().length }})</span>
          </h2>
          @if (loading()) {
            <ui-skeleton [lines]="4" />
          } @else if (sessions().length === 0) {
            <ui-empty title="No sessions" hint="Start one from Chat." />
          } @else {
            <table class="tbl" aria-label="Agent sessions">
              <thead>
                <tr>
                  <th scope="col">Session</th>
                  <th scope="col">Provider</th>
                  <th scope="col">State</th>
                  <th scope="col">Resumable</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                @for (s of sessions(); track s.id) {
                  <tr>
                    <td class="mono ellipsis" [title]="s.id">
                      {{ s.meta?.title || s.id }}
                    </td>
                    <td>{{ s.provider }}</td>
                    <td><ui-state-badge [state]="s.state" /></td>
                    <td>{{ s.resumable ? 'yes' : 'no' }}</td>
                    <td class="actions">
                      <a
                        class="btn btn--mini"
                        [routerLink]="['/pf/chat']"
                        [queryParams]="{ session: s.id }"
                        >Open</a
                      >
                      <button
                        class="btn btn--mini"
                        (click)="cancel(s)"
                        [disabled]="busy() === s.id"
                        [attr.aria-label]="'Cancel session ' + s.id"
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </section>

        <section class="card" aria-labelledby="cc-approvals">
          <h2 id="cc-approvals">
            Pending approvals
            <span class="muted">({{ approvals().length }})</span>
          </h2>
          @if (loading()) {
            <ui-skeleton [lines]="3" />
          } @else if (approvals().length === 0) {
            <p class="muted">Queue is clear.</p>
          } @else {
            <ul class="queue" aria-label="Approval queue">
              @for (a of approvals(); track a.approval_id) {
                <li class="queue-item">
                  <div>
                    <strong>{{ a.action }}</strong>
                    <span class="mono muted"> {{ a.resource }}</span>
                    <small class="muted"> — {{ a.actor }} · {{ a.scope }}/{{ a.risk }}</small>
                  </div>
                  <div class="actions">
                    <button
                      class="btn btn--mini"
                      (click)="resolve(a, true)"
                      [attr.aria-label]="'Approve ' + a.action"
                    >
                      Approve
                    </button>
                    <button
                      class="btn btn--mini btn--danger"
                      (click)="resolve(a, false)"
                      [attr.aria-label]="'Deny ' + a.action"
                    >
                      Deny
                    </button>
                  </div>
                </li>
              }
            </ul>
          }
        </section>
      </div>

      <section class="card" aria-labelledby="cc-providers">
        <h2 id="cc-providers">Providers</h2>
        <div class="chips" role="list">
          @for (p of providers(); track p.id) {
            <span class="chip" role="listitem">
              {{ p.name }}
              <ui-state-badge [state]="p.auth_state" />
            </span>
          }
        </div>
      </section>
    }
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 3fr 2fr;
      gap: 16px;
    }
    @media (max-width: 960px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .banner {
      border-left: 4px solid var(--warn, #b7791f);
    }
    .queue {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    .queue-item {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 8px;
      border: 1px solid var(--line, #333);
      border-radius: 6px;
    }
    .actions {
      display: flex;
      gap: 6px;
    }
    .ellipsis {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      padding: 4px 10px;
      border: 1px solid var(--line, #333);
      border-radius: 999px;
    }
  `,
})
export class PfControlCenterPage implements OnInit {
  private readonly bridge = inject(PfBridge);
  private readonly toast = inject(ToastService);

  readonly sessions = signal<BridgeSession[]>([]);
  readonly approvals = signal<ApprovalRequest[]>([]);
  readonly providers = signal<{ id: string; name: string; auth_state: string }[]>([]);
  readonly mode = signal<DegradedMode | null>(null);
  readonly loading = signal(true);
  readonly busy = signal('');
  readonly err = signal<ApiError | null>(null);

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.err.set(null);
    try {
      const [sessions, approvals, providers, mode] = await Promise.all([
        firstValueFrom(this.bridge.listSessions()),
        firstValueFrom(this.bridge.pendingApprovals()),
        firstValueFrom(this.bridge.providers()),
        firstValueFrom(this.bridge.intelMode()),
      ]);
      this.sessions.set(sessions ?? []);
      this.approvals.set(approvals ?? []);
      this.providers.set(providers ?? []);
      this.mode.set(mode ?? null);
    } catch (e) {
      this.err.set(e as ApiError);
    } finally {
      this.loading.set(false);
    }
  }

  async cancel(s: BridgeSession): Promise<void> {
    this.busy.set(s.id);
    try {
      await firstValueFrom(this.bridge.cancel(s.id, s.provider));
      this.toast.show('Cancellation requested');
      await this.load();
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    } finally {
      this.busy.set('');
    }
  }

  async resolve(a: ApprovalRequest, approved: boolean): Promise<void> {
    try {
      await firstValueFrom(this.bridge.resolveApproval(a.approval_id, approved));
      this.toast.show(approved ? 'Approved' : 'Denied');
      this.approvals.update((xs) => xs.filter((x) => x.approval_id !== a.approval_id));
    } catch (e) {
      this.toast.show((e as Error).message, 'error');
    }
  }
}
