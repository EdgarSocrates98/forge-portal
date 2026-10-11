import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { HostDetection } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';

@Component({
  selector: 'page-hosts',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState],
  template: `
    <ui-page-header [title]="'hosts.title' | t" [subtitle]="'hosts.subtitle' | t">
      <button class="btn" (click)="load()">{{ 'state.refresh' | t }}</button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    <section class="grid">
      @for (h of hosts(); track h.host) {
        <article class="card" [attr.data-off]="!h.detected || null">
          <header class="card__head">
            <h2>{{ h.host }}</h2>
            <ui-state-badge [state]="h.supported ? 'supported' : 'unsupported'" />
          </header>
          <dl class="kv">
            <div>
              <dt>{{ 'hosts.detected' | t }}</dt>
              <dd>{{ (h.detected ? 'state.yes' : 'state.no') | t }}</dd>
            </div>
            @if (h.version) {
              <div>
                <dt>{{ 'hosts.version' | t }}</dt>
                <dd>{{ h.version }}</dd>
              </div>
            }
            <div>
              <dt>{{ 'hosts.auth' | t }}</dt>
              <dd>{{ authLabel(h) | t }}</dd>
            </div>
            <div>
              <dt>{{ 'hosts.integration' | t }}</dt>
              <dd><ui-state-badge [state]="h.integration" [labelOverride]="h.integration" /></dd>
            </div>
          </dl>
          @if (h.detail) {
            <p class="muted">{{ h.detail }}</p>
          }
          <div class="row">
            <button class="btn" [disabled]="!h.detected" (click)="launch(h)">
              {{ 'hosts.launch' | t }}
            </button>
          </div>
          @if (launchHint(); as hint) {
            @if (hint.host === h.host) {
              <div class="hint">
                <p class="muted">{{ 'hosts.launch.copyHint' | t }}</p>
                <code>{{ hint.command }}</code>
              </div>
            }
          }
        </article>
      } @empty {
        @if (!error()) {
          <ui-empty [title]="'empty.noData' | t" [hint]="'empty.noData.hint' | t" />
        }
      }
    </section>
  `,
  styles: `
    .grid {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      padding: var(--space-5);
    }
    .card[data-off] {
      opacity: 0.55;
    }
    .card__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card h2 {
      margin: 0;
      text-transform: capitalize;
    }
    .kv {
      display: grid;
      gap: 6px;
      margin: var(--space-3) 0;
    }
    .kv div {
      display: flex;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .kv dt {
      color: var(--fg-muted);
    }
    .kv dd {
      margin: 0;
    }
    .muted {
      color: var(--fg-muted);
    }
    .row {
      margin-top: var(--space-3);
    }
    .hint {
      margin-top: var(--space-3);
      padding: var(--space-3);
      border: 1px dashed var(--border);
      border-radius: var(--radius-md);
    }
    .hint code {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
    }
  `,
})
export class HostsPage {
  private readonly api = inject(PortalApi);
  readonly hosts = signal<HostDetection[]>([]);
  readonly launchHint = signal<{ host: string; command: string } | null>(null);
  readonly error = signal<ApiError | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      this.hosts.set(await firstValueFrom(this.api.hosts()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  authLabel(h: HostDetection): string {
    if (h.logged_in === null) return 'hosts.auth.unknown';
    return h.logged_in ? 'hosts.auth.signedIn' : 'hosts.auth.signedOut';
  }

  async launch(h: HostDetection): Promise<void> {
    this.launchHint.set(null);
    try {
      const r = await firstValueFrom(this.api.hostsLaunch(h.host));
      this.launchHint.set({
        host: h.host,
        command: r.command ?? r.detail ?? r.refusal ?? '',
      });
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }
}
