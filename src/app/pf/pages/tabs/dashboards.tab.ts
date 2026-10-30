import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PfApi } from '../../pf-api.service';
import { ApiError } from '../../../core/api/api.error';
import {
  PfDashboard,
  PfDashboardRender,
  PfDataSource,
  PfWidget,
  PfWidgetResult,
} from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { StateBadge } from '../../../shared/state-badge';
import { UiIcon } from '../../../shared/icon';
import { UiSkeleton } from '../../../shared/skeleton';
import { ToastService } from '../../../shared/toast';

const WIDGET_TYPES = ['table', 'kpi_card', 'bar_chart', 'line_chart', 'pie_chart'] as const;

interface DraftWidget {
  title: string;
  type: string;
  source_id: string;
  statement: string;
}

/**
 * Dashboards tab — dashboard registry (create with a composed widget
 * list — the engine takes widgets at creation, there is no widget PATCH)
 * and the real render pipeline. Widget states are the engine's own
 * (`ok` | `error` | `unavailable`) and render honestly: KPI cards, row
 * tables and a CSS/SVG bar chart — no chart lib.
 */
@Component({
  selector: 'pf-dashboards-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, StateBadge, UiIcon, UiSkeleton],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" aria-label="loading dashboards">
        <ui-skeleton kind="card" [lines]="3" />
      </div>
    } @else {
      <section class="card">
        <h2>New dashboard</h2>
        <form class="stack" (submit)="createDashboard($event)">
          <div class="fg-row" data-wrap>
            <input
              class="input grow"
              [value]="dashName()"
              (input)="dashName.set($any($event.target).value)"
              placeholder="Dashboard name"
              required
              aria-label="Dashboard name"
            />
            <input
              class="input grow"
              [value]="dashDesc()"
              (input)="dashDesc.set($any($event.target).value)"
              placeholder="Description (optional)"
              aria-label="Description"
            />
          </div>

          <fieldset class="wcomposer">
            <legend class="muted small">Compose widgets (bound to a data source + statement)</legend>
            @for (w of draftWidgets(); track $index; let i = $index) {
              <div class="wdraft">
                <span class="chip">{{ w.type }}</span>
                <strong>{{ w.title || 'untitled' }}</strong>
                <code class="muted small">{{ sourceName(w.source_id) }}</code>
                <code class="muted small ellipsis">{{ w.statement }}</code>
                <button
                  class="icon-btn"
                  type="button"
                  [attr.aria-label]="'Remove widget ' + (i + 1)"
                  (click)="removeWidget(i)"
                >
                  <ui-icon name="close" [size]="13" />
                </button>
              </div>
            }
            <div class="wform">
              <input
                class="input"
                [value]="wTitle()"
                (input)="wTitle.set($any($event.target).value)"
                placeholder="Widget title"
                aria-label="Widget title"
              />
              <select
                class="select"
                [value]="wType()"
                (change)="wType.set($any($event.target).value)"
                aria-label="Widget type"
              >
                @for (t of widgetTypes; track t) {
                  <option [value]="t">{{ t }}</option>
                }
              </select>
              <select
                class="select"
                [value]="wSource()"
                (change)="wSource.set($any($event.target).value)"
                aria-label="Data source"
              >
                <option value="" disabled>Data source…</option>
                @for (s of sources(); track s.id) {
                  <option [value]="s.id">{{ s.name }}</option>
                }
              </select>
              <input
                class="input mono span2"
                [value]="wStatement()"
                (input)="wStatement.set($any($event.target).value)"
                placeholder="SELECT … statement for this widget"
                aria-label="Widget statement"
              />
              <button
                class="btn btn--mini"
                type="button"
                [disabled]="!wSource() || !wStatement().trim()"
                (click)="addWidget()"
              >
                + Add widget
              </button>
            </div>
          </fieldset>

          <div>
            <button class="btn btn--primary" type="submit" [disabled]="busy() || !dashName().trim()">
              Create dashboard
            </button>
          </div>
        </form>
      </section>

      @if (dashboards().length) {
        <div class="dlist">
          @for (d of dashboards(); track d.id) {
            <article class="card">
              <header class="dhead">
                <div class="dhead__id">
                  <strong>{{ d.name }}</strong>
                  <code class="muted small">{{ d.id }}</code>
                  @if (d.description) {
                    <p class="muted small">{{ d.description }}</p>
                  }
                </div>
                <span class="fg-pill">{{ d.widgets?.length ?? 0 }} widget(s)</span>
                <button
                  class="btn"
                  [disabled]="renderingId() === d.id"
                  (click)="render(d)"
                >
                  {{ renderingId() === d.id ? 'Rendering…' : 'Render' }}
                </button>
              </header>

              @if (renders()[d.id]; as r) {
                <div class="render fg-enter" aria-live="polite">
                  @if (r.stats) {
                    <p class="muted small">
                      {{ r.stats!.ok }}/{{ r.stats!.total }} widget(s) ok ·
                      {{ r.stats!.unavailable }} unavailable/error
                    </p>
                  }
                  <div class="wgrid">
                    @for (w of r.widgets; track $index) {
                      <div class="widget" [attr.data-state]="w.state">
                        <header class="widget__head">
                          <strong>{{ w.title || w.type }}</strong>
                          <ui-state-badge
                            [state]="w.state === 'ok' ? 'ok' : w.state === 'error' ? 'error' : 'unverified'"
                            [labelOverride]="w.state"
                          />
                        </header>
                        @if (w.state === 'ok' && w.data) {
                          @switch (w.type) {
                            @case ('kpi_card') {
                              <div class="kpi">
                                <span class="kpi__v">{{ w.data.value ?? '—' }}</span>
                                <span class="kpi__l">{{ w.data.label ?? 'value' }}</span>
                              </div>
                            }
                            @case ('bar_chart') {
                              @if (w.data.labels?.length) {
                                <div class="bars" role="img" [attr.aria-label]="w.title ?? 'bar chart'">
                                  @for (l of w.data.labels!; track l; let i = $index) {
                                    <div class="bars__row">
                                      <span class="bars__label" [title]="l">{{ l }}</span>
                                      <span
                                        class="bars__bar"
                                        [style.width.%]="barWidth(w, i)"
                                      ></span>
                                      <span class="bars__val">{{ w.data.series?.[0]?.values?.[i] ?? '—' }}</span>
                                    </div>
                                  }
                                </div>
                              } @else {
                                <p class="muted small">Chart returned no data points.</p>
                              }
                            }
                            @default {
                              @if (w.data.columns?.length) {
                                <div class="rwrap">
                                  <table class="table">
                                    <thead>
                                      <tr>
                                        @for (c of w.data.columns!; track c) {
                                          <th scope="col">{{ c }}</th>
                                        }
                                      </tr>
                                    </thead>
                                    <tbody>
                                      @for (row of w.data.rows ?? []; track $index) {
                                        <tr>
                                          @for (cell of row; track $index) {
                                            <td>{{ cell }}</td>
                                          }
                                        </tr>
                                      }
                                    </tbody>
                                  </table>
                                </div>
                              } @else {
                                <p class="muted small">0 rows.</p>
                              }
                            }
                          }
                          @if (w.duration_ms !== undefined) {
                            <p class="muted small">
                              query {{ w.query_id }} · {{ w.duration_ms }}ms
                              @if (w.truncated) {
                                · truncated
                              }
                            </p>
                          }
                        } @else {
                          <p class="werr">{{ w.error ?? 'unavailable' }}</p>
                        }
                      </div>
                    }
                  </div>
                </div>
              }
            </article>
          }
        </div>
      } @else if (!error()) {
        <ui-empty
          icon="dashboard"
          title="No dashboards yet"
          hint="Compose widgets above — they bind a statement to a registered data source."
        />
      }
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
    .wcomposer {
      border: 1px dashed var(--border-strong);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      display: grid;
      gap: var(--space-3);
      margin: 0;
    }
    .wcomposer legend {
      padding: 0 var(--space-1);
    }
    .wdraft {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-2) var(--space-3);
      background: var(--bg-hover);
      min-width: 0;
    }
    .wdraft .ellipsis {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wform {
      display: grid;
      gap: var(--space-2);
      grid-template-columns: 1fr 9rem 12rem;
      align-items: center;
    }
    .wform .span2 {
      grid-column: 1 / -1;
    }
    .wform .btn {
      justify-self: start;
    }
    .dlist {
      display: grid;
      gap: var(--space-4);
    }
    .dhead {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .dhead__id {
      flex: 1;
      min-width: 0;
      display: grid;
    }
    .render {
      margin-top: var(--space-4);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
      display: grid;
      gap: var(--space-3);
    }
    .wgrid {
      display: grid;
      gap: var(--space-3);
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    }
    .widget {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-hover);
      padding: var(--space-3);
      display: grid;
      gap: var(--space-2);
      align-content: start;
    }
    .widget[data-state='ok'] {
      background: var(--bg-elevated);
    }
    .widget__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .kpi {
      display: grid;
      gap: 2px;
      padding: var(--space-3);
      text-align: center;
    }
    .kpi__v {
      font-size: var(--font-2xl);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .kpi__l {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .bars {
      display: grid;
      gap: 6px;
    }
    .bars__row {
      display: grid;
      grid-template-columns: minmax(4rem, 8rem) 1fr auto;
      align-items: center;
      gap: var(--space-2);
      font-size: var(--font-xs);
    }
    .bars__label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--fg-muted);
    }
    .bars__bar {
      height: 12px;
      border-radius: var(--radius-sm);
      background: linear-gradient(90deg, var(--accent), var(--accent-strong));
      min-width: 2px;
    }
    .bars__val {
      font-variant-numeric: tabular-nums;
      color: var(--fg);
    }
    .werr {
      margin: 0;
      color: var(--warn);
      font-size: var(--font-sm);
    }
    .rwrap {
      overflow-x: auto;
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
  `,
})
export class PfDashboardsTab implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly pid = input.required<string>();

  readonly widgetTypes = WIDGET_TYPES;
  readonly dashboards = signal<PfDashboard[]>([]);
  readonly sources = signal<PfDataSource[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly renderingId = signal<string | null>(null);
  readonly renders = signal<Record<string, PfDashboardRender>>({});

  readonly dashName = signal('');
  readonly dashDesc = signal('');
  readonly draftWidgets = signal<DraftWidget[]>([]);
  readonly wTitle = signal('');
  readonly wType = signal<string>('table');
  readonly wSource = signal('');
  readonly wStatement = signal('');

  private readonly sourceMap = computed(
    () => new Map(this.sources().map((s) => [s.id, s.name])),
  );

  sourceName(id: string): string {
    return this.sourceMap().get(id) ?? id;
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const [dash, ds] = await Promise.all([
        firstValueFrom(this.api.dashboards(this.pid())),
        firstValueFrom(this.api.dataSources(this.pid())),
      ]);
      this.dashboards.set(dash.items ?? []);
      this.sources.set(ds.items ?? []);
      if (!this.wSource() && ds.items?.length) this.wSource.set(ds.items[0].id);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  addWidget(): void {
    const w: DraftWidget = {
      title: this.wTitle().trim(),
      type: this.wType(),
      source_id: this.wSource(),
      statement: this.wStatement().trim(),
    };
    if (!w.source_id || !w.statement) return;
    this.draftWidgets.update((l) => [...l, w]);
    this.wTitle.set('');
    this.wStatement.set('');
  }

  removeWidget(i: number): void {
    this.draftWidgets.update((l) => l.filter((_, x) => x !== i));
  }

  async createDashboard(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.dashName().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    try {
      const widgets: PfWidget[] = this.draftWidgets().map((w, i) => ({
        id: `w${i + 1}`,
        type: w.type,
        title: w.title || `Widget ${i + 1}`,
        source_id: w.source_id,
        statement: w.statement,
      }));
      await firstValueFrom(
        this.api.createDashboard(this.pid(), {
          name,
          description: this.dashDesc().trim(),
          widgets,
        }),
      );
      this.dashName.set('');
      this.dashDesc.set('');
      this.draftWidgets.set([]);
      this.toast.show(`Dashboard "${name}" created`, 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async render(d: PfDashboard): Promise<void> {
    if (this.renderingId()) return;
    this.renderingId.set(d.id);
    try {
      const r = await firstValueFrom(this.api.renderDashboard(this.pid(), d.id));
      this.renders.update((m) => ({ ...m, [d.id]: r }));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.renderingId.set(null);
    }
  }

  /** Bar width as % of the max first-series value — honest scaling over
   *  the rendered window only (the engine's ≤100-row preview). */
  barWidth(w: PfWidgetResult, rowIndex: number): number {
    const vals = (w.data?.series?.[0]?.values ?? [])
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n));
    const max = Math.max(...vals, 0);
    const v = Number(w.data?.series?.[0]?.values?.[rowIndex]);
    if (!Number.isFinite(v) || max <= 0) return 0;
    return Math.max(1, Math.round((v / max) * 100));
  }
}
