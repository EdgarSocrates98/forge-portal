import { TPipe } from '../../core/i18n/i18n.pipe';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DiagnosticReport, PfBridge } from '../pf-bridge.service';
import { ApiError } from '../../core/api/api.error';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { UiSkeleton } from '../../shared/skeleton';

/**
 * Unified Diagnostic Center (Cycle 30.2 §8) — provider records, MCP Doctor
 * classifications and bridge self-checks. Every row comes from the real
 * `/diagnostics` + `/mcp/doctor` bridge endpoints; corrective entries are
 * suggestions only — nothing mutates user configuration from here.
 */
@Component({
  selector: 'page-pf-diagnostics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [PageHeader, StateBadge, UiSkeleton, EmptyState, ErrorState, TPipe],
  template: `
    <ui-page-header
      [title]="'pf.diagnostics.title' | t"
      [subtitle]="'pf.diagnostics.subtitle' | t"
    />

    @if (err()) {
      <ui-error [error]="err()!" (retry)="load()" />
    } @else if (loading() || !report()) {
      <ui-skeleton [lines]="8" />
    } @else {
      @let r = report()!;

      <section class="card meta" aria-labelledby="dg-bridge">
        <h2 id="dg-bridge">{{ 'pf.diagnostics.bridge' | t }}</h2>
        <dl class="kv">
          <dt>{{ 'pf.diagnostics.version' | t }}</dt>
          <dd>{{ r.bridge.version }}</dd>
          <dt>{{ 'pf.diagnostics.stateDir' | t }}</dt>
          <dd class="mono">{{ r.bridge.state_dir }}</dd>
          <dt>{{ 'pf.diagnostics.pfMode' | t }}</dt>
          <dd>{{ r.bridge.pf_verify_mode }}</dd>
          <dt>{{ 'pf.diagnostics.sessions' | t }}</dt>
          <dd>{{ r.sessions.active }} / {{ r.sessions.tracked }}</dd>
          <dt>{{ 'pf.diagnostics.pendingApprovals' | t }}</dt>
          <dd>{{ r.approvals.pending }}</dd>
        </dl>
        <ul class="checks">
          @for (c of r.checks; track c.name) {
            <li>
              <ui-state-badge [state]="c.state" />
              <span class="chk-name">{{ c.name }}</span>
              <span class="muted mono">{{ c.detail }}</span>
            </li>
          }
        </ul>
      </section>

      <section class="card" aria-labelledby="dg-prov">
        <h2 id="dg-prov">{{ 'pf.diagnostics.providers' | t }}</h2>
        @if (r.providers.length === 0) {
          <ui-empty [title]="'pf.diagnostics.noProviders' | t" />
        } @else {
          <table class="tbl">
            <thead>
              <tr>
                <th scope="col">{{ 'pf.diagnostics.colProvider' | t }}</th>
                <th scope="col">{{ 'pf.diagnostics.colInstalled' | t }}</th>
                <th scope="col">{{ 'pf.diagnostics.colAuth' | t }}</th>
                <th scope="col">{{ 'pf.diagnostics.colProtocol' | t }}</th>
                <th scope="col">{{ 'pf.diagnostics.colCaps' | t }}</th>
                <th scope="col">{{ 'pf.diagnostics.colNext' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (p of r.providers; track p.id) {
                <tr>
                  <td>
                    <b>{{ p.name }}</b
                    ><br /><span class="mono muted">{{ p.id }}</span>
                  </td>
                  <td><ui-state-badge [state]="p.installed ? 'ok' : 'error'" /></td>
                  <td>{{ p.authentication }}</td>
                  <td class="mono">{{ p.protocol }}</td>
                  <td>
                    @for (cap of supportedCaps(p.capabilities); track cap) {
                      <span class="cap">{{ cap }}</span>
                    }
                  </td>
                  <td>{{ p.next_action }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </section>

      <section class="card" aria-labelledby="dg-mcp">
        <h2 id="dg-mcp">{{ 'pf.diagnostics.mcpDoctor' | t }}</h2>
        @if (r.mcp_servers.length === 0) {
          <ui-empty [title]="'pf.diagnostics.noServers' | t" />
        } @else {
          <div class="grid">
            @for (s of r.mcp_servers; track s.server_id) {
              <article class="card srv" [class.bad]="s.state === 'error'">
                <header>
                  <h3>
                    {{ s.name }} <span class="mono muted">{{ s.server_id }}</span>
                  </h3>
                  <ui-state-badge [state]="s.state" />
                </header>
                <ul class="checks">
                  @for (c of s.checks; track c.check) {
                    <li>
                      <ui-state-badge [state]="c.state" />
                      <span class="chk-name">{{ c.check }}</span>
                      @if (c.class) {
                        <span class="cls">[{{ c.class }}]</span>
                      }
                      <span class="muted">{{ c.detail }}</span>
                    </li>
                  }
                </ul>
                @if (s.corrective.length) {
                  <p class="muted">
                    {{ 'pf.diagnostics.corrective' | t }}:
                    {{ s.corrective.join('; ') }}
                  </p>
                }
              </article>
            }
          </div>
        }
      </section>
    }
  `,
  styles: [
    `
      .meta {
        margin-bottom: 1rem;
      }
      .kv {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 0.25rem 0.75rem;
      }
      .kv dt {
        color: var(--muted, #666);
      }
      .mono {
        font-family: var(--mono, monospace);
        font-size: 0.85em;
      }
      .checks {
        list-style: none;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
      }
      .checks li {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .chk-name {
        font-weight: 600;
        min-width: 7rem;
      }
      .tbl {
        width: 100%;
        border-collapse: collapse;
      }
      .tbl th,
      .tbl td {
        text-align: left;
        padding: 0.4rem 0.5rem;
        border-bottom: 1px solid var(--border, #3333);
        vertical-align: top;
      }
      .cap {
        display: inline-block;
        background: var(--accent-soft, #234);
        border-radius: 4px;
        padding: 0 0.35rem;
        margin: 0 0.25rem 0.25rem 0;
        font-size: 0.8em;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 0.75rem;
      }
      .srv header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .srv h3 {
        margin: 0;
        font-size: 1rem;
      }
      .srv.bad {
        border-color: var(--danger, #c33);
      }
      .cls {
        color: var(--warn, #c90);
        font-size: 0.8em;
      }
      section.card {
        margin-bottom: 1rem;
      }
    `,
  ],
})
export class PfDiagnosticsPage implements OnInit {
  private bridge = inject(PfBridge);
  report = signal<DiagnosticReport | null>(null);
  loading = signal(true);
  err = signal<ApiError | null>(null);

  ngOnInit() {
    void this.load();
  }

  async load() {
    this.loading.set(true);
    this.err.set(null);
    try {
      this.report.set(await firstValueFrom(this.bridge.diagnostics()));
    } catch (e) {
      this.err.set(e as ApiError);
    } finally {
      this.loading.set(false);
    }
  }

  supportedCaps(caps: Record<string, string>): string[] {
    return Object.entries(caps)
      .filter(([, s]) => s === 'supported' || s === 'unverified')
      .map(([n, s]) => (s === 'unverified' ? `${n}?` : n));
  }
}
