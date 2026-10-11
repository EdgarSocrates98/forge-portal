import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { InstallationReceipt, McpServerDescriptor } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';

@Component({
  selector: 'page-mcp',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState],
  template: `
    <ui-page-header [title]="'mcp.title' | t" [subtitle]="'mcp.subtitle' | t">
      <button class="btn btn--primary" [disabled]="busy()" (click)="verify()">
        {{ 'mcp.verify' | t }}
      </button>
      <button class="btn" (click)="load()">{{ 'state.refresh' | t }}</button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (receipt(); as r) {
      <section class="card">
        <p>
          <strong>{{ r.status }}</strong>
          @if (r.detail) {
            — {{ r.detail }}
          }
        </p>
        @if (r.refusal) {
          <p class="refusal">
            <code>{{ r.refusal }}</code>
            @if (r.unlock) {
              — {{ r.unlock }}
            }
          </p>
        }
      </section>
    }

    <section class="grid">
      @for (s of servers(); track s.id) {
        <article class="card">
          <header class="head">
            <h2>{{ s.id }}</h2>
            <ui-state-badge [state]="s.state" />
          </header>
          <dl class="kv">
            @if (s.host) {
              <div>
                <dt>{{ 'table.host' | t }}</dt>
                <dd>{{ s.host }}</dd>
              </div>
            }
            <div>
              <dt>{{ 'mcp.tools' | t: { count: s.tools_count ?? 0 } }}</dt>
              <dd>{{ s.tools_count ?? '—' }}</dd>
            </div>
            <div>
              <dt>{{ 'mcp.lastVerify' | t }}</dt>
              <dd>{{ s.last_verify ?? ('mcp.never' | t) }}</dd>
            </div>
          </dl>
          @if (s.detail) {
            <p class="muted">{{ s.detail }}</p>
          }
          @if (s.limitations?.length) {
            <details>
              <summary>{{ 'mcp.limitations' | t }}</summary>
              <ul>
                @for (l of s.limitations; track l) {
                  <li>{{ l }}</li>
                }
              </ul>
            </details>
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
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      padding: var(--space-5);
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    h2 {
      margin: 0;
      font-size: var(--font-lg);
    }
    .kv {
      display: grid;
      gap: 6px;
      margin: var(--space-3) 0;
    }
    .kv div {
      display: flex;
      justify-content: space-between;
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
    .refusal {
      color: var(--warn);
    }
    .btn--primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-fg);
    }
    details {
      margin-top: var(--space-3);
      font-size: var(--font-sm);
    }
  `,
})
export class McpPage {
  private readonly api = inject(PortalApi);
  readonly servers = signal<McpServerDescriptor[]>([]);
  readonly receipt = signal<InstallationReceipt | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      this.servers.set(await firstValueFrom(this.api.mcpServers()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  async verify(): Promise<void> {
    this.busy.set(true);
    this.receipt.set(null);
    try {
      this.receipt.set(await firstValueFrom(this.api.mcpVerify()));
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }
}
