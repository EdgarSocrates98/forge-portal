import { Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { ResourceEntry } from '../../core/api/api.models';
import { PrefsStore } from '../../core/prefs/prefs.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { UiFilterBar } from '../../shared/filter-bar';

const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Resource Explorer (spec §17.3) — the federated Resource Catalog served
 * by GET /api/v1/resources: typed entries (skills, agents, knowledge,
 * rules, contracts, evals, examples, fixtures, protocols) across every
 * forge in the workspace.
 *
 * Honesty contract: this page lists metadata + declared locations only.
 * Resource bodies are never fetched here (access policy) and unavailable
 * entries render their explicit unavailable_reason — never a silent hole.
 */
@Component({
  selector: 'page-resources',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton, UiFilterBar],
  template: `
    <ui-page-header
      [title]="'resources.title' | t"
      [subtitle]="'resources.subtitle' | t"
      hintId="resources"
    >
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="card" [lines]="2" />
      </div>
    }

    @if (data(); as d) {
      @if (d.errors.length) {
        <section class="card warn-note" data-section="catalog-errors">
          <ui-icon name="warn" [size]="15" />
          <span>{{ 'resources.manifestErrors' | t }}: {{ d.errors.join('; ') }}</span>
        </section>
      }

      <ui-filter-bar [(query)]="query" placeholder="resources.search">
        <button
          class="fg-pill"
          type="button"
          [attr.data-tone]="forge() === null ? 'accent' : null"
          [attr.aria-pressed]="forge() === null"
          (click)="forge.set(null)"
        >
          {{ 'state.all' | t }}
        </button>
        @for (f of d.forges; track f) {
          <button
            class="fg-pill"
            type="button"
            [attr.data-tone]="forge() === f ? 'accent' : null"
            [attr.aria-pressed]="forge() === f"
            (click)="toggleForge(f)"
          >
            {{ f }}
          </button>
        }
      </ui-filter-bar>

      <div class="chip-row" role="group" [attr.aria-label]="'resources.kind' | t">
        <button
          class="fg-pill"
          type="button"
          [attr.data-tone]="kind() === null ? 'accent' : null"
          [attr.aria-pressed]="kind() === null"
          (click)="kind.set(null)"
        >
          {{ 'resources.allKinds' | t }}
        </button>
        @for (k of kindOptions(); track k) {
          <button
            class="fg-pill"
            type="button"
            [attr.data-tone]="kind() === k ? 'accent' : null"
            [attr.aria-pressed]="kind() === k"
            (click)="toggleKind(k)"
          >
            {{ k }}
          </button>
        }
      </div>

      <p class="muted count">
        {{ filtered().length }} / {{ d.resources.length }} {{ 'resources.count' | t }} ·
        {{ unavailableCount() }} {{ 'resources.unavailable' | t }}
      </p>

      @if (selected(); as sel) {
        <section class="card detail fg-enter" data-section="resource-detail" aria-live="polite">
          <header class="detail__head">
            <h2><ui-icon name="gem" [size]="15" />{{ sel.id }}</h2>
            <button
              class="icon-btn"
              (click)="selected.set(null)"
              [attr.aria-label]="'state.close' | t"
            >
              <ui-icon name="chevron-right" [size]="14" />
            </button>
          </header>
          <dl class="kv">
            <div>
              <dt>{{ 'resources.forge' | t }}</dt>
              <dd>
                <code>{{ sel.forge_id }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'resources.kind' | t }}</dt>
              <dd>{{ sel.kind ?? ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'resources.class' | t }}</dt>
              <dd>{{ sel.resource_class ?? ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'resources.state' | t }}</dt>
              <dd>
                <ui-state-badge
                  [state]="mapState(sel.availability)"
                  [labelOverride]="sel.availability"
                />
                @if (sel.unavailable_reason) {
                  <small class="muted">{{ sel.unavailable_reason }}</small>
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'resources.location' | t }}</dt>
              <dd>
                <code>{{ sel.location ?? ('state.absent' | t) }}</code>
              </dd>
            </div>
            @if (sel.packaged_location) {
              <div>
                <dt>{{ 'resources.packaged' | t }}</dt>
                <dd>
                  <code>{{ sel.packaged_location }}</code>
                </dd>
              </div>
            }
            <div>
              <dt>{{ 'resources.tags' | t }}</dt>
              <dd>{{ sel.tags.length ? sel.tags.join(', ') : ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'resources.description' | t }}</dt>
              <dd>{{ sel.description || ('state.absent' | t) }}</dd>
            </div>
          </dl>
        </section>
      }

      <div class="card card--table">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">{{ 'resources.forge' | t }}</th>
              <th scope="col">{{ 'table.id' | t }}</th>
              <th scope="col">{{ 'resources.kind' | t }}</th>
              <th scope="col">{{ 'resources.class' | t }}</th>
              <th scope="col">{{ 'resources.state' | t }}</th>
              <th scope="col">
                <span class="sr-only">{{ 'state.viewDetails' | t }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            @for (r of paged(); track r.forge_id + ':' + r.id) {
              <tr>
                <td>
                  <code>{{ r.forge_id }}</code>
                </td>
                <td>
                  <strong>{{ r.id }}</strong>
                  <p class="muted">{{ r.description }}</p>
                </td>
                <td>{{ r.kind ?? '—' }}</td>
                <td>{{ r.resource_class ?? '—' }}</td>
                <td>
                  <ui-state-badge
                    [state]="mapState(r.availability)"
                    [labelOverride]="r.availability"
                  />
                </td>
                <td>
                  <button
                    class="icon-btn"
                    (click)="selected.set(r)"
                    [attr.aria-label]="'state.viewDetails' | t"
                  >
                    <ui-icon name="chevron-right" [size]="15" />
                  </button>
                </td>
              </tr>
            } @empty {
              @if (!loading()) {
                <tr>
                  <td colspan="6"><ui-empty icon="gem" [title]="'resources.empty' | t" /></td>
                </tr>
              }
            }
          </tbody>
        </table>
        @if (filtered().length > pageSize) {
          <div class="pager">
            <button class="btn btn--mini" [disabled]="page() === 0" (click)="page.set(page() - 1)">
              ‹
            </button>
            <span class="muted">{{ page() + 1 }} / {{ pageCount() }}</span>
            <button
              class="btn btn--mini"
              [disabled]="page() + 1 >= pageCount()"
              (click)="page.set(page() + 1)"
            >
              ›
            </button>
          </div>
        }
      </div>
    } @else if (!error() && !loading()) {
      <ui-empty icon="gem" [title]="'resources.none' | t" />
    }
  `,
  styles: `
    .muted {
      color: var(--fg-muted);
      margin: 4px 0 0;
      font-size: var(--font-sm);
    }
    .count {
      margin: var(--space-2) 0 var(--space-3);
    }
    .warn-note {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      border-left: 3px solid var(--warn);
      margin-bottom: var(--space-3);
      font-size: var(--font-sm);
    }
    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .card--table {
      padding: var(--space-3);
      overflow-x: auto;
    }
    .card--table .table {
      min-width: 720px;
    }
    .detail {
      margin-bottom: var(--space-4);
      border-left: 3px solid var(--accent);
    }
    .detail__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .detail__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .kv {
      display: grid;
      gap: var(--space-2);
      margin: 0;
    }
    .kv div {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
    }
    .kv dt {
      min-width: 8rem;
      color: var(--fg-muted);
      font-size: var(--font-sm);
      flex: none;
    }
    .kv dd {
      margin: 0;
      min-width: 0;
      word-break: break-all;
    }
    .pager {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      justify-content: flex-end;
      padding-top: var(--space-3);
    }
  `,
})
export class ResourcesPage implements OnInit {
  private readonly api = inject(PortalApi);
  private readonly prefs = inject(PrefsStore);

