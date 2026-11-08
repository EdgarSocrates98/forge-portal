import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { ApiError } from '../../core/api/api.error';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { PfApi } from '../../pf/pf-api.service';
import { PfApiSpec, PfProduct, PfProductHealth } from '../../pf/pf.models';

/**
 * API Operations is the Portal's decision surface over Product Forge's real
 * API inventory. It deliberately stops at the evidence boundary: imported
 * contracts, parsed operations, product health and impact are shown here;
 * Doctor/agent execution is opened through the existing governed task flow.
 */
@Component({
  selector: 'page-api-operations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TPipe, EmptyState, ErrorState, PageHeader, StateBadge, UiIcon, UiSkeleton],
  template: `
    <ui-page-header
      [title]="'apiOperations.title' | t"
      [subtitle]="'apiOperations.subtitle' | t"
      hintId="diagnose"
    >
      <button class="btn" [disabled]="loading() || detailLoading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
      <a class="btn btn--primary" routerLink="/tasks" [queryParams]="{ new: '1' }">
        <ui-icon name="tasks" [size]="15" />
        {{ 'apiOperations.newInvestigation' | t }}
      </a>
    </ui-page-header>

    <section class="hero" aria-labelledby="api-ops-hero-title">
      <div>
        <p class="eyebrow">{{ 'apiOperations.eyebrow' | t }}</p>
        <h2 id="api-ops-hero-title">{{ 'apiOperations.heroTitle' | t }}</h2>
        <p class="hero__copy">{{ 'apiOperations.heroCopy' | t }}</p>
      </div>
      <div class="hero__signal">
        <span class="muted small">{{ 'nav.productForge' | t }}</span>
        <ui-state-badge [state]="surfaceState()" />
        <span class="muted small">{{ surfaceHint() }}</span>
      </div>
    </section>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    } @else if (loading()) {
      <div class="loading" role="status" aria-label="loading API operations">
        <ui-skeleton kind="card" [lines]="5" />
      </div>
    } @else {
      <div class="workspace">
        <aside class="service-panel" aria-labelledby="services-title">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">{{ 'apiOperations.explorerEyebrow' | t }}</p>
              <h2 id="services-title">{{ 'apiOperations.services' | t }}</h2>
            </div>
            <span class="count">{{ products().length }}</span>
          </div>
          @if (products().length) {
            <div
              class="service-list"
              role="listbox"
              [attr.aria-label]="'apiOperations.services' | t"
            >
              @for (product of products(); track product.id) {
                <button
                  class="service-row"
                  [class.service-row--selected]="selectedProductId() === product.id"
                  [attr.aria-selected]="selectedProductId() === product.id"
                  role="option"
                  (click)="chooseProduct(product.id)"
                >
                  <span class="service-row__mark" aria-hidden="true"></span>
                  <span class="service-row__body">
                    <strong>{{ product.name }}</strong>
                    <span>{{ product.domain || product.workspace_id }}</span>
                  </span>
                  <ui-icon name="chevron-right" [size]="14" />
                </button>
              }
            </div>
          } @else {
            <ui-empty icon="network" [title]="'apiOperations.noServices' | t" />
          }
          <p class="panel-footnote">{{ 'apiOperations.serviceSource' | t }}</p>
        </aside>

        <main class="detail" aria-live="polite">
          @if (!selectedProduct()) {
            <section class="empty-detail card">
              <ui-empty icon="mcp" [title]="'apiOperations.selectService' | t" />
              <p class="muted">{{ 'apiOperations.selectServiceHint' | t }}</p>
            </section>
          } @else {
            <section class="service-header card">
              <div>
                <p class="eyebrow">{{ 'apiOperations.selectedService' | t }}</p>
                <h2>{{ selectedProduct()!.name }}</h2>
                <p class="muted">{{ selectedProduct()!.description || selectedProduct()!.id }}</p>
              </div>
              <a
                class="btn"
                [routerLink]="['/pf/products', selectedProduct()!.id]"
                [queryParams]="{ tab: 'apis' }"
              >
                {{ 'apiOperations.openProductForge' | t }}
                <ui-icon name="external" [size]="14" />
              </a>
            </section>

            @if (detailError(); as e) {
              <ui-error [error]="e" (retry)="loadProduct(selectedProductId())" />
            } @else if (detailLoading()) {
              <div class="loading" role="status" aria-label="loading API contract">
                <ui-skeleton kind="card" [lines]="6" />
              </div>
            } @else {
              <section class="metrics" aria-label="API operation summary">
                <div class="metric card">
                  <span>{{ 'apiOperations.health' | t }}</span
                  ><strong>{{ healthScore() }}</strong
                  ><small>{{ healthLabel() }}</small>
                </div>
                <div class="metric card">
                  <span>{{ 'apiOperations.contracts' | t }}</span
                  ><strong>{{ specs().length }}</strong
                  ><small>{{ 'apiOperations.imported' | t }}</small>
                </div>
                <div class="metric card">
                  <span>{{ 'apiOperations.endpoints' | t }}</span
                  ><strong>{{ operationCount() }}</strong
                  ><small>{{ 'apiOperations.parsed' | t }}</small>
                </div>
              </section>

              <section class="contract-section card" aria-labelledby="contract-title">
                <div class="section-heading">
                  <div>
                    <p class="eyebrow">{{ 'apiOperations.contractEyebrow' | t }}</p>
                    <h2 id="contract-title">{{ 'apiOperations.contractsTitle' | t }}</h2>
                  </div>
                  <span class="muted small">{{ 'apiOperations.contractsHint' | t }}</span>
                </div>
                @if (specs().length) {
                  <div class="contract-list">
                    @for (spec of specs(); track spec.id) {
                      <button
                        class="contract-row"
                        [class.contract-row--selected]="selectedSpecId() === spec.id"
                        (click)="chooseSpec(spec.id)"
                      >
                        <span class="contract-type">{{ spec.kind || 'API' }}</span>
                        <span class="contract-body"
                          ><strong>{{ spec.name }}</strong
                          ><small>{{
                            spec.version ? 'v' + spec.version : ('apiOperations.versionUnknown' | t)
                          }}</small></span
                        >
                        <span class="contract-count"
                          >{{ spec.surface?.operations?.length ?? 0 }}
                          {{ 'apiOperations.endpointsShort' | t }}</span
                        >
                        <ui-icon name="chevron-right" [size]="14" />
                      </button>
                    }
                  </div>
                } @else {
                  <ui-empty icon="diff" [title]="'apiOperations.noContracts' | t" />
                  <p class="muted empty-hint">{{ 'apiOperations.noContractsHint' | t }}</p>
                }
              </section>

              @if (selectedSpec(); as spec) {
                <section class="endpoint-section card" aria-labelledby="endpoint-title">
                  <div class="section-heading">
                    <div>
                      <p class="eyebrow">{{ 'apiOperations.endpointEyebrow' | t }}</p>
                      <h2 id="endpoint-title">{{ spec.name }}</h2>
                    </div>
                    <ui-state-badge [state]="health() ? 'AVAILABLE' : 'UNVERIFIED'" />
                  </div>
                  @if (spec.surface?.operations?.length) {
                    <div class="endpoint-list">
                      @for (op of spec.surface!.operations!; track op.method + ' ' + op.path) {
                        <div class="endpoint-row">
                          <span class="method" [attr.data-method]="op.method.toLowerCase()">{{
                            op.method.toUpperCase()
                          }}</span>
                          <code>{{ op.path }}</code>
                          <span class="endpoint-summary">{{
                            op.summary || ('apiOperations.noSummary' | t)
                          }}</span>
                          <span class="muted small"
                            >{{ op.params?.length ?? 0 }} {{ 'apiOperations.params' | t }}</span
                          >
                        </div>
                      }
                    </div>
                  } @else {
                    <p class="muted">{{ 'apiOperations.noEndpoints' | t }}</p>
                  }
                </section>

                <section class="next-action" aria-labelledby="next-title">
                  <div>
                    <p class="eyebrow">{{ 'apiOperations.nextEyebrow' | t }}</p>
                    <h2 id="next-title">{{ 'apiOperations.nextTitle' | t }}</h2>
                    <p>{{ 'apiOperations.nextCopy' | t }}</p>
                  </div>
                  <a class="btn btn--primary" routerLink="/tasks" [queryParams]="{ new: '1' }">
                    <ui-icon name="tasks" [size]="14" />
                    {{ 'apiOperations.startInvestigation' | t }}
                  </a>
                </section>
              }
            }
          }
        </main>
      </div>
    }
  `,
  styles: `
    .hero {
      display: flex;
      justify-content: space-between;
      gap: var(--space-5);
      align-items: center;
      padding: var(--space-5);
      margin-bottom: var(--space-5);
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
      border-radius: var(--radius-lg);
      background: linear-gradient(
        105deg,
        var(--bg-card),
        color-mix(in srgb, var(--accent-bg) 34%, var(--bg-card))
      );
    }
    .hero h2,
    .service-header h2,
    .section-heading h2,
    .next-action h2 {
      margin: 0;
      font-size: var(--font-xl);
    }
    .hero__signal {
      display: grid;
      gap: 6px;
      min-width: 150px;
      justify-items: end;
      text-align: right;
    }
    .eyebrow {
      margin: 0 0 5px;
      color: var(--accent-ink);
      font-size: var(--font-xs);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
      gap: var(--space-5);
      align-items: start;
    }
    .service-panel,
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-card);
    }
    .service-panel {
      position: sticky;
      top: var(--space-4);
      overflow: hidden;
    }
    .panel-heading,
    .section-heading {
      display: flex;
      justify-content: space-between;
      gap: var(--space-3);
      align-items: flex-start;
      padding: var(--space-4);
    }
    .count {
      display: inline-grid;
      place-items: center;
      min-width: 1.65rem;
      height: 1.65rem;
      border-radius: var(--radius-pill);
      background: var(--accent-bg);
      color: var(--accent-ink);
      font-size: var(--font-xs);
      font-weight: 700;
    }
    .service-list,
    .contract-list,
    .endpoint-list {
      display: grid;
    }
    .service-row,
    .contract-row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      border: 0;
      border-top: 1px solid var(--border);
      background: transparent;
      color: var(--fg);
      text-align: left;
      cursor: pointer;
    }
    .service-row {
      padding: var(--space-3) var(--space-4);
    }
    .service-row:hover,
    .service-row:focus-visible,
    .contract-row:hover,
    .contract-row:focus-visible {
      background: var(--bg-hover);
    }
    .service-row--selected,
    .contract-row--selected {
      background: var(--accent-bg);
    }
    .service-row__mark {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--ok);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 20%, transparent);
      flex: 0 0 auto;
    }
    .service-row__body,
    .contract-body {
      display: grid;
      gap: 3px;
      min-width: 0;
      flex: 1;
    }
    .service-row__body span,
    .contract-body small {
      color: var(--fg-muted);
      font-size: var(--font-xs);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail {
      min-width: 0;
      display: grid;
      gap: var(--space-4);
    }
    .service-header {
      display: flex;
      justify-content: space-between;
      gap: var(--space-4);
      align-items: center;
      padding: var(--space-5);
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-3);
    }
    .metric {
      display: grid;
      gap: 4px;
      padding: var(--space-4);
    }
    .metric span {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .metric strong {
      font-size: var(--font-2xl);
      letter-spacing: -0.04em;
    }
    .metric small {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .contract-section,
    .endpoint-section {
      overflow: hidden;
    }
    .contract-row {
      padding: var(--space-3) var(--space-4);
    }
    .contract-type {
      min-width: 4.8rem;
      color: var(--accent-ink);
      font-size: var(--font-xs);
      font-weight: 700;
    }
    .contract-count {
      color: var(--fg-muted);
      font-size: var(--font-xs);
      white-space: nowrap;
    }
    .endpoint-row {
      display: grid;
      grid-template-columns: 4.5rem minmax(10rem, 0.8fr) minmax(0, 1.3fr) auto;
      gap: var(--space-3);
      align-items: center;
      padding: var(--space-3) var(--space-4);
      border-top: 1px solid var(--border);
    }
    .method {
      color: var(--info);
      font-size: var(--font-xs);
      font-weight: 750;
    }
    .method[data-method='post'],
    .method[data-method='put'],
    .method[data-method='patch'] {
      color: var(--warn);
    }
    .method[data-method='delete'] {
      color: var(--error);
    }
    .endpoint-summary {
      min-width: 0;
      overflow: hidden;
      color: var(--fg-muted);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .next-action {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-5);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--accent-bg) 45%, var(--bg-card));
    }
    .next-action p {
      max-width: 62ch;
      margin: 5px 0 0;
      color: var(--fg-muted);
    }
    .empty-detail {
      min-height: 250px;
      display: grid;
      place-items: center;
      align-content: center;
      gap: var(--space-2);
      padding: var(--space-6);
      text-align: center;
    }
  `,
})
export class ApiOperationsPage {
  private readonly pf = inject(PfApi);

