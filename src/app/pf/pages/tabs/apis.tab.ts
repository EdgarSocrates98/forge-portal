import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PfApi } from '../../pf-api.service';
import { ApiError } from '../../../core/api/api.error';
import { PfApiSpec, PfImpact } from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { UiSkeleton } from '../../../shared/skeleton';
import { ToastService } from '../../../shared/toast';

/**
 * APIs tab — OpenAPI/AsyncAPI spec import (the engine parses the
 * surface into knowledge entities), the imported-spec inventory with
 * its parsed operations, and impact analysis over the relation graph.
 */
@Component({
  selector: 'pf-apis-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, UiSkeleton],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" aria-label="loading apis"><ui-skeleton kind="card" [lines]="3" /></div>
    } @else {
      <section class="card">
        <h2>Import API spec</h2>
        <form class="stack" (submit)="importSpec($event)">
          <div class="fg-row" data-wrap>
            <input
              class="input grow"
              [value]="specName()"
              (input)="specName.set($any($event.target).value)"
              placeholder="Display name (optional — spec title wins)"
              aria-label="Spec name"
            />
          </div>
          <textarea
            class="textarea mono"
            rows="7"
            [value]="specContent()"
            (input)="specContent.set($any($event.target).value)"
            placeholder="Paste an OpenAPI (JSON/YAML) or AsyncAPI document"
            aria-label="Spec content"
            required
          ></textarea>
          <div>
            <button
              class="btn btn--primary"
              type="submit"
              [disabled]="busy() || !specContent().trim()"
            >
              {{ busy() ? 'Importing…' : 'Import spec' }}
            </button>
          </div>
        </form>
        @if (importNote(); as n) {
          <p class="ok-note">
            Imported — {{ n.entities_created }} API entit(ies) created (kind {{ n.kind }}).
          </p>
        }
      </section>

      <section class="card">
        <h2>Registered APIs</h2>
        @if (apis().length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">API</th>
                <th scope="col">Kind</th>
                <th scope="col">Operations</th>
                <th scope="col"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (a of apis(); track a.id) {
                <tr [attr.data-selected]="openId() === a.id || null">
                  <td>
                    <strong>{{ a.name }}</strong>
                    <code class="muted small"> {{ a.id }}</code>
                    @if (a.version) {
                      <span class="muted small"> · v{{ a.version }}</span>
                    }
                  </td>
                  <td>
                    <span class="chip">{{ a.kind ?? '—' }}</span>
                  </td>
                  <td>{{ a.surface?.operations?.length ?? 0 }}</td>
                  <td>
                    <button class="btn btn--mini" (click)="toggle(a.id)">
                      {{ openId() === a.id ? 'Hide' : 'Operations' }}
                    </button>
                  </td>
                </tr>
                @if (openId() === a.id) {
                  <tr>
                    <td colspan="4">
                      @if (a.surface?.operations?.length) {
                        <ul class="ops">
                          @for (op of a.surface!.operations!; track op.method + ' ' + op.path) {
                            <li>
                              <span class="op__m" [attr.data-m]="op.method">{{
                                op.method.toUpperCase()
                              }}</span>
                              <code>{{ op.path }}</code>
                              @if (op.summary) {
                                <span class="muted small">{{ op.summary }}</span>
                              }
                              @if (op.params?.length) {
                                <span class="muted small">({{ op.params!.length }} params)</span>
                              }
                            </li>
                          }
                        </ul>
                      } @else {
                        <p class="muted small">Surface parsed with 0 operations.</p>
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        } @else {
          <ui-empty icon="mcp" title="No API specs imported" />
        }
      </section>

      <section class="card">
        <h2>Impact analysis</h2>
        <p class="muted small">
          What breaks if an entity changes? BFS over the relation graph — entities are
          created by extraction and API imports.
        </p>
        <form class="iform" (submit)="runImpact($event)">
          <input
            class="input grow"
            [value]="entityId()"
            (input)="entityId.set($any($event.target).value)"
            placeholder="Entity id (e.g. ent_… from Context/Knowledge)"
            required
            aria-label="Entity id"
          />
          <button class="btn" type="submit" [disabled]="impactBusy() || !entityId().trim()">
            {{ impactBusy() ? 'Analyzing…' : 'Analyze impact' }}
          </button>
        </form>
        @if (impact(); as im) {
          <div class="panel fg-enter" aria-live="polite">
            <p class="muted small">
              Origin <code>{{ im.origin }}</code> · depth {{ im.max_depth ?? '—' }} ·
              {{ im.count ?? 0 }} impacted entit(ies)
            </p>
            @if (im.impacted?.length) {
              <table class="table">
                <thead>
                  <tr>
                    <th scope="col">Entity</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Depth</th>
                    <th scope="col">Via</th>
                  </tr>
                </thead>
                <tbody>
                  @for (x of im.impacted!; track x.entity_id) {
                    <tr>
                      <td>
                        <strong>{{ x.name ?? x.entity_id }}</strong>
                        <code class="muted small"> {{ x.entity_id }}</code>
                      </td>
                      <td>
                        <span class="chip">{{ x.kind ?? '—' }}</span>
                      </td>
                      <td>{{ x.depth ?? '—' }}</td>
                      <td>
                        <code class="muted small">{{ x.via ?? '—' }}</code>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            } @else {
              <ui-empty icon="graph" title="No downstream impact found" />
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
    }
    .card {
      margin-bottom: var(--space-4);
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .stack {
      display: grid;
      gap: var(--space-3);
    }
    .grow {
      flex: 1;
      min-width: 12rem;
    }
    .mono {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
    }
    .iform {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin: var(--space-3) 0;
    }
    .ops {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .ops li {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      font-size: var(--font-sm);
    }
    .op__m {
      font-size: var(--font-xs);
      font-weight: 700;
      min-width: 3.4rem;
      color: var(--info);
    }
    .op__m[data-m='post'],
    .op__m[data-m='put'],
    .op__m[data-m='patch'] {
      color: var(--warn);
    }
    .op__m[data-m='delete'] {
      color: var(--error);
    }
    .panel {
      margin-top: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-hover);
      padding: var(--space-3);
      display: grid;
      gap: var(--space-2);
    }
    .ok-note {
      margin: var(--space-3) 0 0;
      font-size: var(--font-sm);
      color: var(--ok);
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
  `,
})
export class PfApisTab implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly pid = input.required<string>();

  readonly apis = signal<PfApiSpec[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly openId = signal<string | null>(null);
  readonly importNote = signal<{ entities_created: number; kind: string } | null>(null);

  readonly specName = signal('');
  readonly specContent = signal('');
  readonly entityId = signal('');
  readonly impactBusy = signal(false);
  readonly impact = signal<PfImpact | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const r = await firstValueFrom(this.api.apis(this.pid()));
      this.apis.set(r.items ?? []);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  toggle(id: string): void {
    this.openId.set(this.openId() === id ? null : id);
  }

  async importSpec(ev: Event): Promise<void> {
    ev.preventDefault();
    const spec = this.specContent().trim();
    if (!spec || this.busy()) return;
    this.busy.set(true);
    this.importNote.set(null);
    try {
      const name = this.specName().trim();
      const r = await firstValueFrom(
        this.api.importApi(this.pid(), name ? { name, spec } : { spec }),
      );
      this.importNote.set(r);
      this.specContent.set('');
      this.specName.set('');
      this.toast.show('API spec imported', 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async runImpact(ev: Event): Promise<void> {
    ev.preventDefault();
    const id = this.entityId().trim();
    if (!id || this.impactBusy()) return;
    this.impactBusy.set(true);
    try {
      this.impact.set(await firstValueFrom(this.api.impact(this.pid(), id)));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.impactBusy.set(false);
    }
  }
}
