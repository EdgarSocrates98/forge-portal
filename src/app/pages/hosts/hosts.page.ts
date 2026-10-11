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
import { UiIcon } from '../../shared/icon';

@Component({
  selector: 'page-hosts',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon],
  template: `
    <ui-page-header [title]="'hosts.title' | t" [subtitle]="'hosts.subtitle' | t">
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <section class="grid">
        @for (i of [1, 2, 3, 4]; track i) {
          <div class="skeleton skeleton--block"></div>
        }
      </section>
    }

    <section class="grid">
      @for (h of hosts(); track h.host) {
        <article class="card" data-lift [attr.data-off]="!h.detected || null">
          <header class="card__head">
            <h2><ui-icon name="hosts" [size]="16" />{{ h.host }}</h2>
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
            <button
              class="btn"
              [class.btn--primary]="h.detected"
              [disabled]="!h.detected"
              (click)="launch(h)"
            >
              <ui-icon name="external" [size]="14" />
              {{ 'hosts.launch' | t }}
            </button>
          </div>
          @if (launchHint(); as hint) {
            @if (hint.host === h.host) {
              <div class="hint" role="note">
                <div class="hint__head">
                  <p class="hint__title">
                    <ui-icon name="terminal" [size]="13" />{{ 'hosts.launch.copyHint' | t }}
                  </p>
                  <button
                    class="btn btn--mini"
                    (click)="copyCommand(hint.command)"
                    [attr.aria-label]="'state.copy' | t"
                  >
                    <ui-icon [name]="copied() ? 'check' : 'copy'" [size]="13" />
                    {{ (copied() ? 'state.copied' : 'state.copy') | t }}
                  </button>
                </div>
                <code>{{ hint.command }}</code>
              </div>
            }
          }
        </article>
      } @empty {
        @if (!error() && !loading()) {
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
    .card[data-off] {
      opacity: 0.55;
      filter: grayscale(0.6);
    }
    .card__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card h2 {
      margin: 0;
      text-transform: capitalize;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .card h2 ui-icon {
      color: var(--accent);
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
      border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
      border-radius: var(--radius-md);
      background: var(--accent-bg);
      display: grid;
      gap: 4px;
    }
    .hint__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .hint__title {
      margin: 0;
      font-size: var(--font-xs);
      font-weight: 600;
      color: var(--accent);
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
    }
    .hint code {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
      word-break: break-all;
    }
  `,
})
export class HostsPage {
  private readonly api = inject(PortalApi);
  readonly hosts = signal<HostDetection[]>([]);
  readonly launchHint = signal<{ host: string; command: string } | null>(null);
  readonly copied = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly loading = signal(true);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.hosts.set(await firstValueFrom(this.api.hosts()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
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

  async copyCommand(cmd: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(cmd);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1600);
    } catch {
      /* clipboard indisponível — comando continua visível para copiar à mão */
    }
  }
}
