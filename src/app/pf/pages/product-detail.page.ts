import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { PfApi } from '../pf-api.service';
import { ApiError } from '../../core/api/api.error';
import { PfProduct } from '../pf.models';
import { StateBadge } from '../../shared/state-badge';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { PfContextTab } from './tabs/context.tab';
import { PfKnowledgeTab } from './tabs/knowledge.tab';
import { PfAgentsTab } from './tabs/agents.tab';
import { PfAnalyticsTab } from './tabs/analytics.tab';
import { PfDashboardsTab } from './tabs/dashboards.tab';
import { PfPlanningTab } from './tabs/planning.tab';
import { PfApisTab } from './tabs/apis.tab';
import { PfReportsTab } from './tabs/reports.tab';
import { PfHealthTab } from './tabs/health.tab';

type PfTabId =
  | 'context'
  | 'knowledge'
  | 'agents'
  | 'analytics'
  | 'dashboards'
  | 'planning'
  | 'apis'
  | 'reports'
  | 'health';

const TABS: { id: PfTabId; label: string; icon: string }[] = [
  { id: 'context', label: 'Context', icon: 'gem' },
  { id: 'knowledge', label: 'Knowledge', icon: 'knowledge' },
  { id: 'agents', label: 'Agents', icon: 'agents' },
  { id: 'analytics', label: 'Analytics', icon: 'pulse' },
  { id: 'dashboards', label: 'Dashboards', icon: 'dashboard' },
  { id: 'planning', label: 'Planning', icon: 'tasks' },
  { id: 'apis', label: 'APIs', icon: 'mcp' },
  { id: 'reports', label: 'Reports', icon: 'diff' },
  { id: 'health', label: 'Health', icon: 'shield-check' },
];

const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

/**
 * Product detail — tab shell over the engine's product-scoped routes.
 * The active tab is the `?tab=` query param (deep-linkable, default
 * `context`); unknown values fall back, never throw.
 */
@Component({
  selector: 'page-pf-product-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    RouterLink,
    StateBadge,
    ErrorState,
    UiIcon,
    UiSkeleton,
    PfContextTab,
    PfKnowledgeTab,
    PfAgentsTab,
    PfAnalyticsTab,
    PfDashboardsTab,
    PfPlanningTab,
    PfApisTab,
    PfHealthTab,
    PfReportsTab,
  ],
  template: `
    <header class="head">
      <div class="head__text">
        <a class="back" routerLink="/pf/products">
          <ui-icon name="chevron-left" [size]="14" />
          Products
        </a>
        @if (product(); as p) {
          <h2>{{ p.name }}</h2>
          <div class="head__meta">
            <ui-state-badge
              [state]="p.status === 'active' ? 'ACTIVE' : 'muted'"
              [labelOverride]="p.status ?? 'unknown'"
            />
            @if (p.domain) {
              <span class="chip">{{ p.domain }}</span>
            }
            <code class="muted">{{ p.id }}</code>
          </div>
        } @else if (loading()) {
          <ui-skeleton kind="text" [lines]="1" />
        } @else {
          <h2>Product</h2>
        }
      </div>
    </header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    } @else {
      <nav class="tabs" aria-label="Product surfaces">
        @for (t of tabs; track t.id) {
          <a
            class="tab"
            [routerLink]="['/pf/products', pid()]"
            [queryParams]="{ tab: t.id }"
            [attr.data-active]="activeTab() === t.id || null"
            [attr.aria-current]="activeTab() === t.id ? 'page' : null"
          >
            <ui-icon [name]="t.icon" [size]="15" />
            {{ t.label }}
          </a>
        }
      </nav>

      @switch (activeTab()) {
        @case ('context') {
          <pf-context-tab [pid]="pid()" />
        }
        @case ('knowledge') {
          <pf-knowledge-tab [pid]="pid()" />
        }
        @case ('agents') {
          <pf-agents-tab [pid]="pid()" />
        }
        @case ('analytics') {
          <pf-analytics-tab [pid]="pid()" />
        }
        @case ('dashboards') {
          <pf-dashboards-tab [pid]="pid()" />
        }
        @case ('planning') {
          <pf-planning-tab [pid]="pid()" />
        }
        @case ('apis') {
          <pf-apis-tab [pid]="pid()" />
        }
        @case ('reports') {
          <pf-reports-tab [pid]="pid()" />
        }
        @case ('health') {
          <pf-health-tab [pid]="pid()" />
        }
      }
    }
  `,
  styles: `
    .head {
      margin-bottom: var(--space-4);
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: var(--font-sm);
      color: var(--fg-muted);
      text-decoration: none;
      margin-bottom: var(--space-2);
    }
    .back:hover {
      color: var(--accent-ink);
    }
    .head h2 {
      margin: 0 0 var(--space-2);
      font-size: var(--font-2xl);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .head__meta {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .muted {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .tabs {
      display: flex;
      gap: 2px;
      overflow-x: auto;
      border-bottom: 1px solid var(--border);
      margin-bottom: var(--space-5);
    }
    .tab {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: 8px var(--space-3);
      border-bottom: 2px solid transparent;
      color: var(--fg-muted);
      text-decoration: none;
      font-size: var(--font-sm);
      font-weight: 550;
      white-space: nowrap;
      transition:
        color var(--motion-fast),
        border-color var(--motion-fast);
    }
    .tab:hover {
      color: var(--fg);
    }
    .tab[data-active] {
      color: var(--accent-ink);
      border-bottom-color: var(--accent);
      font-weight: 650;
    }
  `,
})
export class PfProductDetailPage implements OnInit {
  private readonly api = inject(PfApi);

  /** Route param + query param via withComponentInputBinding. */
  readonly pid = input.required<string>();
  readonly tab = input('context');

  readonly tabs = TABS;
  readonly product = signal<PfProduct | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);

  readonly activeTab = computed<PfTabId>(() => {
    const t = this.tab();
    return TAB_IDS.has(t) ? (t as PfTabId) : 'context';
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.product.set(await firstValueFrom(this.api.product(this.pid())));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }
}
