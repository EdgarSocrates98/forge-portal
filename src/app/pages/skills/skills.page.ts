import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { SkillDescriptor } from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { DedupFinding, findDuplicateGroups } from '../../core/catalog/dedup';
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
 * Skills Studio (spec §4.5) — the real /skills catalog: free-text
 * search plus a domain filter built from the catalog's own values, a
 * duplicate-collision report (`findDuplicateGroups` — flagged for human
 * review, never merged) and a per-skill detail panel.
 *
 * Honesty contract: the adapter exposes only id/name/domain/
 * description/state/hosts/source. Version, prerequisites, file
 * validation, dependencies and install/repair ops are NOT exposed —
 * those rows render UNVERIFIED, never a fabricated value or a fake
 * action. `?q=` deep-links seed the search box (agents link here).
 */
@Component({
  selector: 'page-skills',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton, UiFilterBar],
  template: `
    <ui-page-header [title]="'skills.title' | t" [subtitle]="'skills.subtitle' | t">
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

    @if (skills().length) {
      <ui-filter-bar [(query)]="query" placeholder="skills.search">
        <button
          class="fg-pill"
          type="button"
          [attr.data-tone]="domain() === null ? 'accent' : null"
          [attr.aria-pressed]="domain() === null"
          (click)="domain.set(null)"
        >
          {{ 'state.all' | t }}
        </button>
        @for (d of domainOptions(); track d) {
          <button
            class="fg-pill"
            type="button"
            [attr.data-tone]="domain() === d ? 'accent' : null"
            [attr.aria-pressed]="domain() === d"
            (click)="toggleDomain(d)"
          >
            {{ d }}
          </button>
        }
      </ui-filter-bar>

      @if (findings().length) {
        <section class="card dedup" data-section="dedup">
          <header class="dedup__head">
            <h2><ui-icon name="diff" [size]="15" />{{ 'skills.dedup.title' | t }}</h2>
            <span class="muted">{{ 'skills.dedup.hint' | t }}</span>
          </header>
          <ul class="dedup__list">
            @for (f of findings(); track f.key) {
              <li>
                <ui-state-badge
                  [state]="f.kind === 'possible-duplicate' ? 'unverified' : 'warn'"
                  [labelOverride]="
                    (f.kind === 'possible-duplicate'
                      ? 'skills.dedup.possible'
                      : 'skills.dedup.different'
                    ) | t
                  "
                />
                <span class="dedup__names">
                  @for (e of f.entries; track e.id) {
                    <button class="chip-link" type="button" (click)="pick(e.id)">
                      {{ e.name || e.id }}
                    </button>
                  }
                </span>
                <ul class="dedup__reasons">
                  @for (p of f.pairs; track p.a + '|' + p.b) {
                    <li>
                      <code>{{ p.a }}</code> ↔ <code>{{ p.b }}</code> —
                      {{ p.reasons.join('; ') }}
                    </li>
                  }
                </ul>
              </li>
            }
          </ul>
        </section>
      }

      @if (selected(); as sel) {
        <section class="card detail" data-section="skill-detail" aria-live="polite">
          <header class="detail__head">
            <h2><ui-icon name="skills" [size]="15" />{{ sel.name || sel.id }}</h2>
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
              <dt>{{ 'table.id' | t }}</dt>
              <dd>
                <code>{{ sel.id }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'skills.domain' | t }}</dt>
              <dd>{{ sel.domain ?? ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'skills.detail.description' | t }}</dt>
              <dd>{{ sel.description || ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'skills.state' | t }}</dt>
              <dd><ui-state-badge [state]="mapState(sel.state)" [labelOverride]="sel.state" /></dd>
            </div>
            <div>
              <dt>{{ 'skills.origin' | t }}</dt>
              <dd>
                @if (store.descriptor(); as d) {
                  {{ d.forge_name }} <code>({{ d.forge_id }})</code>
                  <span class="chip">{{ 'explorer.serving' | t }}</span>
                } @else {
                  <ui-state-badge state="UNVERIFIED" />
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'skills.compatibility' | t }}</dt>
              <dd>
                @if (sel.hosts.length) {
                  {{ sel.hosts.join(', ') }}
                } @else {
                  <ui-state-badge state="UNVERIFIED" />
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'settings.version' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'skills.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'skills.prerequisites' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'skills.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'skills.fileValidation' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'skills.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'skills.deps' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'skills.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'skills.actions' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'skills.actionsUnverified' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'skills.evidence' | t }}</dt>
              <dd>
                <code>GET /api/v1/skills</code>
                @if (sel.source) {
                  <span class="muted"> · {{ sel.source }}</span>
                }
              </dd>
            </div>
          </dl>
        </section>
      }

      <div class="card card--table">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">{{ 'table.id' | t }}</th>
              <th scope="col">{{ 'skills.domain' | t }}</th>
              <th scope="col">{{ 'skills.state' | t }}</th>
              <th scope="col">{{ 'skills.hosts' | t }}</th>
              <th scope="col">
                <span class="sr-only">{{ 'state.viewDetails' | t }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            @for (s of filtered(); track s.id) {
              <tr [attr.data-dup]="dupIds().has(s.id) || null">
                <td>
                  <strong>{{ s.name || s.id }}</strong>
                  <code class="slug">{{ s.id }}</code>
                  <p class="muted">{{ s.description }}</p>
                </td>
                <td>{{ s.domain ?? '—' }}</td>
                <td><ui-state-badge [state]="mapState(s.state)" [labelOverride]="s.state" /></td>
                <td>
                  @if (s.hosts.length) {
                    {{ s.hosts.join(', ') }}
                  } @else {
                    <ui-state-badge state="UNVERIFIED" />
                  }
                </td>
                <td>
                  <button
                    class="icon-btn"
                    (click)="selected.set(s)"
                    [attr.aria-label]="'state.viewDetails' | t"
                  >
                    <ui-icon name="chevron-right" [size]="15" />
                  </button>
                </td>
              </tr>
            } @empty {
              @if (!loading()) {
                <tr>
                  <td colspan="5"><ui-empty icon="skills" [title]="'skills.empty' | t" /></td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    } @else if (!error() && !loading()) {
      <ui-empty icon="skills" [title]="'skills.none' | t" />
    }
  `,
  styles: `
    .muted {
      color: var(--fg-muted);
      margin: 4px 0 0;
      font-size: var(--font-sm);
    }
    .slug {
      display: block;
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .card--table {
      padding: var(--space-3);
      overflow-x: auto;
    }
    .card--table .table {
      min-width: 560px;
    }
    tr[data-dup] td:first-child {
      border-left: 3px solid var(--warn);
    }
    .dedup {
      margin-bottom: var(--space-4);
      border-left: 3px solid var(--warn);
    }
    .dedup__head {
      display: flex;
      align-items: baseline;
      gap: var(--space-3);
      flex-wrap: wrap;
      margin-bottom: var(--space-2);
    }
    .dedup__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    .dedup__head h2 ui-icon {
      color: var(--warn);
    }
    .dedup__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-3);
    }
    .dedup__list > li {
      display: grid;
      gap: 4px;
    }
    .dedup__names {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .dedup__reasons {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: var(--font-xs);
      color: var(--fg-muted);
      display: grid;
      gap: 2px;
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
    .detail__head h2 ui-icon {
      color: var(--accent-ink);
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
      min-width: 9rem;
      color: var(--fg-muted);
      font-size: var(--font-sm);
      flex: none;
    }
    .kv dd {
      margin: 0;
      min-width: 0;
    }
    .unv-cell {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .chip-link {
      font-size: var(--font-xs);
      font-weight: 600;
      color: var(--accent-ink);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
      border: 0;
      cursor: pointer;
    }
    .chip {
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent-ink);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
      margin-left: 4px;
    }
  `,
})
export class SkillsPage implements OnInit {
  private readonly api = inject(PortalApi);
  readonly store = inject(PortalStore);

