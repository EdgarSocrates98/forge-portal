import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { ApiError } from '../../core/api/api.error';
import { ErrorState } from '../../shared/error-state';
import { UiSkeleton } from '../../shared/skeleton';
import { StateBadge } from '../../shared/state-badge';
import { SentinelApi } from '../../sentinel/sentinel-api.service';
import {
  SentinelCapabilitiesResponse,
  SentinelHealth,
  SentinelIntegrationsResponse,
  SentinelServiceListResponse,
} from '../../sentinel/sentinel.models';
import { sentinelKind } from '../../sentinel/sentinel-states';

/**
 * Sentinel self-report: `/v1/health`, `/v1/capabilities` (with maturity
 * stage), `/v1/integrations/status`, and the per-service telemetry
 * source rows. Everything renders verbatim — no rollups beyond what the
 * server already computed.
 */
@Component({
  selector: 'sentinel-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TPipe, ErrorState, UiSkeleton, StateBadge, DatePipe],
  template: `
    @if (loading()) {
      <ui-skeleton kind="card" /><ui-skeleton kind="text" [lines]="4" />
    } @else if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    } @else {
      @if (health(); as h) {
        <section class="card">
          <h3>{{ 'sentinel.status.health' | t }}</h3>
          <p>
            <ui-state-badge [state]="h.state" [kindOverride]="kind(h.state)" [labelOverride]="stateLabel(h.state)" />
            <code class="mono">api-sentinel {{ h.version }}</code>
          </p>
          <dl class="kv">
            <dt>{{ 'sentinel.status.workspace' | t }}</dt>
            <dd>{{ h.workspace_initialized ? ('sentinel.status.initialized' | t) : ('sentinel.status.notInitialized' | t) }}</dd>
            <dt>{{ 'sentinel.status.database' | t }}</dt>
            <dd class="mono">{{ h.database }}</dd>
          </dl>
          @if (capCounts(h).length) {
            <p class="muted small">
              {{ 'sentinel.status.capabilityCounts' | t }}:
              @for (c of capCounts(h); track c[0]) { <code>{{ c[0] }}={{ c[1] }}</code> }
            </p>
          }
          @if (sentinelPairs(h).length) {
            <details class="self">
              <summary>{{ 'sentinel.status.selfState' | t }}</summary>
              <dl class="kv">
                @for (p of sentinelPairs(h); track p[0]) {
                  <dt class="mono">{{ p[0] }}</dt><dd class="mono">{{ p[1] }}</dd>
                }
              </dl>
            </details>
          }
          @if (h.unknowns.length) {
            <p class="unknowns">{{ 'sentinel.unknowns' | t }}: {{ h.unknowns.join(' · ') }}</p>
          }
        </section>
      }

      @if (capabilities(); as c) {
        <section class="card">
          <h3>{{ 'sentinel.cap.title' | t }}</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ 'sentinel.col.capability' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.status' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.stage' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.since' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.notes' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (cap of c.capabilities; track cap.capability_id) {
                  <tr>
                    <td class="mono">{{ cap.capability_id }}</td>
                    <td><ui-state-badge [state]="cap.status" [kindOverride]="kind(cap.status)" [labelOverride]="stateLabel(cap.status)" /></td>
                    <td>
                      @if (cap.stage) {
                        <ui-state-badge [state]="cap.stage" [kindOverride]="kind(cap.stage)" [labelOverride]="stateLabel(cap.stage)" />
                      } @else { — }
                    </td>
                    <td class="num">{{ cap.since ? (cap.since | date:'short') : '—' }}</td>
                    <td class="muted">{{ cap.notes }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted small">{{ 'sentinel.cap.stageNote' | t }}</p>
        </section>
      }

      @if (integrations(); as intg) {
        <section class="card">
          <h3>{{ 'sentinel.status.integrations' | t }}</h3>
          @if (intg.integrations.length === 0) {
            <p class="muted">{{ 'sentinel.status.noIntegrations' | t }}</p>
          } @else {
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{{ 'sentinel.col.forge' | t }}</th>
                    <th scope="col">{{ 'sentinel.col.status' | t }}</th>
                    <th scope="col">{{ 'sentinel.col.detail' | t }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of intg.integrations; track $index) {
                    <tr>
                      <td class="mono">{{ row['forge'] || row['name'] || '—' }}</td>
                      <td>
                        <ui-state-badge
                          [state]="str(row['state'])"
                          [kindOverride]="kind(str(row['state']))"
                          [labelOverride]="stateLabel(str(row['state']))" />
                      </td>
                      <td class="muted">{{ detailText(row) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (intg.unknowns.length) {
            <p class="unknowns">{{ 'sentinel.unknowns' | t }}: {{ intg.unknowns.join(' · ') }}</p>
          }
        </section>
      }

      @if (services(); as l) {
        <section class="card">
          <h3>{{ 'sentinel.sources.title' | t }}</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{{ 'sentinel.col.service' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.source' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.registered' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.observations' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.window' | t }}</th>
                  <th scope="col">{{ 'sentinel.col.stale' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (s of l.services; track s.service.service_id) {
                  @for (src of s.health.sources; track src.source_id) {
                    <tr>
                      <td class="mono">{{ s.service.service_id }}</td>
                      <td class="mono">{{ src.source_id }}</td>
                      <td>{{ src.registered }}</td>
                      <td class="num">{{ src.observations }}</td>
                      <td class="num">{{ src.latest_window_end ? (src.latest_window_end | date:'HH:mm:ss') : '—' }}</td>
                      <td>
                        <ui-state-badge
                          [state]="src.stale ? 'stale' : 'fresh'"
                          [kindOverride]="kind(src.stale ? 'stale' : 'fresh')"
                          [labelOverride]="stateLabel(src.stale ? 'stale' : 'fresh')" />
                      </td>
                    </tr>
                  }
                }
              </tbody>
            </table>
          </div>
        </section>
      }
    }
  `,
  styles: `
    section.card {
      margin-bottom: var(--space-4);
      padding: var(--space-5);
    }
    section.card h3 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-base);
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--font-sm);
    }
    th {
      text-align: left;
      padding: var(--space-3);
      color: var(--fg-muted);
      font-size: var(--font-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    td {
      padding: var(--space-3);
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .num {
      font-variant-numeric: tabular-nums;
      text-align: right;
      white-space: nowrap;
    }
    .mono {
      font-family: var(--font-mono);
      font-size: var(--font-xs);
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
    .kv {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 4px var(--space-3);
      font-size: var(--font-sm);
      margin: var(--space-2) 0;
    }
    .kv dt {
      color: var(--fg-muted);
    }
    .kv dd {
      margin: 0;
    }
    .self summary {
      cursor: pointer;
      color: var(--accent-ink);
      font-size: var(--font-sm);
    }
    .unknowns {
      color: var(--warn);
      font-size: var(--font-xs);
      margin: var(--space-3) 0 0;
    }
  `,
})
export class SentinelStatus {
  private readonly api = inject(SentinelApi);
  private readonly i18n = inject(I18nService);

  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly health = signal<SentinelHealth | null>(null);
  readonly capabilities = signal<SentinelCapabilitiesResponse | null>(null);
  readonly integrations = signal<SentinelIntegrationsResponse | null>(null);
  readonly services = signal<SentinelServiceListResponse | null>(null);

