import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { AgentDescriptor } from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
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
 * Agent Studio (spec §4.4) — the real /agents roster: free-text search
 * plus domain and skill filters built from the catalog's own values.
 *
 * Honesty contract: the adapter exposes only id/name/role/description/
 * authority/domains/skills/hosts/state. Tools/MCP, permissions,
 * dependencies, compatible hosts (when the list is empty) and version
 * are NOT exposed — the detail panel renders them UNVERIFIED instead of
 * inventing values. Origin Forja = the Forja serving this catalog
 * (bootstrap descriptor); when even that is unknown the field degrades
 * to UNVERIFIED too. `?q=` deep-links seed the search box.
 */
@Component({
  selector: 'page-agents',
  standalone: true,
  imports: [
    RouterLink,
    TPipe,
    PageHeader,
    StateBadge,
    EmptyState,
    ErrorState,
    UiIcon,
    UiSkeleton,
    UiFilterBar,
  ],
  template: `
    <ui-page-header [title]="'agents.title' | t" [subtitle]="'agents.subtitle' | t">
      <button class="btn" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <section class="grid" role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="card" [lines]="3" />
      </section>
    }

    @if (agents().length) {
      <ui-filter-bar [(query)]="query" placeholder="agents.search">
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
        @if (skillOptions().length) {
          <select
            class="input sel"
            [value]="skill() ?? ''"
            (change)="onSkill($event)"
            [attr.aria-label]="'agents.skills' | t"
          >
            <option value="">{{ 'agents.skills' | t }}: {{ 'state.all' | t }}</option>
            @for (s of skillOptions(); track s) {
              <option [value]="s" [selected]="skill() === s">{{ s }}</option>
            }
          </select>
        }
      </ui-filter-bar>

      @if (selected(); as sel) {
        <section class="card detail" data-section="agent-detail" aria-live="polite">
          <header class="detail__head">
            <h2><ui-icon name="agents" [size]="15" />{{ sel.name || sel.id }}</h2>
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
              <dt>{{ 'agents.role' | t }}</dt>
              <dd>{{ sel.role || ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'agents.responsibility' | t }}</dt>
              <dd>{{ sel.description || ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'agents.authority' | t }}</dt>
              <dd>{{ sel.authority ?? ('state.absent' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'agents.domains' | t }}</dt>
              <dd>{{ sel.domains.length ? sel.domains.join(', ') : ('state.none' | t) }}</dd>
            </div>
            <div>
              <dt>{{ 'agents.skills' | t }}</dt>
              <dd>
                @if (sel.skills.length) {
                  <span class="links">
                    @for (s of sel.skills; track s) {
                      <a class="chip-link" [routerLink]="['/skills']" [queryParams]="{ q: s }">{{
                        s
                      }}</a>
                    }
                  </span>
                } @else {
                  {{ 'state.none' | t }}
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.origin' | t }}</dt>
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
              <dt>{{ 'agents.compatibleHosts' | t }}</dt>
              <dd>
                @if (sel.hosts.length) {
                  {{ sel.hosts.join(', ') }}
                } @else {
                  <ui-state-badge state="UNVERIFIED" />
                }
              </dd>
            </div>
            <div>
              <dt>{{ 'skills.state' | t }}</dt>
              <dd>
                <ui-state-badge
                  [state]="sel.state === 'available' ? 'supported' : 'unverified'"
                  [labelOverride]="sel.state"
                />
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.tools' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'agents.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.permissions' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'agents.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.deps' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'agents.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'settings.version' | t }}</dt>
              <dd class="unv-cell">
                <ui-state-badge state="UNVERIFIED" />
                <small class="muted">{{ 'agents.notExposed' | t }}</small>
              </dd>
            </div>
            <div>
              <dt>{{ 'agents.evidence' | t }}</dt>
              <dd><code>GET /api/v1/agents</code></dd>
            </div>
          </dl>
        </section>
      }

      <section class="grid">
        @for (a of filtered(); track a.id) {
          <article class="card" data-lift>
            <header class="head">
              <h2><ui-icon name="agents" [size]="15" />{{ a.name || a.id }}</h2>
              <ui-state-badge
                [state]="a.state === 'available' ? 'supported' : 'unverified'"
                [labelOverride]="a.state"
              />
            </header>
            <p class="role">{{ a.role }}</p>
            <p class="muted">{{ a.description }}</p>
            @if (a.domains.length) {
              <p class="tags">
                <span>{{ 'agents.domains' | t }}:</span> {{ a.domains.join(', ') }}
              </p>
            }
            @if (a.skills.length) {
              <p class="tags">
                <span>{{ 'agents.skills' | t }}:</span> {{ a.skills.join(', ') }}
              </p>
            }
            <div class="row">
              <button class="btn btn--mini" (click)="selected.set(a)">
                {{ 'agents.detail' | t }}
                <ui-icon name="chevron-right" [size]="13" />
              </button>
            </div>
          </article>
        } @empty {
          @if (!loading()) {
            <ui-empty icon="agents" [title]="'agents.empty' | t" />
          }
        }
      </section>
    } @else if (!error() && !loading()) {
      <ui-empty icon="agents" [title]="'agents.none' | t" />
    }
  `,
  styles: `
    .grid {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: var(--space-2);
    }
    h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
    }
    h2 ui-icon {
      color: var(--accent);
    }
    .role {
      color: var(--accent);
      font-size: var(--font-sm);
      margin: 4px 0;
    }
    .muted {
      color: var(--fg-muted);
      margin: 0;
    }
    .tags {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      margin: 4px 0 0;
    }
    .tags span {
      font-weight: 600;
    }
    .sel {
      width: auto;
      min-width: 12rem;
      padding-block: 2px;
      font-size: var(--font-xs);
    }
    .row {
      margin-top: var(--space-3);
      display: flex;
      justify-content: flex-end;
    }
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
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
    .links {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .chip-link {
      font-size: var(--font-xs);
      font-weight: 600;
      color: var(--accent);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
      text-decoration: none;
    }
    .chip-link:hover {
      text-decoration: underline;
    }
    .chip {
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--accent);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
      margin-left: 4px;
    }
  `,
})
export class AgentsPage implements OnInit {
  private readonly api = inject(PortalApi);
  readonly store = inject(PortalStore);