  /** Route `?q=` deep-link (withComponentInputBinding) — e.g. from the
   *  agent detail's associated-skills links. */
  readonly q = input('');

  readonly skills = signal<SkillDescriptor[]>([]);
  readonly error = signal<ApiError | null>(null);
  readonly query = signal('');
  readonly domain = signal<string | null>(null);
  readonly selected = signal<SkillDescriptor | null>(null);
  readonly loading = signal(true);

  readonly domainOptions = computed(() => {
    const set = new Set<string>();
    for (const s of this.skills()) if (s.domain) set.add(s.domain);
    return [...set].sort();
  });

  readonly filtered = computed(() => {
    const q = norm(this.query());
    const domain = this.domain();
    return this.skills().filter((s) => {
      if (domain !== null && s.domain !== domain) return false;
      if (!q) return true;
      const hay = [s.id, s.name, s.domain ?? '', s.description, ...s.hosts].map(norm).join(' ');
      return hay.includes(q);
    });
  });

  /**
   * Same-name collisions across the real catalog — `origin` is the
   * serving Forja (uniform for this catalog), version is unexposed
   * (null). Findings are review flags only; rows are never merged.
   */
  readonly findings = computed<DedupFinding[]>(() =>
    findDuplicateGroups(
      this.skills().map((s) => ({
        id: s.id,
        name: s.name || s.id,
        origin: this.store.descriptor()?.forge_id ?? null,
        version: null,
        description: s.description,
      })),
    ),
  );

  /** Ids involved in any collision — rows get a warning edge. */
  readonly dupIds = computed(() => {
    const ids = new Set<string>();
    for (const f of this.findings()) for (const e of f.entries) ids.add(e.id);
    return ids;
  });

  constructor() {
    void this.load();
  }

  ngOnInit(): void {
    const seed = this.q();
    if (seed) this.query.set(seed);
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.skills.set(await firstValueFrom(this.api.skills()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  toggleDomain(d: string): void {
    this.domain.set(this.domain() === d ? null : d);
  }

  /** Focus a colliding row in the detail panel (from a dedup flag). */
  pick(id: string): void {
    const s = this.skills().find((x) => x.id === id);
    if (s) this.selected.set(s);
  }

  mapState(state: string): string {
    return ['invoked', 'available', 'installed', 'registered'].includes(state)
      ? 'supported'
      : state === 'unverified'
        ? 'unverified'
        : 'not_applicable';
  }
}
