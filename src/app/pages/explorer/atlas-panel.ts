import { Component, inject } from '@angular/core';
import { PortalApi } from '../../core/api/api.client';
import { AtlasStatus } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { StateBadge } from '../../shared/state-badge';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, stamp } from './forges.data';

/**
 * Code Atlas status — the adapter's read-only loopback probe
 * (`GET /api/v1/atlas/status`; the adapter itself probes
 * `http://127.0.0.1:8741/api/v1/health` + `/index/status` with a short
 * timeout). The portal renders exactly what the probe reported:
 *
 * - `available`   — health "ok" AND index/status answered (0 repos is
 *                   real data, not a failure);
 * - `degraded`    — the service answered badly (HTTP error, malformed
 *                   body, health≠ok, index down);
 * - `unavailable` — unreachable: connection refused / timeout — a
 *                   named terminal state, never an endless spinner;
 * - op 404        — this Forja does not expose the probe → UNVERIFIED.
 */
@Component({
  selector: 'atlas-status-panel',
  standalone: true,
  imports: [TPipe, StateBadge, ErrorState, UiIcon, UiSkeleton],
  template: `
    <section class="card" data-section="atlas" aria-labelledby="atlas-h">
      <div class="atlas__head">
        <div>
          <h2 id="atlas-h">{{ 'atlas.title' | t }}</h2>
          <p class="src">
            <code>GET /api/v1/atlas/status</code>
            @if (atlas.loadedAt(); as ts) {
              <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
            }
          </p>
          <p class="muted">{{ 'atlas.hint' | t }}</p>
        </div>
        <button
          class="icon-btn"
          (click)="load()"
          [disabled]="atlas.loading()"
          [attr.aria-label]="'state.refresh' | t"
        >
          <ui-icon name="refresh" [size]="14" />
        </button>
      </div>

      @if (atlas.unavailable()) {
        <div class="unv" role="note">
          <ui-state-badge state="UNVERIFIED" />
          <span>{{ 'atlas.unverifiedOp' | t }}</span>
        </div>
      }
      @if (atlas.error(); as e) {
        <ui-error [error]="e" (retry)="load()" />
      }
      @if (atlas.loading() && !atlas.data()) {
        <div role="status" [attr.aria-label]="'state.loading' | t">
          <ui-skeleton kind="row" [lines]="3" />
        </div>
      }

      @if (atlas.data(); as doc) {
        <div class="atlas__verdict">
          <ui-state-badge
            [state]="doc.state"
            [kindOverride]="doc.state === 'unavailable' ? 'unv' : null"
          />
          @if (doc.url) {
            <code class="atlas__url">{{ doc.url }}</code>
          }
          @if (doc.detail) {
            <span class="chip">{{ doc.detail }}</span>
          }
          @if (doc.service) {
            <span class="muted">{{ doc.service }}@{{ doc.api_version ?? '?' }}</span>
          }
          @if (doc.checked_at) {
            <span class="muted">{{ 'atlas.checkedAt' | t: { time: stamp(doc.checked_at) } }}</span>
          }
        </div>

        @if (doc.state === 'unavailable') {
          <p class="muted atlas__down">{{ 'atlas.downHint' | t }}</p>
        }

        @if (doc.index; as idx) {
          <div class="atlas__sum">
            <span>{{ 'atlas.repositories' | t }}: {{ idx.repositories }}</span>
            <span>{{ 'atlas.readySnapshots' | t }}: {{ idx.ready_snapshots }}</span>
          </div>
          @if (idx.items.length) {
            <ul class="atlas__repos">
              @for (it of idx.items.slice(0, 5); track it.repository_id) {
                <li>
                  <code>{{ it.root_handle ?? '—' }}</code>
                  <span class="muted">
                    {{ 'atlas.snapshots' | t: { count: it.ready_snapshots ?? 0 } }}
                  </span>
                  @for (c of countPairs(it.counts); track c[0]) {
                    <span class="chip chip--mut">{{ c[0] }} {{ c[1] }}</span>
                  }
                </li>
              }
            </ul>
          }
        }
      }
    </section>
  `,
  styles: `
    .atlas__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-2);
    }
    h2 {
      margin: 0 0 var(--space-1);
      font-size: var(--font-lg);
    }
    .src {
      margin: 0;
      padding: 0 var(--space-2);
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .muted {
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
    .unv {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      margin: var(--space-2) 0;
      border: 1px dashed color-mix(in srgb, var(--warn) 55%, transparent);
      border-radius: var(--radius-md);
      background: var(--warn-bg);
      font-size: var(--font-sm);
    }
    .atlas__verdict {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      margin: var(--space-2) 0;
      padding: 0 var(--space-2);
    }
    .atlas__url {
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .atlas__down {
      margin: 0 var(--space-2) var(--space-2);
    }
    .atlas__sum {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      margin: var(--space-2) 0;
      padding: 0 var(--space-2);
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .atlas__repos {
      margin: 0;
      padding: 0 var(--space-2);
      list-style: none;
      display: grid;
      gap: var(--space-1);
      font-size: var(--font-sm);
    }
    .atlas__repos li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
    }
    .chip {
      flex: none;
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent-ink);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .chip--mut {
      color: var(--fg-muted);
      background: var(--bg-hover);
    }
  `,
})
export class AtlasStatusPanel {
  private readonly api = inject(PortalApi);
  readonly atlas = new Source<AtlasStatus>();
  readonly stamp = stamp;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    await this.atlas.load(() => this.api.atlasStatus());
  }

  /** counts {symbols: 120, files: 12} → sorted [k, v] pairs for chips. */
  countPairs(counts: Record<string, number>): [string, number][] {
    return Object.entries(counts ?? {}).sort(([a], [b]) => a.localeCompare(b));
  }
}
