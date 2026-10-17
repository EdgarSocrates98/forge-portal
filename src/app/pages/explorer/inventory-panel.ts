import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { StateBadge } from '../../shared/state-badge';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { CountTile, countLoader, countTiles } from './forges.data';

/**
 * Inventory counts — skills / agents / MCP / hosts, one live count per
 * catalog endpoint. Each tile owns a Source so a single failed endpoint
 * shows UNVERIFIED on that tile while the others still render numbers.
 */
@Component({
  selector: 'inventory-panel',
  standalone: true,
  imports: [RouterLink, TPipe, StateBadge, UiIcon, UiSkeleton],
  template: `
    <section class="inv" data-section="inventory">
      <div class="inv__head">
        <div>
          <h2>{{ 'dashboard.inventory' | t }}</h2>
          <p class="inv__hint">{{ 'dashboard.inventory.hint' | t }}</p>
        </div>
        <button class="icon-btn" (click)="loadCounts()" [attr.aria-label]="'state.refresh' | t">
          <ui-icon name="refresh" [size]="14" />
        </button>
      </div>
      <div class="inv__tiles">
        @for (t of tiles; track t.id) {
          <article class="tile" [attr.data-count-id]="t.id">
            <header>
              <ui-icon [name]="t.icon" [size]="15" />
              <a class="tile__label tile__link" [routerLink]="t.route">{{ t.labelKey | t }}</a>
              <button
                class="tile__reload"
                (click)="reload(t)"
                [attr.aria-label]="'state.refresh' | t"
              >
                <ui-icon name="refresh" [size]="12" />
              </button>
            </header>
            @if (t.src.loading() && t.src.data() === null) {
              <ui-skeleton kind="text" />
            } @else if (t.src.data() !== null) {
              <strong class="tile__n" data-count>{{ t.src.data() }}</strong>
            } @else {
              <ui-state-badge state="UNVERIFIED" />
            }
            <p class="tile__src">
              <code>{{ t.endpoint }}</code>
            </p>
          </article>
        }
      </div>
    </section>
  `,
  styles: `
    .inv__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .inv__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .inv__hint {
      margin: 2px 0 0;
      color: var(--fg-muted);
      font-size: var(--font-sm);
    }
    .inv__tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: var(--space-3);
    }
    .tile {
      display: grid;
      gap: 6px;
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--bg-elevated);
      box-shadow: var(--elev-card);
    }
    .tile header {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--fg-muted);
    }
    .tile__label {
      flex: 1;
      font-size: var(--font-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .tile__link {
      color: inherit;
      text-decoration: none;
    }
    .tile__link:hover {
      color: var(--accent-strong);
      text-decoration: underline;
    }
    .tile__reload {
      display: inline-flex;
      padding: 2px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--fg-muted);
      cursor: pointer;
    }
    .tile__reload:hover {
      color: var(--fg);
      background: var(--bg-hover);
    }
    .tile__n {
      font-size: 1.375rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }
    .tile__src {
      margin: 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
  `,
})
export class InventoryPanel {
  private readonly api = inject(PortalApi);
  readonly tiles = countTiles();

  constructor() {
    void this.loadCounts();
  }

  async loadCounts(): Promise<void> {
    await Promise.allSettled(this.tiles.map((t) => this.reload(t)));
  }

  async reload(t: CountTile): Promise<void> {
    await t.src.load(() => countLoader(this.api, t.id));
  }
}