  readonly q = input('');

  readonly data = signal<{ forges: string[]; resources: ResourceEntry[]; errors: string[] } | null>(
    null,
  );
  readonly error = signal<ApiError | null>(null);
  readonly query = signal('');
  readonly forge = signal<string | null>(null);
  readonly kind = signal<string | null>(null);
  readonly selected = signal<ResourceEntry | null>(null);
  readonly loading = signal(true);
  readonly page = signal(0);
  readonly pageSize = 50;

  readonly kindOptions = computed(() => {
    const set = new Set<string>();
    for (const r of this.data()?.resources ?? []) if (r.kind) set.add(r.kind);
    return [...set].sort();
  });

  readonly filtered = computed(() => {
    const q = norm(this.query());
    const forge = this.forge();
    const kind = this.kind();
    return (this.data()?.resources ?? []).filter((r) => {
      if (forge !== null && r.forge_id !== forge) return false;
      if (kind !== null && r.kind !== kind) return false;
      if (!q) return true;
      const hay = [r.id, r.kind ?? '', r.description ?? '', r.location ?? '', ...r.tags]
        .map(norm)
        .join(' ');
      return hay.includes(q);
    });
  });

  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.filtered().length / this.pageSize)),
  );

  readonly paged = computed(() =>
    this.filtered().slice(this.page() * this.pageSize, (this.page() + 1) * this.pageSize),
  );

  readonly unavailableCount = computed(
    () => this.filtered().filter((r) => r.availability !== 'available').length,
  );

  constructor() {
    effect(() => {
      this.prefs.setFilter('resources', this.query());
      this.page.set(0);
    });
    void this.load();
  }

  ngOnInit(): void {
    const seed = this.q();
    if (seed) this.query.set(seed);
    else {
      const saved = this.prefs.filterFor('resources');
      if (saved) this.query.set(saved);
    }
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.data.set(await firstValueFrom(this.api.workspaceResources()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  toggleForge(f: string): void {
    this.forge.set(this.forge() === f ? null : f);
  }

  toggleKind(k: string): void {
    this.kind.set(this.kind() === k ? null : k);
  }

  mapState(state: string): string {
    return state === 'available' ? 'supported' : state === 'conditional' ? 'warn' : 'unverified';
  }
}
