import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { ProfileDescriptor, InstallationReceipt } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';

@Component({
  selector: 'page-profiles',
  standalone: true,
  imports: [TPipe, PageHeader, EmptyState, ErrorState],
  template: `
    <ui-page-header [title]="'profiles.title' | t" [subtitle]="'profiles.subtitle' | t" />

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (receipt(); as r) {
      <section class="card receipt">
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
      @for (p of profiles(); track p.id) {
        <article class="card" [attr.data-current]="p.current || null">
          <h2>{{ p.id }}</h2>
          <p class="muted">{{ description(p) | t }}</p>
          <ul class="comps">
            @for (c of componentList(p); track c.id) {
              <li [attr.data-on]="c.on || null">{{ c.id }}</li>
            }
          </ul>
          @if (!p.current) {
            <button class="btn btn--primary" [disabled]="busy()" (click)="apply(p.id)">
              {{ 'profiles.apply' | t }}
            </button>
          } @else {
            <span class="current">{{ 'profiles.current' | t }}</span>
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
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      padding: var(--space-5);
    }
    .card[data-current] {
      border-color: var(--accent);
    }
    .card h2 {
      margin: 0 0 6px;
      text-transform: capitalize;
    }
    .muted {
      color: var(--fg-muted);
      margin-top: 0;
    }
    .comps {
      list-style: none;
      padding: 0;
      margin: var(--space-3) 0;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .comps li {
      font-size: var(--font-xs);
      padding: 2px 8px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--border);
      color: var(--fg-muted);
    }
    .comps li[data-on] {
      border-color: var(--ok);
      color: var(--ok);
    }
    .current {
      color: var(--accent);
      font-weight: 600;
      font-size: var(--font-sm);
    }
    .receipt {
      margin-bottom: var(--space-4);
    }
    .refusal {
      color: var(--warn);
    }
    .btn--primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-fg);
    }
  `,
})
export class ProfilesPage {
  private readonly api = inject(PortalApi);
  readonly profiles = signal<ProfileDescriptor[]>([]);
  readonly receipt = signal<InstallationReceipt | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      this.profiles.set(await firstValueFrom(this.api.profiles()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  description(p: ProfileDescriptor): string {
    return p.description_key;
  }

  componentList(p: ProfileDescriptor): { id: string; on: boolean }[] {
    return Object.entries(p.components ?? {}).map(([id, on]) => ({ id, on }));
  }

  async apply(id: string): Promise<void> {
    this.busy.set(true);
    try {
      const r = await firstValueFrom(this.api.profilesApply(id));
      this.receipt.set(r);
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }
}
