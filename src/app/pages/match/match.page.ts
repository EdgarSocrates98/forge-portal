import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  MATCH_KIND_LABEL,
  MATCH_KIND_ORDER,
  MatchKind,
  MatchService,
} from '../../core/match/match.service';
import { PrefsStore } from '../../core/prefs/prefs.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { UiFilterBar } from '../../shared/filter-bar';

type Filter = MatchKind | 'all';

/**
 * Capability Matching (spec §4.6) — "which agent works with X?", "which
 * skill supports Y?", "which Forja covers Z?" answered by deterministic
 * token overlap over REAL catalog rows (/agents, /skills, /mcp/servers,
 * federation specialists + the serving Forja).
 *
 * Every hit carries its evidence (which real fields matched which query
 * tokens) and a fixed limitations note: only catalog metadata is
 * searched — runtime capability stays unverified. Kinds whose source
 * fails are flagged UNVERIFIED in the chips, never silently dropped;
 * kinds the Forja does not expose (404) are skipped.
 */
@Component({
  selector: 'page-match',
  standalone: true,
  imports: [RouterLink, TPipe, PageHeader, StateBadge, EmptyState, UiIcon, UiSkeleton, UiFilterBar],
  template: `
    <ui-page-header [title]="'match.title' | t" [subtitle]="'match.subtitle' | t" />

    <ui-filter-bar [(query)]="query" placeholder="match.placeholder">
      <button
        class="fg-pill"
        type="button"
        [attr.data-tone]="filter() === 'all' ? 'accent' : null"
        [attr.aria-pressed]="filter() === 'all'"
        (click)="filter.set('all')"
      >
        {{ 'state.all' | t }}
      </button>
      @for (k of kinds; track k) {
        <button
          class="fg-pill"
          type="button"
          [attr.data-tone]="filter() === k ? 'accent' : null"
          [attr.data-unverified]="svc.unverified().includes(k) || null"
          [attr.aria-pressed]="filter() === k"
          [attr.title]="svc.unverified().includes(k) ? ('command.unverified' | t) : null"
          (click)="filter.set(k)"
        >
          {{ labels[k] | t }}
          @if (svc.unverified().includes(k)) {
            <ui-icon name="alert" [size]="11" />
          }
        </button>
      }
    </ui-filter-bar>

    <p class="hint muted">{{ 'match.hint' | t }}</p>

    @if (svc.loading()) {
      <div role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="row" [lines]="3" />
      </div>
    }

    @if (svc.searched() && !svc.loading()) {
      @if (svc.report().total) {
        <p class="src muted">{{ 'match.limitation' | t }}</p>
        @if (!visibleGroups().length) {
          <ui-empty icon="search" [title]="'match.empty' | t" />
        }
        @for (g of visibleGroups(); track g.kind) {
          <section class="group" [attr.data-kind]="g.kind">
            <h2 class="group__title">
              <ui-icon [name]="icons[g.kind]" [size]="15" />{{ labels[g.kind] | t }}
            </h2>
            <div class="hits">
              @for (h of g.hits; track h.kind + ':' + h.id) {
                <article class="card hit" data-lift>
                  <header class="hit__head">
                    <h3>
                      <a
                        class="hit__label"
                        [routerLink]="h.route"
                        [queryParams]="h.queryParams ?? null"
                        >{{ h.label }}</a
                      >
                    </h3>
                    <ui-state-badge state="unverified" [labelOverride]="'match.limitation' | t" />
                  </header>
                  @if (h.sublabel) {
                    <p class="muted">{{ h.sublabel }}</p>
                  }
                  <ul class="ev" [attr.aria-label]="'match.evidence' | t">
                    @for (f of h.hits; track f.field + '|' + f.value) {
                      <li>
                        <code class="ev__field">{{ f.field }}</code>
                        <span class="ev__value">{{ f.value }}</span>
                        <span class="ev__tokens">({{ f.tokens.join(', ') }})</span>
                      </li>
                    }
                  </ul>
                </article>
              }
            </div>
          </section>
        }
      } @else if (query().trim()) {
        <ui-empty icon="search" [title]="'match.empty' | t" [hint]="'match.limitation' | t" />
      } @else {
        <ui-empty icon="compass" [title]="'match.title' | t" [hint]="'match.hint' | t" />
      }
    }
  `,
  styles: `
    .muted {
      color: var(--fg-muted);
    }
    .hint {
      margin: calc(-1 * var(--space-2)) 0 var(--space-4);
      font-size: var(--font-xs);
    }
    .src {
      margin: 0 0 var(--space-3);
      font-size: var(--font-xs);
    }
    .group {
      margin-bottom: var(--space-5);
    }
    .group__title {
      margin: 0 0 var(--space-3);
      font-size: var(--font-sm);
      font-weight: 700;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .group__title ui-icon {
      color: var(--accent-ink);
    }
    .hits {
      display: grid;
      gap: var(--space-3);
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    }
    .hit__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-2);
    }
    .hit__head h3 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .hit__label {
      color: var(--fg);
      text-decoration: none;
    }
    .hit__label:hover {
      color: var(--accent-ink);
      text-decoration: underline;
    }
    .ev {
      list-style: none;
      margin: var(--space-3) 0 0;
      padding: 0;
      display: grid;
      gap: 4px;
      font-size: var(--font-xs);
    }
    .ev li {
      display: flex;
      align-items: baseline;
      gap: 6px;
      min-width: 0;
    }
    .ev__field {
      flex: none;
      color: var(--accent-ink);
      font-weight: 600;
    }
    .ev__value {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 32ch;
    }
    .ev__tokens {
      flex: none;
      color: var(--fg-muted);
    }
    .fg-pill[data-unverified] {
      border-style: dashed;
      color: var(--unverified);
    }
  `,
})
export class MatchPage {
  readonly svc = inject(MatchService);
  private readonly prefs = inject(PrefsStore);

  readonly query = signal('');
  readonly filter = signal<Filter>('all');

  readonly kinds = MATCH_KIND_ORDER;
  readonly labels = MATCH_KIND_LABEL;
  readonly icons: Record<MatchKind, string> = {
    agent: 'agents',
    skill: 'skills',
    forge: 'gem',
    mcp: 'mcp',
  };

  readonly visibleGroups = computed(() => {
    const f = this.filter();
    const groups = this.svc.report().groups;
    return f === 'all' ? groups : groups.filter((g) => g.kind === f);
  });

  constructor() {
    // §8.3 — the last filter text restores on revisit and persists on
    // every change; the box then drives the debounced service query.
    const saved = this.prefs.filterFor('match');
    if (saved) this.query.set(saved);
    effect(() => this.prefs.setFilter('match', this.query()));
    effect(() => this.svc.setQuery(this.query()));
  }
}