  /** Route `?q=` deep-link (withComponentInputBinding). */
  readonly q = input('');

  readonly agents = signal<AgentDescriptor[]>([]);
  readonly error = signal<ApiError | null>(null);
  readonly query = signal('');
  readonly domain = signal<string | null>(null);
  readonly skill = signal<string | null>(null);
  readonly selected = signal<AgentDescriptor | null>(null);
  readonly loading = signal(true);

  readonly domainOptions = computed(() => {
    const set = new Set<string>();
    for (const a of this.agents()) for (const d of a.domains) set.add(d);
    return [...set].sort();
  });

  readonly skillOptions = computed(() => {
    const set = new Set<string>();
    for (const a of this.agents()) for (const s of a.skills) set.add(s);
    return [...set].sort();
  });

  readonly filtered = computed(() => {
    const q = norm(this.query());
    const domain = this.domain();
    const skill = this.skill();
    return this.agents().filter((a) => {
      if (domain !== null && !a.domains.includes(domain)) return false;
      if (skill !== null && !a.skills.includes(skill)) return false;
      if (!q) return true;
      const hay = [a.id, a.name, a.role, a.description, ...a.domains, ...a.skills, ...a.hosts]
        .map(norm)
        .join(' ');
      return hay.includes(q);
    });
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
      this.agents.set(await firstValueFrom(this.api.agents()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  toggleDomain(d: string): void {
    this.domain.set(this.domain() === d ? null : d);
  }

  onSkill(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.skill.set(v || null);
  }
}
