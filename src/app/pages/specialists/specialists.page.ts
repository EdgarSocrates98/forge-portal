import { Component, computed, inject, signal } from '@angular/core';
import { PortalApi } from '../../core/api/api.client';
import { SpecialistRow, SpecialistsReport } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, stamp } from '../explorer/forges.data';

/**
 * Specialists (theforge/PortalSpecialists/v1) — the adapter's real
 * discovery report verbatim: every field comes off the wire; a state
 * the discovery pass could not verify stays exactly as reported
 * (declared/unverified — probe=false means it can never reach
 * VERIFIED from this surface). `generated_at` is the persisted
 * last-check stamp and `probed` tells whether CLI probes ran — both
 * are rendered so the operator knows how fresh/complete the data is.
 */
@Component({
  selector: 'page-specialists',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'spec.title' | t" [subtitle]="'spec.subtitle' | t">
      <button class="btn" [disabled]="src.loading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (src.error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }
    @if (src.loading() && !report()) {
      <section class="card" role="status"><ui-skeleton kind="row" [lines]="3" /></section>
    }
    @if (report(); as rep) {
      <section class="card" data-section="availability">
        <div class="avail">
          <ui-state-badge [state]="rep.availability.state" />
          @if (rep.availability.detail) {
            <span class="muted">{{ rep.availability.detail }}</span>
          }
        </div>
        <p class="src">
          <code>GET /api/v1/specialists · {{ rep.schema ?? 'theforge/PortalSpecialists/v1' }}</code>
          @if (src.loadedAt(); as ts) {
            <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
          }
        </p>
        <dl class="meta">
          <div>
            <dt>{{ 'spec.generatedAt' | t }}</dt>
            <dd>
              @if (rep.generated_at; as g) {
                <code>{{ g }}</code>
              } @else {
                <ui-state-badge state="UNVERIFIED" />
              }
            </dd>
          </div>
          <div>
            <dt>{{ 'spec.probed' | t }}</dt>
            <dd>{{ rep.probed === true ? ('spec.probed.yes' | t) : ('spec.probed.no' | t) }}</dd>
          </div>
          @if (rep.truncated) {
            <div>
              <dt>{{ 'spec.truncated' | t }}</dt>
              <dd><ui-state-badge state="PARTIAL" /></dd>
            </div>
          }
        </dl>
        @if (rep.limitations?.length) {
          <ul class="notes">
            @for (n of rep.limitations; track n) {
              <li class="muted">{{ n }}</li>
            }
          </ul>
        }
      </section>

      @if (filtered().length) {
        <div class="filters">
          <input
            class="input"
            type="search"
            [value]="q()"
            (input)="setQ($event)"
            [placeholder]="'spec.filter' | t"
            [attr.aria-label]="'spec.filter' | t"
          />
        </div>
        @for (s of filtered(); track s.provider) {
          <section class="card spec" [attr.data-provider]="s.provider">
            <div class="spec__head">
              <h2 class="spec__name">
                <code>{{ s.provider }}</code>
              </h2>
              <ui-state-badge [state]="s.state ?? 'UNVERIFIED'" />
              @if (s.version) {
                <code class="ver">v{{ s.version }}</code>
              }
              @if (s.last_check; as lc) {
                <span class="muted small">{{ 'spec.lastCheck' | t }} {{ stamp(lc) }}</span>
              }
            </div>
            @if (s.compatibility) {
              <p class="muted small">
                {{ 'spec.compat' | t }}:
                <ui-state-badge [state]="s.compatibility.state ?? 'UNVERIFIED'" />
                @if (s.compatibility.detail) {
                  {{ s.compatibility.detail }}
                }
              </p>
            }
            <dl class="meta">
              <div>
                <dt>{{ 'spec.capabilities' | t }}</dt>
                <dd>{{ s.capability_count ?? s.capabilities?.length ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ 'spec.workflows' | t }}</dt>
                <dd>{{ s.workflow_count ?? s.workflows?.length ?? 0 }}</dd>
              </div>
              <div>
                <dt>{{ 'spec.roster' | t }}</dt>
                <dd>{{ s.agent_roster ? ('spec.roster.present' | t) : ('state.none' | t) }}</dd>
              </div>
            </dl>
            @if (declared(s); as d) {
              <p class="muted small">
                {{ 'spec.family' | t }}: <code>{{ d.family ?? '—' }}</code>
                @if (d.composes_with?.length) {
                  · {{ 'spec.composes' | t }}:
                  @for (o of d.composes_with; track o) {
                    <code>{{ o }}</code
                    >{{ ' ' }}
                  }
                }
                @if (d.preferred_verifiers?.length) {
                  · {{ 'spec.verifiers' | t }}:
                  @for (o of d.preferred_verifiers; track o) {
                    <code>{{ o }}</code
                    >{{ ' ' }}
                  }
                }
                @if (d.fallback?.length) {
                  · {{ 'spec.fallback' | t }}:
                  @for (o of d.fallback; track o) {
                    <code>{{ o }}</code
                    >{{ ' ' }}
                  }
                }
              </p>
            }
            @if (s.capabilities?.length) {
              <details class="caps">
                <summary>{{ 'spec.capabilities' | t }} ({{ s.capabilities!.length }})</summary>
                <ul>
                  @for (c of s.capabilities; track c.id) {
                    <li>
                      <code>{{ c.id }}</code>
                      @if (c.description) {
                        <span class="muted"> — {{ c.description }}</span>
                      }
                      @if (c.risk) {
                        <ui-state-badge [state]="c.risk" />
                      }
                      @if (c.external_cost) {
                        <span class="muted"> · {{ 'spec.externalCost' | t }}</span>
                      }
                    </li>
                  }
                </ul>
              </details>
            }
            @if (s.limitations?.length) {
              <ul class="notes">
                @for (n of s.limitations; track n) {
                  <li class="muted">{{ n }}</li>
                }
              </ul>
            }
            @if (s.notes?.length) {
              <ul class="notes">
                @for (n of s.notes; track n) {
                  <li class="muted">{{ n }}</li>
                }
              </ul>
            }
          </section>
        }
      } @else if (report()) {
        <ui-empty icon="inbox" [title]="q() ? ('spec.noMatches' | t) : ('spec.empty' | t)" />
      }
    }
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    .avail {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .src {
      margin: 4px 0 var(--space-2);
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-5);
      margin: var(--space-2) 0;
    }
    .meta div {
      display: grid;
      gap: 2px;
    }
    .meta dt {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .meta dd {
      margin: 0;
      font-size: var(--font-sm);
    }
    .filters {
      margin-bottom: var(--space-3);
    }
    .filters .input {
      min-width: 260px;
    }
    .spec__head {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
    }
    .spec__name {
      margin: 0;
      font-size: var(--font-lg);
    }
    .ver {
      font-size: var(--font-xs);
      font-weight: 600;
      background: var(--accent-bg);
      color: var(--accent-ink);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
    .notes {
      margin: var(--space-2) 0 0;
      padding-left: var(--space-4);
      font-size: var(--font-xs);
    }
    .caps {
      margin-top: var(--space-2);
      font-size: var(--font-sm);
    }
    .caps ul {
      margin: var(--space-2) 0 0;
      padding-left: var(--space-4);
      display: grid;
      gap: 4px;
    }
  `,
})
export class SpecialistsPage {
  private readonly api = inject(PortalApi);

  readonly src = new Source<SpecialistsReport>();
  readonly report = computed(() => this.src.data());
  readonly q = signal('');

  readonly filtered = computed<SpecialistRow[]>(() => {
    const needle = this.q().trim().toLowerCase();
    const rows = this.report()?.specialists ?? [];
    if (!needle) return rows;
    return rows.filter(
      (s) =>
        s.provider.toLowerCase().includes(needle) ||
        (s.capabilities ?? []).some((c) => c.id.toLowerCase().includes(needle)),
    );
  });

  readonly stamp = stamp;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    await this.src.load(() => this.api.specialists());
  }

  setQ(e: Event): void {
    this.q.set((e.target as HTMLInputElement).value);
  }

  declared(s: SpecialistRow) {
    return s.relations?.declared ?? null;
  }
}
