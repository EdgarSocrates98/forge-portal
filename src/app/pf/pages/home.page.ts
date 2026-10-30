import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { PfApi } from '../pf-api.service';
import { ApiError } from '../../core/api/api.error';
import { PfHealth, PfProduct, PfWorkspace } from '../pf.models';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { ToastService } from '../../shared/toast';

/**
 * Product Forge Studio home — engine health, workspaces and the product
 * portfolio. Every action performs a real engine call; an unreachable or
 * unauthorized engine renders the honest error panel with a route to
 * `/pf/settings`, never a fabricated catalog.
 */
@Component({
  selector: 'page-pf-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [RouterLink, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header title="Product Forge Studio" [subtitle]="subtitle()">
      <a class="btn" routerLink="/pf/onboarding">
        <ui-icon name="guide" [size]="15" />
        Onboarding
      </a>
      <a class="btn" routerLink="/pf/settings">
        <ui-icon name="settings" [size]="15" />
        Engine settings
      </a>
    </ui-page-header>

    <section class="card engine">
      <div class="fg-row fg-spread" data-wrap>
        <div class="fg-row">
          <span class="engine__label">Engine</span>
          <code class="engine__url">{{ api.baseUrl() }}</code>
        </div>
        <div class="fg-row">
          @if (health(); as h) {
            <ui-state-badge
              [state]="h.status === 'healthy' ? 'ok' : 'warn'"
              [labelOverride]="h.status"
            />
            <span class="muted small">{{ h.forge_id }} · v{{ h.version }}</span>
          } @else if (healthError()) {
            <ui-state-badge state="error" labelOverride="unreachable" />
          } @else {
            <ui-state-badge state="UNVERIFIED" />
          }
          @if (!api.token()) {
            <span class="fg-pill" data-tone="warning">no token</span>
          }
          <button class="btn btn--mini" (click)="loadAll()">
            <ui-icon name="refresh" [size]="13" />
            Retry
          </button>
        </div>
      </div>
      @if (healthError(); as he) {
        <p class="engine__warn">
          {{ he.body.message }}
          @if (he.body.code === 'PF-UNAUTHORIZED') {
            — set the engine token in <a routerLink="/pf/settings">settings</a>.
          } @else {
            — check the base URL in <a routerLink="/pf/settings">settings</a>.
          }
        </p>
      }
    </section>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="loadAll()">
        <a class="btn" routerLink="/pf/settings">Open engine settings</a>
      </ui-error>
    }

    <div class="grid2">
      <section class="card">
        <header class="card__head">
          <h2>Workspaces</h2>
        </header>
        @if (loading()) {
          <div role="status" aria-label="loading"><ui-skeleton kind="row" [lines]="2" /></div>
        } @else if (workspaces().length) {
          <ul class="wlist">
            @for (w of workspaces(); track w.id) {
              <li>
                <span class="wlist__name">{{ w.name }}</span>
                <code class="muted small">{{ w.id }}</code>
              </li>
            }
          </ul>
        } @else {
          <ui-empty icon="folder" title="No workspaces yet" />
        }
        <form class="inline-form" (submit)="createWorkspace($event)">
          <label class="sr-only" for="pf-ws-name">Workspace name</label>
          <input
            id="pf-ws-name"
            class="input"
            [value]="wsName()"
            (input)="wsName.set($any($event.target).value)"
            placeholder="New workspace name"
            required
          />
          <button class="btn" type="submit" [disabled]="busy() || !wsName().trim()">Create</button>
        </form>
      </section>

      <section class="card">
        <header class="card__head">
          <h2>New product</h2>
        </header>
        <form class="stack" (submit)="createProduct($event)">
          <label class="field">
            <span>Workspace</span>
            <select
              class="select"
              [value]="productWs()"
              (change)="productWs.set($any($event.target).value)"
              required
            >
              <option value="" disabled>Select a workspace</option>
              @for (w of workspaces(); track w.id) {
                <option [value]="w.id">{{ w.name }}</option>
              }
            </select>
          </label>
          <label class="field">
            <span>Product name</span>
            <input
              class="input"
              [value]="productName()"
              (input)="productName.set($any($event.target).value)"
              placeholder="e.g. Billing Analytics"
              required
            />
          </label>
          <label class="field">
            <span>Domain <small class="muted">(optional)</small></span>
            <input
              class="input"
              [value]="productDomain()"
              (input)="productDomain.set($any($event.target).value)"
              placeholder="e.g. fintech"
            />
          </label>
          <div>
            <button
              class="btn btn--primary"
              type="submit"
              [disabled]="busy() || !productWs() || !productName().trim()"
            >
              Create product
            </button>
          </div>
        </form>
      </section>
    </div>

    <section>
      <header class="card__head section-head">
        <h2>Agentic workspace</h2>
      </header>
      <nav class="navgrid" aria-label="Agentic workspace surfaces">
        <a class="card navcard" data-lift routerLink="/pf/chat">
          <strong>Chat</strong>
          <span class="muted small">Provider sessions with streaming, tools and approvals</span>
        </a>
        <a class="card navcard" data-lift routerLink="/pf/control-center">
          <strong>Agent Control Center</strong>
          <span class="muted small">Live sessions, approval queue, degraded-mode banner</span>
        </a>
        <a class="card navcard" data-lift routerLink="/pf/intelligence">
          <strong>Product Intelligence</strong>
          <span class="muted small">Session quality, decisions, FinOps</span>
        </a>
        <a class="card navcard" data-lift routerLink="/pf/lens">
          <strong>Forge Lens</strong>
          <span class="muted small">Context health, workspace intel, provider routing</span>
        </a>
        <a class="card navcard" data-lift routerLink="/pf/compare">
          <strong>Session Compare</strong>
          <span class="muted small">Diff two sessions' event timelines</span>
        </a>
        <a class="card navcard" data-lift routerLink="/pf/artifacts">
          <strong>Artifact Studio</strong>
          <span class="muted small">Session artifacts and workspace files</span>
        </a>
        <a class="card navcard" data-lift routerLink="/pf/workflows">
          <strong>Workflow Builder</strong>
          <span class="muted small">Design-time agent pipelines</span>
        </a>
        <a class="card navcard" data-lift routerLink="/pf/templates">
          <strong>Agent Templates</strong>
          <span class="muted small">Curated starting points with risk gates</span>
        </a>
      </nav>
    </section>

    <section>
      <header class="card__head section-head">
        <h2>Products</h2>
        <a class="btn btn--mini" routerLink="/pf/products">Manage</a>
      </header>
      @if (loading()) {
        <div role="status" aria-label="loading"><ui-skeleton kind="card" [lines]="3" /></div>
      } @else if (products().length) {
        <div class="pgrid stagger">
          @for (p of products(); track p.id) {
            <a class="card pcard" data-lift [routerLink]="['/pf/products', p.id]">
              <div class="pcard__top">
                <strong>{{ p.name }}</strong>
                <ui-state-badge
                  [state]="p.status === 'active' ? 'ACTIVE' : 'muted'"
                  [labelOverride]="p.status ?? 'unknown'"
                />
              </div>
              @if (p.description) {
                <p class="muted small clamp">{{ p.description }}</p>
              }
              <div class="pcard__meta muted small">
                @if (p.domain) {
                  <span class="chip">{{ p.domain }}</span>
                }
                <code>{{ p.id }}</code>
              </div>
            </a>
          }
        </div>
      } @else if (!error()) {
        <ui-empty
          icon="gem"
          title="No products yet"
          hint="Create a workspace and a product above, or run the onboarding wizard."
        >
          <a class="btn" routerLink="/pf/onboarding">Start onboarding</a>
        </ui-empty>
      }
    </section>
  `,
  styles: `
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
    .engine {
      margin-bottom: var(--space-5);
    }
    .engine__label {
      font-size: var(--font-xs);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--fg-muted);
    }
    .engine__url {
      font-size: var(--font-sm);
      color: var(--fg);
    }
    .engine__warn {
      margin: var(--space-3) 0 0;
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
      font-size: var(--font-sm);
      color: var(--warn);
    }
    .grid2 {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
      margin-bottom: var(--space-5);
    }
    .navgrid {
      display: grid;
      gap: var(--space-3);
      grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
      margin-bottom: var(--space-5);
    }
    .navcard {
      display: grid;
      gap: 4px;
      padding: var(--space-3) var(--space-4);
      text-decoration: none;
      color: inherit;
    }
    .navcard:hover {
      border-color: var(--accent);
    }
    .card__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .card__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .section-head {
      margin: var(--space-2) 0 var(--space-3);
    }
    .wlist {
      list-style: none;
      margin: 0 0 var(--space-3);
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .wlist li {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-hover);
    }
    .wlist__name {
      font-weight: 550;
    }
    .inline-form {
      display: flex;
      gap: var(--space-2);
    }
    .inline-form .input {
      flex: 1;
    }
    .stack {
      display: grid;
      gap: var(--space-3);
    }
    .field {
      display: grid;
      gap: 4px;
      font-size: var(--font-sm);
      font-weight: 550;
    }
    .pgrid {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    }
    .pcard {
      display: grid;
      gap: var(--space-2);
      text-decoration: none;
      color: var(--fg);
    }
    .pcard__top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .pcard__top strong {
      font-size: var(--font-md);
    }
    .pcard__meta {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .clamp {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `,
})
export class PfHomePage implements OnInit {
  readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);

  readonly health = signal<PfHealth | null>(null);
  readonly healthError = signal<ApiError | null>(null);
  readonly workspaces = signal<PfWorkspace[]>([]);
  readonly products = signal<PfProduct[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);

  readonly wsName = signal('');
  readonly productWs = signal('');
  readonly productName = signal('');
  readonly productDomain = signal('');

  readonly subtitle = computed(
    () => `Product intelligence workspace — engine at ${this.api.baseUrl()}`,
  );

  ngOnInit(): void {
    void this.loadAll();
  }

  async loadAll(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    // Health is the only public route — report it independently so an
    // unauthorized catalog still shows a live engine.
    try {
      this.health.set(await firstValueFrom(this.api.health()));
      this.healthError.set(null);
    } catch (e) {
      this.health.set(null);
      this.healthError.set(e instanceof ApiError ? e : new ApiError(0));
    }
    try {
      const [ws, ps] = await Promise.all([
        firstValueFrom(this.api.workspaces()),
        firstValueFrom(this.api.products()),
      ]);
      this.workspaces.set(ws.items ?? []);
      this.products.set(ps.items ?? []);
      if (!this.productWs() && ws.items?.length) this.productWs.set(ws.items[0].id);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  async createWorkspace(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.wsName().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.createWorkspace({ name }));
      this.wsName.set('');
      this.toast.show(`Workspace "${name}" created`, 'success');
      await this.loadAll();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async createProduct(ev: Event): Promise<void> {
    ev.preventDefault();
    const workspace_id = this.productWs();
    const name = this.productName().trim();
    if (!workspace_id || !name || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.createProduct({
          workspace_id,
          name,
          description: '',
          domain: this.productDomain().trim(),
        }),
      );
      this.productName.set('');
      this.productDomain.set('');
      this.toast.show(`Product "${name}" created`, 'success');
      await this.loadAll();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }
}
