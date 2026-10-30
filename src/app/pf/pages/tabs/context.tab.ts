import { TPipe } from '../../../core/i18n/i18n.pipe';
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
import { PfApi } from '../../pf-api.service';
import { ApiError } from '../../../core/api/api.error';
import { PfContextPackage } from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { StateBadge } from '../../../shared/state-badge';
import { UiSkeleton } from '../../../shared/skeleton';

/**
 * Context tab — the real `productforge/ProductContextPackage/v1`:
 * product facts plus the live counts and entity inventory the engine
 * assembled. Counts come from the payload, never recomputed elsewhere.
 */
@Component({
  selector: 'pf-context-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, StateBadge, UiSkeleton, TPipe],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }
    @if (loading()) {
      <div role="status" aria-label="loading context package">
        <ui-skeleton kind="card" [lines]="3" />
      </div>
    } @else if (ctx(); as c) {
      <div class="stats stagger">
        <div class="stat">
          <span class="stat__value">{{ count(c.sources) }}</span>
          <span class="stat__label">{{ 'pf.context.knowledgeSources' | t }}</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ count(c.entities) }}</span>
          <span class="stat__label">{{ 'pf.context.entities' | t }}</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ count(c.agents) }}</span>
          <span class="stat__label">{{ 'pf.context.agents' | t }}</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ count(c.data_sources) }}</span>
          <span class="stat__label">{{ 'pf.context.dataSources' | t }}</span>
        </div>
      </div>

      <section class="card">
        <h2>{{ 'pf.context.product' | t }}</h2>
        <dl class="kv">
          <div>
            <dt>{{ 'pf.context.name' | t }}</dt>
            <dd>{{ c.product.name }}</dd>
          </div>
          <div>
            <dt>{{ 'pf.context.id' | t }}</dt>
            <dd>
              <code>{{ c.product.id }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ 'pf.context.workspace' | t }}</dt>
            <dd>
              <code>{{ c.product.workspace_id }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ 'pf.context.status' | t }}</dt>
            <dd>
              <ui-state-badge
                [state]="c.product.status === 'active' ? 'ACTIVE' : 'muted'"
                [labelOverride]="c.product.status ?? 'unknown'"
              />
            </dd>
          </div>
          <div>
            <dt>{{ 'pf.context.domain' | t }}</dt>
            <dd>{{ c.product.domain || '—' }}</dd>
          </div>
          <div>
            <dt>{{ 'pf.context.description' | t }}</dt>
            <dd>{{ c.product.description || '—' }}</dd>
          </div>
          @if (c.product.tags?.length) {
            <div>
              <dt>{{ 'pf.context.tags' | t }}</dt>
              <dd class="tagrow">
                @for (t of c.product.tags; track t) {
                  <span class="chip">{{ t }}</span>
                }
              </dd>
            </div>
          }
          <div>
            <dt>{{ 'pf.context.package' | t }}</dt>
            <dd>
              <code>{{ c.schema ?? 'productforge/ProductContextPackage/v1' }}</code>
              @if (c.generated_at) {
                <span class="muted small"> · generated {{ c.generated_at }}</span>
              }
            </dd>
          </div>
        </dl>
      </section>

      <section class="card">
        <h2>{{ 'pf.context.entityInventory' | t }}</h2>
        @if (entityKinds().length) {
          <div class="kindrow">
            @for (k of entityKinds(); track k.kind) {
              <span class="fg-pill" data-tone="info">{{ k.kind }} · {{ k.count }}</span>
            }
          </div>
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'pf.context.entity' | t }}</th>
                <th scope="col">{{ 'pf.context.kind' | t }}</th>
                <th scope="col">{{ 'pf.context.confidence' | t }}</th>
                <th scope="col">{{ 'pf.context.provisional' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (e of topEntities(); track e.id) {
                <tr>
                  <td>
                    <strong>{{ e.name }}</strong>
                    @if (e.description) {
                      <p class="muted small clamp">{{ e.description }}</p>
                    }
                  </td>
                  <td>
                    <span class="chip">{{ e.kind ?? 'other' }}</span>
                  </td>
                  <td>{{ pct(e.confidence) }}</td>
                  <td>
                    <ui-state-badge
                      [state]="e.provisional ? 'unverified' : 'ok'"
                      [labelOverride]="e.provisional ? 'provisional' : 'confirmed'"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
          @if ((c.entities?.length ?? 0) > topEntities().length) {
            <p class="muted small">
              Showing {{ topEntities().length }} of {{ c.entities!.length }} entities — see the
              Knowledge tab for the full graph.
            </p>
          }
        } @else {
          <ui-empty
            icon="graph"
            title="No entities extracted yet"
            hint="Import documents in the Knowledge tab, then run extraction."
          />
        }
      </section>
    }
  `,
  styles: `
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-4);
    }
    .card {
      margin-bottom: var(--space-4);
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
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
    .tagrow,
    .kindrow {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .kindrow {
      margin-bottom: var(--space-3);
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
    .clamp {
      margin: 2px 0 0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `,
})
export class PfContextTab implements OnInit {
  private readonly api = inject(PfApi);
  readonly pid = input.required<string>();

  readonly ctx = signal<PfContextPackage | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);

  readonly topEntities = computed(() =>
    [...(this.ctx()?.entities ?? [])]
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .slice(0, 25),
  );

  readonly entityKinds = computed(() => {
    const counts = new Map<string, number>();
    for (const e of this.ctx()?.entities ?? []) {
      const k = e.kind ?? 'other';
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count);
  });

  ngOnInit(): void {
    void this.load();
  }

  count(list: unknown[] | undefined): number | string {
    return list === undefined ? '—' : list.length;
  }

  pct(v: number | undefined): string {
    return v === undefined ? '—' : `${Math.round(v * 100)}%`;
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.ctx.set(await firstValueFrom(this.api.productContext(this.pid())));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }
}