  readonly products = signal<PfProduct[]>([]);
  readonly specs = signal<PfApiSpec[]>([]);
  readonly health = signal<PfProductHealth | null>(null);
  readonly selectedProductId = signal('');
  readonly selectedSpecId = signal('');
  readonly loading = signal(true);
  readonly detailLoading = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly detailError = signal<ApiError | null>(null);

  readonly selectedProduct = computed(
    () => this.products().find((p) => p.id === this.selectedProductId()) ?? null,
  );
  readonly selectedSpec = computed(
    () => this.specs().find((s) => s.id === this.selectedSpecId()) ?? null,
  );
  readonly operationCount = computed(() =>
    this.specs().reduce((n, spec) => n + (spec.surface?.operations?.length ?? 0), 0),
  );
  readonly surfaceState = computed(() => {
    if (this.error()) return 'UNAVAILABLE';
    if (this.loading() || this.detailLoading()) return 'LOADING';
    if (!this.products().length) return 'EMPTY';
    return this.health() ? 'AVAILABLE' : 'UNVERIFIED';
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(this.pf.products());
      const products = result.items ?? [];
      this.products.set(products);
      const current = this.selectedProductId();
      const next = products.some((p) => p.id === current) ? current : (products[0]?.id ?? '');
      this.selectedProductId.set(next);
      if (next) await this.loadProduct(next);
      else this.resetDetail();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  chooseProduct(id: string): void {
    if (id === this.selectedProductId() && this.specs().length) return;
    this.selectedProductId.set(id);
    void this.loadProduct(id);
  }

  chooseSpec(id: string): void {
    this.selectedSpecId.set(id);
  }

  async loadProduct(id: string): Promise<void> {
    if (!id) return;
    this.detailLoading.set(true);
    this.detailError.set(null);
    this.specs.set([]);
    this.selectedSpecId.set('');
    this.health.set(null);
    const [apis, health] = await Promise.allSettled([
      firstValueFrom(this.pf.apis(id)),
      firstValueFrom(this.pf.productHealth(id)),
    ]);
    if (apis.status === 'fulfilled') {
      const specs = apis.value.items ?? [];
      this.specs.set(specs);
      this.selectedSpecId.set(specs[0]?.id ?? '');
    }
    if (health.status === 'fulfilled') this.health.set(health.value);
    if (apis.status === 'rejected' && health.status === 'rejected') {
      const e = apis.reason;
      this.detailError.set(e instanceof ApiError ? e : new ApiError(0));
    }
    this.detailLoading.set(false);
  }

  healthScore(): string {
    const score = this.health()?.overall;
    return typeof score === 'number' ? `${Math.round(score)}%` : '—';
  }

  healthLabel(): string {
    return this.health()?.weakest_dimension || 'not reported';
  }

  surfaceHint(): string {
    if (this.error()) return 'backend unavailable';
    if (this.loading() || this.detailLoading()) return 'reading live contracts';
    if (!this.products().length) return 'no service registered';
    return this.health() ? 'live product data' : 'health not verified';
  }

  private resetDetail(): void {
    this.specs.set([]);
    this.health.set(null);
    this.selectedSpecId.set('');
    this.detailError.set(null);
  }
}
