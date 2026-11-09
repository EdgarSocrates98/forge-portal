import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal as sig,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { PageHeader } from '../../shared/page-header';
import { UiIcon } from '../../shared/icon';
import { StateBadge } from '../../shared/state-badge';
import { SentinelApi } from '../../sentinel/sentinel-api.service';
import { SentinelHealth } from '../../sentinel/sentinel.models';
import { sentinelKind } from '../../sentinel/sentinel-states';
import { SentinelConnection } from './sentinel-connection.component';
import { SentinelServices } from './services.view';
import { SentinelIncidents } from './incidents.view';
import { SentinelStatus } from './status.view';

type TabId = 'services' | 'incidents' | 'status';
const TAB_IDS = new Set(['services', 'incidents', 'status']);

/**
 * `/api-operations` — operations surface driven entirely by the real
 * API Sentinel runtime (`api-sentinel/v1` payloads, `problem+json`
 * errors, bearer auth). Product Forge's `forge/PortalApi/1` envelope is
 * not used anywhere on this page; the two provenances stay visibly
 * separate and Sentinel works when Product Forge is absent.
 *
 * Query params (component-input binding): `?tab=services|incidents|status`,
 * `&service=<id>`, `&incident=<id>` — deep links land on real detail.
 */
@Component({
  selector: 'page-api-operations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TPipe,
    PageHeader,
    UiIcon,
    StateBadge,
    RouterLink,
    SentinelConnection,
    SentinelServices,
    SentinelIncidents,
    SentinelStatus,
  ],
  template: `
    <ui-page-header [title]="'apiOperations.title' | t" [subtitle]="'sentinel.page.subtitle' | t">
      <div class="head__meta">
        @if (health(); as h) {
          <ui-state-badge
            [state]="h.state"
            [kindOverride]="kind(h.state)"
            [labelOverride]="stateLabel(h.state)"
          />
          <code class="mono">api-sentinel {{ h.version }} · {{ api.baseUrl() }}</code>
        }
        <button class="btn" type="button" (click)="connOpen.set(!connOpen())">
          <ui-icon name="settings" [size]="14" />
          {{ 'sentinel.conn.open' | t }}
        </button>
        <button class="btn" type="button" (click)="reload()">
          <ui-icon name="refresh" [size]="14" />
          {{ 'state.refresh' | t }}
        </button>
      </div>
    </ui-page-header>

    @if (connOpen()) {
      <sentinel-connection (toggle)="connOpen.set(false)" (saved)="onSaved()" />
    }

    @if (!health() && !healthLoading() && healthError()) {
      <div class="card hint" role="status">
        <p>
          <ui-icon name="alert" [size]="15" />
          {{ 'sentinel.page.unreachable' | t }}
          <button class="link" type="button" (click)="connOpen.set(true)">
            {{ 'sentinel.conn.open' | t }}
          </button>
        </p>
      </div>
    }

    <nav class="tabs" [attr.aria-label]="'apiOperations.title' | t">
      @for (t of tabs; track t.id) {
        <a
          class="tab"
          [routerLink]="['/api-operations']"
          [queryParams]="{ tab: t.id }"
          [attr.data-active]="activeTab() === t.id || null"
          [attr.aria-current]="activeTab() === t.id ? 'page' : null"
        >
          <ui-icon [name]="t.icon" [size]="15" />
          {{ t.label | t }}
        </a>
      }
    </nav>

    @switch (activeTab()) {
      @case ('services') {
        <sentinel-services #svcView [selectedId]="service()" />
      }
      @case ('incidents') {
        <sentinel-incidents #incView [selectedId]="incident()" />
      }
      @case ('status') {
        <sentinel-status #stView />
      }
    }
  `,
  styles: `
    .head__meta {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .mono {
      font-family: var(--font-mono);
      font-size: var(--font-xs);
      color: var(--fg-muted);
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
    .hint {
      padding: var(--space-3) var(--space-4);
      margin-bottom: var(--space-4);
      border-left: 3px solid var(--warn);
    }
    .hint p {
      margin: 0;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--font-sm);
    }
    .link {
      background: none;
      border: 0;
      padding: 0;
      color: var(--accent-ink);
      font: inherit;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class ApiOperationsPage {
  readonly api = inject(SentinelApi);
  private readonly i18n = inject(I18nService);

  readonly tab = input('services');
  readonly service = input<string | null>(null);
  readonly incident = input<string | null>(null);

  readonly svcView = viewChild<SentinelServices>('svcView');
  readonly incView = viewChild<SentinelIncidents>('incView');
  readonly stView = viewChild<SentinelStatus>('stView');

  readonly connOpen = sig(false);
  readonly health = sig<SentinelHealth | null>(null);
  readonly healthLoading = sig(true);
  readonly healthError = sig(false);

  readonly kind = sentinelKind;
  readonly tabs: { id: TabId; icon: string; label: string }[] = [
    { id: 'services', icon: 'network', label: 'sentinel.tabs.services' },
    { id: 'incidents', icon: 'alert', label: 'sentinel.tabs.incidents' },
    { id: 'status', icon: 'pulse', label: 'sentinel.tabs.status' },
  ];

  readonly activeTab = computed<TabId>(() => {
    const t = this.tab();
    return TAB_IDS.has(t) ? (t as TabId) : 'services';
  });

  constructor() {
    void this.loadHealth();
  }

  async loadHealth(): Promise<void> {
    this.healthLoading.set(true);
    this.healthError.set(false);
    try {
      this.health.set(await firstValueFrom(this.api.health()));
    } catch {
      this.health.set(null);
      this.healthError.set(true);
    } finally {
      this.healthLoading.set(false);
    }
  }

  onSaved(): void {
    void this.loadHealth();
    this.reload();
  }

  reload(): void {
    void this.loadHealth();
    this.svcView()?.load();
    this.incView()?.load();
    this.stView()?.load();
  }

  stateLabel(state: string | null | undefined): string {
    const key = `sentinel.state.${state}`;
    const v = this.i18n.t(key);
    return v.startsWith('⟪') ? String(state ?? '—') : v;
  }
}
