import { TPipe } from '../../core/i18n/i18n.pipe';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  BridgeSession,
  ContextHealth,
  DegradedMode,
  PfBridge,
  ProviderRouting,
  WorkspaceIntelligence,
} from '../pf-bridge.service';
import { ApiError } from '../../core/api/api.error';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { UiSkeleton } from '../../shared/skeleton';

/**
 * Forge Lens (Cycle 29) — the context inspector. Shows what a session is
 * bound to (context health), the workspace's aggregate intelligence
 * picture, and the deterministic provider-routing decision for a given
 * task — every verdict comes straight from the bridge, with reasons.
 */
@Component({
  selector: 'page-pf-lens',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [PageHeader, StateBadge, UiSkeleton, EmptyState, ErrorState, TPipe],
  template: `
    <ui-page-header
      title="Forge Lens"
      subtitle="Context health, workspace intelligence and provider routing — inspected, not assumed."
    />

    <div class="grid">
      <section class="card" aria-labelledby="lens-ctx">
        <h2 id="lens-ctx">{{ 'pf.lens.sessionContextHealth' | t }}</h2>
        <div class="row">
          <select
            class="input"
            [value]="sid()"
            (change)="pick($any($event.target).value)"
            aria-label="Session to inspect"
          >
            <option value="">{{ 'pf.lens.chooseSession' | t }}</option>
            @for (s of sessions(); track s.id) {
              <option [value]="s.id">{{ s.meta?.title || s.id }}</option>
            }
          </select>
        </div>
        @if (health()) {
          <dl class="kv">
            <dt>{{ 'pf.lens.state' | t }}</dt>
            <dd><ui-state-badge [state]="health()!.state" /></dd>
            @if (health()!.issues?.length) {
              <dt>{{ 'pf.lens.issues' | t }}</dt>
              <dd>
                <ul>
                  @for (i of health()!.issues!; track $index) {
                    <li>
                      <strong>{{ i.kind }}</strong> — {{ i.detail }}
                    </li>
                  }
                </ul>
              </dd>
            }
            @if (health()!.note) {
              <dt>{{ 'pf.lens.note' | t }}</dt>
              <dd class="muted">{{ health()!.note }}</dd>
            }
          </dl>
        } @else if (sid() && !loading()) {
          <ui-empty title="Unbound session" hint="No product context is bound to this session." />
        }
      </section>

      <section class="card" aria-labelledby="lens-ws">
        <h2 id="lens-ws">{{ 'pf.lens.workspaceIntelligence' | t }}</h2>
        @if (workspace()) {
          <dl class="kv">
            <dt>{{ 'pf.lens.sessions' | t }}</dt>
            <dd class="mono">{{ workspace()!.sessions ?? '—' }}</dd>
            <dt>{{ 'pf.lens.boundContexts' | t }}</dt>
            <dd class="mono">{{ workspace()!.bound_contexts ?? '—' }}</dd>
            <dt>{{ 'pf.lens.federatedMCPServers' | t }}</dt>
            <dd class="mono">{{ workspace()!.mcp_servers ?? '—' }}</dd>
            <dt>{{ 'pf.lens.budgetLimits' | t }}</dt>
            <dd class="mono">{{ workspace()!.budget_limits ?? '—' }}</dd>
          </dl>
        }
        @if (mode()) {
          <p class="muted">
            Bridge mode:
            <ui-state-badge [state]="mode()!.degraded ? 'degraded' : 'normal'" />
          </p>
        }
      </section>
    </div>

    <section class="card" aria-labelledby="lens-route">
      <h2 id="lens-route">{{ 'pf.lens.providerRouting' | t }}</h2>
      <form class="row" (submit)="route($event)">
        <label class="field">
          <span>{{ 'pf.lens.requiredCapabilitiesCommaSeparated' | t }}</span>
          <input
            class="input mono"
            [value]="req()"
            (input)="req.set($any($event.target).value)"
            placeholder="chat,streaming"
          />
        </label>
        <label class="field">
          <span>{{ 'pf.lens.privacy' | t }}</span>
          <select
            class="input"
            [value]="privacy()"
            (change)="privacy.set($any($event.target).value)"
          >
            <option value="local-ok">{{ 'pf.lens.localOk' | t }}</option>
            <option value="local-only">{{ 'pf.lens.localOnly' | t }}</option>
          </select>
        </label>
        <button class="btn" type="submit" [disabled]="routing()">{{ 'pf.lens.route' | t }}</button>
      </form>
      @if (routeResult()) {
        <p>
          Selected:
          <strong>{{ routeResult()!.selected ?? 'none — no eligible provider' }}</strong>
        </p>
        <table class="tbl" aria-label="Routing candidates">
          <thead>
            <tr>
              <th scope="col">{{ 'pf.lens.provider' | t }}</th>
              <th scope="col">{{ 'pf.lens.score' | t }}</th>
              <th scope="col">{{ 'pf.lens.eligible' | t }}</th>
              <th scope="col">{{ 'pf.lens.reasons' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (c of routeResult()!.candidates; track c.provider) {
              <tr>
                <td>{{ c.provider }}</td>
                <td class="mono">{{ c.score }}</td>
                <td>{{ c.eligible ? 'yes' : 'no' }}</td>
                <td class="muted">{{ c.reasons.join('; ') }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </section>

    @if (err()) {
      <ui-error [error]="err()!" (retry)="load()" />
    } @else if (loading()) {
      <ui-skeleton [lines]="5" />
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
    .row {
      display: flex;
      gap: 12px;
      align-items: end;
      flex-wrap: wrap;
    }
    .kv {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 14px;
    }
    .kv dt {
      font-weight: 600;
    }
    .kv dd {
      margin: 0;
    }
  `,
})
export class PfLensPage implements OnInit {
  private readonly bridge = inject(PfBridge);

  readonly sessions = signal<BridgeSession[]>([]);
  readonly sid = signal('');
  readonly health = signal<ContextHealth | null>(null);
  readonly workspace = signal<WorkspaceIntelligence | null>(null);
  readonly mode = signal<DegradedMode | null>(null);
  readonly req = signal('chat,streaming');
  readonly privacy = signal('local-ok');
  readonly routeResult = signal<ProviderRouting | null>(null);
  readonly routing = signal(false);
  readonly loading = signal(true);
  readonly err = signal<ApiError | null>(null);

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.err.set(null);
    try {
      const [sessions, ws, mode] = await Promise.all([
        firstValueFrom(this.bridge.listSessions()),
        firstValueFrom(this.bridge.intelWorkspace()),
        firstValueFrom(this.bridge.intelMode()),
      ]);
      this.sessions.set(sessions ?? []);
      this.workspace.set(ws ?? null);
      this.mode.set(mode ?? null);
    } catch (e) {
      this.err.set(e as ApiError);
    } finally {
      this.loading.set(false);
    }
  }

  async pick(id: string): Promise<void> {
    this.sid.set(id);
    this.health.set(null);
    if (!id) return;
    try {
      this.health.set((await firstValueFrom(this.bridge.intelContextHealth(id))) ?? null);
    } catch (e) {
      this.err.set(e as ApiError);
    }
  }

  async route(ev: Event): Promise<void> {
    ev.preventDefault();
    this.routing.set(true);
    try {
      const required = this.req()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      this.routeResult.set(
        (await firstValueFrom(this.bridge.intelRoute({ required, privacy: this.privacy() }))) ??
          null,
      );
    } catch (e) {
      this.err.set(e as ApiError);
    } finally {
      this.routing.set(false);
    }
  }
}
