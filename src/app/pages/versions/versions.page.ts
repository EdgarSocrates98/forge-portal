import { Component, computed, inject } from '@angular/core';
import { PortalApi } from '../../core/api/api.client';
import { VersionInfo } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, stamp } from '../explorer/forges.data';

/**
 * Version manager (spec §5.5) — `GET /versions` rendered verbatim:
 * installed version/origin/channel, availability, compat string,
 * changelog, history and rollback support.
 *
 * Honesty contract — the portal is offline-first:
 * - `null` fields render '—' plus a muted unverified marker, never a
 *   guessed value.
 * - `available.version === null` renders an explicit UNVERIFIED panel
 *   stating that remote release lookups are disabled — a fake "latest"
 *   version is never shown.
 * - 404 / PORTAL-NOT-FOUND → the whole capability renders UNVERIFIED.
 * - Rollback shows exactly `supported` + the adapter's `hint`; the
 *   portal never performs a rollback itself.
 */
@Component({
  selector: 'page-versions',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'versions.title' | t" [subtitle]="'versions.subtitle' | t">
      <button class="btn" [disabled]="src.loading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <!-- /versions absent on this adapter → UNVERIFIED capability. -->
    @if (src.unavailable()) {
      <section class="card unv" data-section="unavailable" role="note">
        <ui-state-badge state="UNVERIFIED" />
        <span class="muted">{{ 'versions.unavailable' | t }}</span>
      </section>
    }

    @if (src.error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (src.loading() && !info()) {
      <section class="card" role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="row" [lines]="3" />
      </section>
    }

    @if (info(); as v) {
      <!-- Installed — what is actually on disk, field by field. -->
      <section class="card" data-section="installed">
        <div class="sec__head">
          <div>
            <h2><ui-icon name="install" [size]="15" />{{ 'versions.installed' | t }}</h2>
            <p class="src">
              <code>GET /api/v1/versions</code>
              @if (src.loadedAt(); as ts) {
                <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
              }
            </p>
          </div>
        </div>

        <dl class="kv">
          <div>
            <dt>{{ 'versions.installed.version' | t }}</dt>
            <dd>
              @if (v.installed.version) {
                <code>{{ v.installed.version }}</code>
              } @else {
                <span class="muted" data-unverified>— {{ 'state.unverified' | t }}</span>
              }
            </dd>
          </div>
          <div>
            <dt>{{ 'versions.installed.origin' | t }}</dt>
            <dd>
              @if (v.installed.origin) {
                <code>{{ v.installed.origin }}</code>
              } @else {
                <span class="muted" data-unverified>— {{ 'state.unverified' | t }}</span>
              }
            </dd>
          </div>
          <div>
            <dt>{{ 'versions.installed.channel' | t }}</dt>
            <dd>
              @if (v.installed.channel) {
                {{ v.installed.channel }}
              } @else {
                <span class="muted" data-unverified>— {{ 'state.unverified' | t }}</span>
              }
            </dd>
          </div>
          <div>
            <dt>{{ 'versions.compat' | t }}</dt>
            <dd>
              <code>{{ v.compat }}</code>
            </dd>
          </div>
        </dl>
      </section>

      <!-- Available — remote release lookups are disabled offline, so a
           null version is an honest UNVERIFIED, never a fake latest. -->
      <section class="card" data-section="available">
        <div class="sec__head">
          <div>
            <h2><ui-icon name="external" [size]="15" />{{ 'versions.available' | t }}</h2>
            <p class="src">
              {{ 'versions.available.source' | t }}:
              <code>{{ v.available.source }}</code>
            </p>
          </div>
        </div>

        @if (v.available.version) {
          <dl class="kv">
            <div>
              <dt>{{ 'versions.available.version' | t }}</dt>
              <dd>
                <code>{{ v.available.version }}</code>
              </dd>
            </div>
          </dl>
        } @else {
          <div class="unv" data-note="offline" role="note">
            <ui-state-badge state="UNVERIFIED" />
            <span>{{ 'versions.offline' | t }}</span>
          </div>
        }
      </section>

      <!-- Integrity — sha256 of the consulted ecosystem manifest. -->
      @if (v.integrity) {
        <section class="card" data-section="integrity">
          <div class="sec__head">
            <div>
              <h2><ui-icon name="knowledge" [size]="15" />{{ 'versions.integrity' | t }}</h2>
            </div>
          </div>
          <dl class="kv">
            <div>
              <dt>{{ 'versions.integrity.release' | t }}</dt>
              <dd>
                @if (v.integrity.manifest_release) {
                  <code>{{ v.integrity.manifest_release }}</code>
                } @else {
                  <span class="muted" data-unverified>— {{ 'state.unverified' | t }}</span>
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'versions.integrity.sha256' | t }}</dt>
              <dd>
                @if (v.integrity.manifest_sha256) {
                  <code class="hash">{{ v.integrity.manifest_sha256 }}</code>
                } @else {
                  <span class="muted" data-unverified>— {{ 'state.unverified' | t }}</span>
                }
              </dd>
            </div>
          </dl>
        </section>
      }

      <!-- Pending / upgrade plan — update discovery belongs to the CLI;
           the portal reports null as UNVERIFIED instead of guessing. -->
      <section class="card" data-section="pending">
        <div class="sec__head">
          <div>
            <h2><ui-icon name="refresh" [size]="15" />{{ 'versions.pending' | t }}</h2>
          </div>
        </div>
        @if (v.pending || v.upgrade_plan) {
          <dl class="kv">
            @if (v.pending) {
              <div>
                <dt>{{ 'versions.pending.updates' | t }}</dt>
                <dd>{{ v.pending }}</dd>
              </div>
            }
            @if (v.upgrade_plan) {
              <div>
                <dt>{{ 'versions.pending.plan' | t }}</dt>
                <dd>{{ v.upgrade_plan }}</dd>
              </div>
            }
          </dl>
        } @else {
          <div class="unv" data-note="cli" role="note">
            <ui-state-badge state="UNVERIFIED" />
            <span>{{ 'versions.pending.cli' | t }}</span>
          </div>
        }
      </section>

      <!-- Receipts — raw operation receipts backing the history above. -->
      @if (v.receipts?.length) {
        <section class="card" data-section="receipts">
          <div class="sec__head">
            <div>
              <h2><ui-icon name="install" [size]="15" />{{ 'versions.receipts' | t }}</h2>
            </div>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ 'versions.receipts.file' | t }}</th>
                  <th>{{ 'versions.receipts.operation' | t }}</th>
                  <th>{{ 'versions.receipts.status' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (r of v.receipts; track r.file) {
                  <tr>
                    <td><code>{{ r.file }}</code></td>
                    <td>{{ r.operation ?? '—' }}</td>
                    <td>{{ r.status ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <!-- Changelog — null means the adapter could not verify it. -->
      <section class="card" data-section="changelog">
        <div class="sec__head">
          <div>
            <h2><ui-icon name="knowledge" [size]="15" />{{ 'versions.changelog' | t }}</h2>
          </div>
        </div>
        @if (v.changelog) {
          <pre class="changelog">{{ v.changelog }}</pre>
        } @else {
          <p class="muted" data-unverified>— {{ 'state.unverified' | t }}</p>
        }
      </section>

      <!-- History — recorded installs only; empty ≠ unverified. -->
      <section class="card" data-section="history">
        <div class="sec__head">
          <div>
            <h2><ui-icon name="history" [size]="15" />{{ 'versions.history' | t }}</h2>
          </div>
        </div>
        @if (v.history.length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>{{ 'versions.history.version' | t }}</th>
                  <th>{{ 'versions.history.at' | t }}</th>
                  <th>{{ 'versions.history.detail' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (h of v.history; track $index) {
                  <tr>
                    <td>
                      @if (h.version) {
                        <code>{{ h.version }}</code>
                      } @else {
                        <span class="muted" data-unverified>— {{ 'state.unverified' | t }}</span>
                      }
                    </td>
                    <td class="nowrap">
                      @if (h.at) {
                        {{ fmt(h.at) }}
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td>
                      @if (h.detail) {
                        {{ h.detail }}
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <ui-empty icon="history" [title]="'versions.history.empty' | t" />
        }
      </section>

      <!-- Rollback — portal reports support + the adapter's hint; it
           never executes a rollback itself. -->
      <section class="card" data-section="rollback">
        <div class="sec__head">
          <div>
            <h2><ui-icon name="refresh" [size]="15" />{{ 'versions.rollback' | t }}</h2>
          </div>
          <ui-state-badge [state]="v.rollback.supported ? 'supported' : 'unsupported'" />
        </div>
        @if (v.rollback.hint) {
          <p class="hint">
            <code>{{ v.rollback.hint }}</code>
          </p>
        }
      </section>
    }
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    .sec__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .sec__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .sec__head h2 ui-icon {
      color: var(--accent);
    }
    .src {
      margin: 4px 0 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .muted {
      color: var(--fg-muted);
    }
    .unv {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 1px dashed color-mix(in srgb, var(--warn) 55%, transparent);
      border-radius: var(--radius-md);
      background: var(--warn-bg);
      font-size: var(--font-sm);
    }
    .kv {
      display: grid;
      gap: var(--space-2);
      margin: 0;
    }
    .kv div {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
    }
    .kv dt {
      min-width: 9rem;
      color: var(--fg-muted);
      font-size: var(--font-sm);
      flex: none;
    }
    .kv dd {
      margin: 0;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .changelog {
      margin: 0;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg);
      font-size: var(--font-xs);
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .table-wrap {
      overflow-x: auto;
    }
    .nowrap {
      white-space: nowrap;
    }
    .hint {
      margin: 0;
      font-size: var(--font-sm);
      overflow-wrap: anywhere;
    }
  `,
})
export class VersionsPage {
  private readonly api = inject(PortalApi);

  /** Single source — 404/PORTAL-NOT-FOUND → UNVERIFIED capability. */
  readonly src = new Source<VersionInfo>();
  readonly info = computed(() => this.src.data());

  readonly stamp = stamp;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    await this.src.load(() => this.api.versions());
  }

  /** Localized date+time; falls back to the raw value — still real data. */
  fmt(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }
}
