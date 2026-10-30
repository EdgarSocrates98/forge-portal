import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { PfApi } from '../pf-api.service';
import { ApiError } from '../../core/api/api.error';
import { PfProduct, PfWorkspace } from '../pf.models';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { ToastService } from '../../shared/toast';

/**
 * Products — the real engine catalog, filterable by workspace. Create and
 * open are real calls/routes; the list is never synthesized client-side.
 */
@Component({
  selector: 'page-pf-products',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [RouterLink, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header title="Products" subtitle="Product Forge engine catalog">
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        Refresh
      </button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    <section class="card">
      <h2 class="h">New product</h2>
      <form class="inline" (submit)="create($event)">
        <select
          class="select"
          [value]="ws()"
          (change)="ws.set($any($event.target).value)"
          [attr.aria-label]="'Workspace'"
          required
        >
          <option value="" disabled>Workspace…</option>
          @for (w of workspaces(); track w.id) {
            <option [value]="w.id">{{ w.name }}</option>
          }
        </select>
        <input
          class="input"
          [value]="name()"
          (input)="name.set($any($event.target).value)"
          placeholder="Product name"
          required
        />
        <input
          class="input"
          [value]="domain()"
          (input)="domain.set($any($event.target).value)"
          placeholder="Domain (optional)"
        />
        <button class="btn btn--primary" type="submit" [disabled]="busy() || !ws() || !name().trim()">
          Create
        </button>
      </form>
    </section>

    @if (workspaces().length > 1) {
      <div class="frow" role="group" aria-label="Filter by workspace">
        <button
          class="fg-pill"
          type="button"
          [attr.data-tone]="wsFilter() === null ? 'accent' : null"
          [attr.aria-pressed]="wsFilter() === null"
          (click)="wsFilter.set(null)"
        >
          All workspaces
        </button>
        @for (w of workspaces(); track w.id) {
          <button
            class="fg-pill"
            type="button"
            [attr.data-tone]="wsFilter() === w.id ? 'accent' : null"
            [attr.aria-pressed]="wsFilter() === w.id"
            (click)="wsFilter.set(wsFilter() === w.id ? null : w.id)"
          >
            {{ w.name }}
          </button>
        }
      </div>
    }

    @if (loading()) {
      <div role="status" aria-label="loading"><ui-skeleton kind="card" [lines]="3" /></div>
    } @else if (filtered().length) {
      <div class="grid stagger">
        @for (p of filtered(); track p.id) {
          <article class="card pcard">
            <div class="pcard__top">
              <strong>{{ p.name }}</strong>
              <ui-state-badge
                [state]="p.status === 'active' ? 'ACTIVE' : 'muted'"
                [labelOverride]="p.status ?? 'unknown'"
              />
            </div>
            @if (p.description) {
              <p class="muted small">{{ p.description }}</p>
            }
            <div class="pcard__meta muted small">
              @if (p.domain) {
                <span class="chip">{{ p.domain }}</span>
              }
              <code>{{ p.id }}</code>
            </div>
            @if (wsName(p.workspace_id); as wsn) {
              <p class="muted small">Workspace: {{ wsn }}</p>
            }
            <div class="pcard__actions">
              <a class="btn btn--mini" [routerLink]="['/pf/products', p.id]">
                Open
                <ui-icon name="chevron-right" [size]="13" />
              </a>
            </div>
          </article>
        }
      </div>
    } @else if (!error()) {
      <ui-empty
        icon="gem"
        title="No products"
        [hint]="
          wsFilter()
            ? 'No products in this workspace — pick another filter or create one.'
            : 'Create your first product above.'
        "
      />
    }
  `,
  styles: `
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
    }
    .h {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .card {
      margin-bottom: var(--space-4);
    }
    .inline {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .inline .select {
      max-width: 14rem;
    }
    .inline .input {
      flex: 1;
      min-width: 10rem;
    }
    .frow {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .grid {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    }
    .pcard {
      display: grid;
      gap: var(--space-2);
      align-content: start;
    }
    .pcard__top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .pcard__meta {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .pcard__actions {
      display: flex;
      justify-content: flex-end;
      margin-top: var(--space-2);
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
  `,
})
export class PfProductsPage implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);

  readonly products = signal<PfProduct[]>([]);
  readonly workspaces = signal<PfWorkspace[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);

  readonly ws = signal('');
  readonly name = signal('');
  readonly domain = signal('');
  readonly wsFilter = signal<string | null>(null);

  readonly filtered = computed(() => {
    const f = this.wsFilter();
    const items = this.products();
    return f === null ? items : items.filter((p) => p.workspace_id === f);
  });

  private readonly wsMap = computed(
    () => new Map(this.workspaces().map((w) => [w.id, w.name])),
  );

  wsName(id: string): string | null {
    return this.wsMap().get(id) ?? null;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const [ws, ps] = await Promise.all([
        firstValueFrom(this.api.workspaces()),
        firstValueFrom(this.api.products()),
      ]);
      this.workspaces.set(ws.items ?? []);
      this.products.set(ps.items ?? []);
      if (!this.ws() && ws.items?.length) this.ws.set(ws.items[0].id);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  async create(ev: Event): Promise<void> {
    ev.preventDefault();
    const workspace_id = this.ws();
    const name = this.name().trim();
    if (!workspace_id || !name || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.createProduct({
          workspace_id,
          name,
          domain: this.domain().trim(),
        }),
      );
      this.name.set('');
      this.domain.set('');
      this.toast.show(`Product "${name}" created`, 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }
}
