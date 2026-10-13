import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { ProfileDescriptor, InstallationReceipt } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { StateBadge } from '../../shared/state-badge';
import { UiIcon } from '../../shared/icon';

@Component({
  selector: 'page-profiles',
  standalone: true,
  imports: [TPipe, PageHeader, EmptyState, ErrorState, StateBadge, UiIcon],
  template: `
    <ui-page-header [title]="'profiles.title' | t" [subtitle]="'profiles.subtitle' | t" />

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <section class="grid">
        @for (i of [1, 2, 3]; track i) {
          <div class="skeleton skeleton--block"></div>
        }
      </section>
    }

    @if (receipt(); as r) {
      <section class="card receipt" data-lift>
        <p class="receipt__status">
          <ui-state-badge [state]="r.status" />
          @if (r.detail) {
            <span>{{ r.detail }}</span>
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
        <article class="card" data-lift [attr.data-current]="p.current || null">
          <div class="card__head">
            <h2><ui-icon name="profiles" [size]="16" />{{ p.id }}</h2>
            @if (p.current) {
              <span class="current">
                <ui-icon name="check" [size]="12" />
                {{ 'profiles.current' | t }}
              </span>
            }
          </div>
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
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .card[data-current] {
      border-color: color-mix(in srgb, var(--accent) 55%, transparent);
      background: linear-gradient(
        160deg,
        color-mix(in srgb, var(--accent) 7%, var(--bg-elevated)) 0%,
        var(--bg-elevated) 55%
      );
      box-shadow:
        var(--elev-card),
        0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .card__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .card h2 {
      margin: 0;
      text-transform: capitalize;
      font-weight: 650;
      letter-spacing: -0.01em;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .card h2 ui-icon {
      color: var(--accent);
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
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--accent);
      font-weight: 600;
      font-size: var(--font-xs);
      background: var(--accent-bg);
      border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
      border-radius: var(--radius-pill);
      padding: 2px var(--space-2);
    }
    .receipt {
      margin-bottom: var(--space-4);
    }
    .receipt__status {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      margin: 0;
    }
    .refusal {
      color: var(--warn);
    }
  `,
})
export class ProfilesPage {
  private readonly api = inject(PortalApi);
  readonly profiles = signal<ProfileDescriptor[]>([]);
  readonly receipt = signal<InstallationReceipt | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal(false);
  readonly loading = signal(true);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.profiles.set(await firstValueFrom(this.api.profiles()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
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
