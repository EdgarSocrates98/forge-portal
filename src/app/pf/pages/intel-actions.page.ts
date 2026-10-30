import { TPipe } from '../../core/i18n/i18n.pipe';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AgentFinOps,
  BridgeSession,
  DecisionRecord,
  PfBridge,
  SessionQuality,
} from '../pf-bridge.service';
import { ApiError } from '../../core/api/api.error';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { UiSkeleton } from '../../shared/skeleton';

/**
 * Product Intelligence Actions (Cycle 29) — one-tap intelligence over a
 * session: quality axes, extracted decisions, replay dossier entry point,
 * plus the workspace FinOps rollup. Every number is bridge-recorded;
 * "estimated" is labelled, never hidden.
 */
@Component({
  selector: 'page-pf-intel-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [PageHeader, StateBadge, UiSkeleton, EmptyState, ErrorState, TPipe],
  template: `
    <ui-page-header
      title="Product Intelligence"
      subtitle="Session quality, decisions and FinOps — computed from recorded events, not inferred."
    />

    <section class="card">
      <label class="field">
        <span>{{ 'pf.intelActions.session' | t }}</span>
        <select
          class="input"
          [value]="sid()"
          (change)="pick($any($event.target).value)"
          aria-label="Session to analyze"
        >
          <option value="">{{ 'pf.intelActions.choose' | t }}</option>
          @for (s of sessions(); track s.id) {
            <option [value]="s.id">{{ s.meta?.title || s.id }} ({{ s.provider }})</option>
          }
        </select>
      </label>
    </section>

    @if (err()) {
      <ui-error [error]="err()!" (retry)="pick(sid())" />
    } @else if (loading()) {
      <ui-skeleton [lines]="6" />
    } @else {
      <div class="grid">
        <section class="card" aria-labelledby="ia-quality">
          <h2 id="ia-quality">{{ 'pf.intelActions.sessionQuality' | t }}</h2>
          @if (quality()) {
            <p class="overall">
              Overall: <strong class="mono">{{ quality()!.overall }}</strong>
            </p>
            <table class="tbl" aria-label="Quality axes">
              <thead>
                <tr>
                  <th scope="col">{{ 'pf.intelActions.axis' | t }}</th>
                  <th scope="col">{{ 'pf.intelActions.score' | t }}</th>
                  <th scope="col">{{ 'pf.intelActions.detail' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (ax of axes(); track ax[0]) {
                  <tr>
                    <td>{{ ax[0] }}</td>
                    <td class="mono">{{ ax[1].score ?? '—' }}</td>
                    <td class="muted">{{ axDetail(ax[1]) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <ui-empty title="No session" hint="Pick a session above." />
          }
        </section>

        <section class="card" aria-labelledby="ia-decisions">
          <h2 id="ia-decisions">{{ 'pf.intelActions.decisions' | t }}</h2>
          @if (decisions().length) {
            <ul class="list">
              @for (d of decisions(); track $index) {
                <li>
                  <strong>{{ d.decision }}</strong>
                  @if (d.reason) {
                    <p class="muted">{{ d.reason }}</p>
                  }
                  <small class="muted"> {{ d.owner || '—' }} · {{ d.decided_at || '' }}</small>
                </li>
              }
            </ul>
          } @else {
            <ui-empty
              title="No decisions extracted"
              hint="Decision-shaped events will appear here."
            />
          }
        </section>
      </div>

      <section class="card" aria-labelledby="ia-finops">
        <h2 id="ia-finops">{{ 'pf.intelActions.workspaceFinOps' | t }}</h2>
        @if (finops(); as f) {
          @if (f.by_scope.length) {
            <table class="tbl" aria-label="Usage by scope">
              <thead>
                <tr>
                  <th scope="col">{{ 'pf.intelActions.scope' | t }}</th>
                  <th scope="col">{{ 'pf.intelActions.key' | t }}</th>
                  <th scope="col">{{ 'pf.intelActions.tokensIn' | t }}</th>
                  <th scope="col">{{ 'pf.intelActions.tokensOut' | t }}</th>
                  <th scope="col">{{ 'pf.intelActions.basis' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (r of f.by_scope; track r.scope + ':' + r.value) {
                  <tr>
                    <td>{{ r.scope }}</td>
                    <td class="mono">{{ r.value }}</td>
                    <td class="mono">{{ r.tokens_in }}</td>
                    <td class="mono">{{ r.tokens_out }}</td>
                    <td>
                      <ui-state-badge
                        [state]="r.estimated ? 'estimated' : 'reported'"
                        [labelOverride]="r.estimated ? 'estimated' : 'reported'"
                      />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
            <p class="muted small">{{ f.note }}</p>
          } @else {
            <ui-empty
              title="No usage recorded"
              hint="Token usage appears once sessions record usage events."
            />
          }
        }
      </section>
    }
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 960px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .overall {
      font-size: 18px;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 10px;
    }
    .list li {
      padding: 8px;
      border: 1px solid var(--line, #333);
      border-radius: 6px;
    }
    .list p {
      margin: 4px 0 0;
    }
    .small {
      font-size: 12px;
    }
  `,
})
export class PfIntelActionsPage implements OnInit {
  private readonly bridge = inject(PfBridge);

  readonly sessions = signal<BridgeSession[]>([]);
  readonly sid = signal('');
  readonly quality = signal<SessionQuality | null>(null);
  readonly decisions = signal<DecisionRecord[]>([]);
  readonly finops = signal<AgentFinOps | null>(null);
  readonly loading = signal(false);
  readonly err = signal<ApiError | null>(null);
  readonly axes = () => Object.entries(this.quality()?.axes ?? {});

  async ngOnInit(): Promise<void> {
    try {
      const [sessions, finops] = await Promise.all([
        firstValueFrom(this.bridge.listSessions()),
        firstValueFrom(this.bridge.intelFinops()),
      ]);
      this.sessions.set(sessions ?? []);
      this.finops.set(finops ?? null);
    } catch (e) {
      this.err.set(e as ApiError);
    }
  }

  async pick(id: string): Promise<void> {
    this.sid.set(id);
    this.quality.set(null);
    this.decisions.set([]);
    if (!id) return;
    this.loading.set(true);
    this.err.set(null);
    try {
      const [q, d] = await Promise.all([
        firstValueFrom(this.bridge.intelQuality(id)),
        firstValueFrom(this.bridge.intelDecisions(id)),
      ]);
      this.quality.set(q ?? null);
      this.decisions.set(d ?? []);
    } catch (e) {
      this.err.set(e as ApiError);
    } finally {
      this.loading.set(false);
    }
  }

  axDetail(ax: Record<string, unknown>): string {
    return (
      Object.entries(ax)
        .filter(([k]) => k !== 'score' && k !== 'note')
        .map(([k, v]) => `${k}=${v}`)
        .join(' · ') ||
      (ax['note'] as string) ||
      ''
    );
  }
}