  readonly kind = sentinelKind;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      // health is public — the rest need credentials; a credential-less
      // private failure degrades those sections, not the whole view.
      const h = await firstValueFrom(this.api.health());
      this.health.set(h);
      const [caps, intg, svc] = await Promise.all([
        firstValueFrom(this.api.capabilities()).catch(() => null),
        firstValueFrom(this.api.integrations()).catch(() => null),
        firstValueFrom(this.api.services()).catch(() => null),
      ]);
      this.capabilities.set(caps);
      this.integrations.set(intg);
      this.services.set(svc);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  capCounts(h: SentinelHealth): [string, number][] {
    return Object.entries(h.capabilities ?? {});
  }

  sentinelPairs(h: SentinelHealth): [string, string][] {
    return Object.entries(h.sentinel ?? {}).map(([k, v]) => [
      k,
      typeof v === 'object' ? JSON.stringify(v) : String(v),
    ]);
  }

  str(v: unknown): string {
    return typeof v === 'string' ? v : '';
  }

  detailText(row: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(row)) {
      if (k === 'forge' || k === 'name' || k === 'state') continue;
      parts.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
    }
    return parts.join(' · ');
  }

  stateLabel(state: string | null | undefined): string {
    const key = `sentinel.state.${state}`;
    const v = this.i18n.t(key);
    return v.startsWith('⟪') ? String(state ?? '—') : v;
  }
}
