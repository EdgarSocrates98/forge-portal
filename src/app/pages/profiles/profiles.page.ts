import { Component, computed, inject, signal } from '@angular/core';
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
import { UiSkeleton } from '../../shared/skeleton';
import { ConfirmService } from '../../shared/confirm-dialog';

interface CompareRow {
  id: string;
  a: boolean;
  b: boolean;
}

@Component({
  selector: 'page-profiles',
  standalone: true,
  imports: [TPipe, PageHeader, EmptyState, ErrorState, StateBadge, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'profiles.title' | t" [subtitle]="'profiles.subtitle' | t" />

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <section class="grid" role="status" aria-live="polite">
        @for (i of [1, 2, 3]; track i) {
          <ui-skeleton kind="card" />
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

    <section class="card compare" aria-labelledby="compare-h">
      <h2 id="compare-h">{{ 'profiles.compare' | t }}</h2>
      <p class="muted">{{ 'profiles.compare.hint' | t }}</p>
      <div class="compare__pickers">
        <label class="picker">
          <span>{{ 'profiles.compare.a' | t }}</span>
          <select
            class="input"
            [attr.aria-label]="'profiles.compare.a' | t"
            (change)="pickCompare('a', $event)"
          >
            @for (p of profiles(); track p.id) {
              <option [value]="p.id" [selected]="p.id === compareA()">{{ p.id }}</option>
            }
          </select>
        </label>
        <label class="picker">
          <span>{{ 'profiles.compare.b' | t }}</span>
          <select
            class="input"
            [attr.aria-label]="'profiles.compare.b' | t"
            (change)="pickCompare('b', $event)"
          >
            @for (p of profiles(); track p.id) {
              <option [value]="p.id" [selected]="p.id === compareB()">{{ p.id }}</option>
            }
          </select>
        </label>
      </div>

      @if (compareRows().length) {
        <table class="table compare__table">
          <thead>
            <tr>
              <th>{{ 'profiles.compare.component' | t }}</th>
              <th>{{ compareA() }}</th>
              <th>{{ compareB() }}</th>
            </tr>
          </thead>
          <tbody>
            @for (row of compareRows(); track row.id) {
              <tr [attr.data-diff]="row.a !== row.b || null">
                <td>
                  <code>{{ row.id }}</code>
                </td>
                <td [class.on]="row.a" [class.off]="!row.a">
                  @if (row.a) {
                    <ui-icon name="check" [size]="14" />
                  }
                  {{ (row.a ? 'state.enabled' : 'state.disabled') | t }}
                </td>
                <td [class.on]="row.b" [class.off]="!row.b">
                  @if (row.b) {
                    <ui-icon name="check" [size]="14" />
                  }
                  {{ (row.b ? 'state.enabled' : 'state.disabled') | t }}
                </td>
              </tr>
            }
          </tbody>
        </table>
        <p class="muted compare__summary">
          @if (diffCount() === 0) {
            {{ 'profiles.compare.same' | t }}
          } @else {
            {{ 'profiles.compare.differences' | t: { count: diffCount() } }}
          }
        </p>
      } @else if (profiles().length && !loading()) {
        <ui-empty [title]="'empty.noData' | t" />
      }
    </section>
  `,
  styles: `
    .grid {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      margin-bottom: var(--space-4);
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
      margin: 0 0 var(--space-3);
      font-weight: 650;
      letter-spacing: -0.01em;
      font-size: var(--font-lg);
    }
    .card__head h2 {
      margin: 0;
      text-transform: capitalize;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .card__head h2 ui-icon {
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
    .compare {
      margin-bottom: var(--space-4);
    }
    .compare__pickers {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      margin: var(--space-3) 0;
    }
    .picker {
      display: grid;
      gap: 4px;
      font-size: var(--font-sm);
      font-weight: 600;
    }
    .picker .input {
      min-width: 180px;
    }
    .compare__table td.on {
      color: var(--ok);
      font-weight: 600;
    }
    .compare__table td.off {
      color: var(--fg-muted);
    }
    .compare__table td ui-icon {
      vertical-align: -2px;
      margin-right: 4px;
    }
    .compare__table tr[data-diff] {
      background: color-mix(in srgb, var(--accent) 7%, transparent);
    }
    .compare__table tr[data-diff] td:first-child {
      border-left: 3px solid var(--accent);
      font-weight: 650;
    }
    .compare__summary {
      margin: var(--space-2) 0 0;
    }
  `,
})
export class ProfilesPage {
  private readonly api = inject(PortalApi);
  private readonly confirm = inject(ConfirmService);
  readonly profiles = signal<ProfileDescriptor[]>([]);
  readonly receipt = signal<InstallationReceipt | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly busy = signal(false);
  readonly loading = signal(true);
  readonly compareA = signal<string | null>(null);
  readonly compareB = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const list = await firstValueFrom(this.api.profiles());
      this.profiles.set(list);
      // default comparison: current profile vs the first other one
      if (list.length && (!this.compareA() || !this.compareB())) {
        this.compareA.set(list.find((p) => p.current)?.id ?? list[0].id);
        this.compareB.set(list.find((p) => !p.current)?.id ?? list[0].id);
      }
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

  pickCompare(which: 'a' | 'b', e: Event): void {
    const value = (e.target as HTMLSelectElement).value;
    if (which === 'a') this.compareA.set(value);
    else this.compareB.set(value);
  }

  /** Side-by-side rows over the union of both component maps — a key
   *  missing on one side reads as "off" for that profile, never as an
   *  invented "on". */
  readonly compareRows = computed<CompareRow[]>(() => {
    const a = this.profiles().find((p) => p.id === this.compareA());
    const b = this.profiles().find((p) => p.id === this.compareB());
    if (!a || !b) return [];
    const keys = [
      ...new Set([...Object.keys(a.components ?? {}), ...Object.keys(b.components ?? {})]),
    ];
    keys.sort();
    return keys.map((id) => ({
      id,
      a: Boolean(a.components?.[id]),
      b: Boolean(b.components?.[id]),
    }));
  });

  readonly diffCount = computed(() => this.compareRows().filter((r) => r.a !== r.b).length);

  async apply(id: string): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'profiles.apply',
      message: 'profiles.apply.confirm',
      confirmKey: 'profiles.apply',
    });
    if (!ok) return;
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
