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
import {
  PfDataSource,
  PfMetric,
  PfNlQueryResult,
  PfQueryRun,
  PfQueryValidation,
  PfSourceSchema,
  PfVerifyResult,
} from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { StateBadge } from '../../../shared/state-badge';
import { UiSkeleton } from '../../../shared/skeleton';
import { ToastService } from '../../../shared/toast';

const CONNECTORS = [
  'sqlite',
  'duckdb',
  'csv',
  'postgres',
  'mysql',
  'athena',
  'trino',
  'databricks',
  'fabric',
  'bigquery',
];

/**
 * Analytics tab — data-source registry (verify + schema introspection)
 * and the read-only SQL workbench. Validate is a real sqlglot check
 * engine-side; execute returns the honest QueryRun (status + a ≤100-row
 * `result_preview` — rendered as "preview", never implied complete).
 */
@Component({
  selector: 'pf-analytics-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, StateBadge, UiSkeleton, TPipe],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" aria-label="loading analytics">
        <ui-skeleton kind="card" [lines]="3" />
      </div>
    } @else {
      <section class="card">
        <h2>{{ 'pf.analytics.dataSources' | t }}</h2>
        <form class="dsform" (submit)="createSource($event)">
          <input
            class="input"
            [value]="dsName()"
            (input)="dsName.set($any($event.target).value)"
            placeholder="Source name"
            required
            aria-label="Source name"
          />
          <select
            class="select"
            [value]="dsConnector()"
            (change)="dsConnector.set($any($event.target).value)"
            aria-label="Connector"
          >
            @for (c of connectors; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
          <input
            class="input"
            [value]="dsLocator()"
            (input)="dsLocator.set($any($event.target).value)"
            placeholder="Locator — path or host (never credentials)"
            aria-label="Locator"
          />
          <input
            class="input"
            [value]="dsAllowlist()"
            (input)="dsAllowlist.set($any($event.target).value)"
            placeholder="Catalog allowlist — comma-separated tables (optional)"
            aria-label="Catalog allowlist"
          />
          <button class="btn btn--primary" type="submit" [disabled]="busy() || !dsName().trim()">
            Register source
          </button>
        </form>

        @if (sources().length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'pf.analytics.name' | t }}</th>
                <th scope="col">{{ 'pf.analytics.connector' | t }}</th>
                <th scope="col">{{ 'pf.analytics.status' | t }}</th>
                <th scope="col">{{ 'pf.analytics.lastVerified' | t }}</th>
                <th scope="col">
                  <span class="sr-only">{{ 'pf.analytics.actions' | t }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (s of sources(); track s.id) {
                <tr [attr.data-selected]="schemaFor() === s.id || null">
                  <td>
                    <strong>{{ s.name }}</strong>
                    <code class="muted small"> {{ s.id }}</code>
                    @if (s.locator) {
                      <p class="muted small">{{ s.locator }}</p>
                    }
                  </td>
                  <td>
                    <span class="chip">{{ s.connector ?? '—' }}</span>
                    <span class="muted small">{{ s.dialect ?? 'sql' }}</span>
                  </td>
                  <td>
                    <ui-state-badge
                      [state]="sourceBadge(s.status)"
                      [labelOverride]="s.status ?? 'unverified'"
                    />
                  </td>
                  <td class="muted small">{{ s.last_verified_at ?? 'never' }}</td>
                  <td class="acts">
                    <button
                      class="btn btn--mini"
                      [disabled]="verifyingId() === s.id"
                      (click)="verify(s)"
                    >
                      {{ verifyingId() === s.id ? 'Verifying…' : 'Verify' }}
                    </button>
                    <button class="btn btn--mini" (click)="loadSchema(s)">
                      {{ schemaFor() === s.id ? 'Hide schema' : 'Schema' }}
                    </button>
                  </td>
                </tr>
                @if (verifyResults()[s.id]; as vr) {
                  <tr>
                    <td colspan="5">
                      <p class="vnote" [attr.data-bad]="vr.status !== 'healthy' || null">
                        Verify: {{ vr.status }}
                        @if (vr.error) {
                          — {{ vr.error }}
                        }
                      </p>
                    </td>
                  </tr>
                }
                @if (schemaFor() === s.id) {
                  <tr>
                    <td colspan="5">
                      @if (schemaLoading()) {
                        <ui-skeleton kind="text" [lines]="3" />
                      } @else if (schema(); as sc) {
                        @if (sc.tables?.length) {
                          <div class="stree">
                            @for (t of sc.tables!; track t.name) {
                              <div class="stree__t">
                                <strong>{{ t.name }}</strong>
                                <span class="muted small">
                                  {{ t.columns?.length ?? 0 }} column(s)</span
                                >
                                @if (t.columns?.length) {
                                  <ul>
                                    @for (c of t.columns!; track colName(c)) {
                                      <li>
                                        <code>{{ colName(c) }}</code>
                                        @if (colType(c)) {
                                          <span class="muted small">{{ colType(c) }}</span>
                                        }
                                      </li>
                                    }
                                  </ul>
                                }
                              </div>
                            }
                          </div>
                          <p class="muted small">engine: {{ sc.engine ?? '—' }}</p>
                        } @else {
                          <ui-empty icon="inbox" title="Schema returned no tables" />
                        }
                      } @else {
                        <ui-empty icon="inbox" title="Schema unavailable" />
                      }
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        } @else {
          <ui-empty icon="pulse" title="No data sources registered" />
        }
      </section>

      <section class="card">
        <h2>
          {{ 'pf.analytics.sqlWorkbench' | t
          }}<span class="muted small">{{ 'pf.analytics.readOnlyEngineValidated' | t }}</span>
        </h2>
        <form class="stack" (submit)="runQuery($event, 'validate')">
          <textarea
            class="textarea mono"
            rows="6"
            [value]="sql()"
            (input)="sql.set($any($event.target).value)"
            placeholder="SELECT …  (writes and multi-statements are rejected engine-side)"
            aria-label="SQL statement"
          ></textarea>
          <div class="fg-row" data-wrap>
            <select
              class="select exec-src"
              [value]="execSource()"
              (change)="execSource.set($any($event.target).value)"
              aria-label="Execute against data source"
            >
              <option value="" disabled>{{ 'pf.analytics.sourceForExecution' | t }}</option>
              @for (s of sources(); track s.id) {
                <option [value]="s.id">{{ s.name }} ({{ s.connector ?? '?' }})</option>
              }
            </select>
            <button class="btn" type="submit" [disabled]="qbusy() || !sql().trim()">
              {{ qbusy() === 'validate' ? 'Validating…' : 'Validate' }}
            </button>
            <button
              class="btn btn--primary"
              type="button"
              [disabled]="qbusy() || !sql().trim() || !execSource()"
              (click)="runQuery($event, 'execute')"
            >
              {{ qbusy() === 'execute' ? 'Executing…' : 'Execute' }}
            </button>
          </div>
        </form>

        @if (validation(); as v) {
          <div class="panel fg-enter" [attr.data-ok]="v.ok || null" aria-live="polite">
            <div class="fg-row">
              <ui-state-badge
                [state]="v.ok ? 'ok' : 'error'"
                [labelOverride]="v.ok ? 'valid read-only statement' : 'rejected'"
              />
              <span class="muted small">
                {{ v.kind ?? '—' }} · engine {{ v.engine ?? '—' }}
                @if (v.tables?.length) {
                  · tables: {{ v.tables!.join(', ') }}
                }
              </span>
            </div>
            @if (v.errors?.length) {
              <ul class="verrs">
                @for (err of v.errors!; track err) {
                  <li>{{ err }}</li>
                }
              </ul>
            }
          </div>
        }

        @if (run(); as r) {
          <div class="panel fg-enter" aria-live="polite">
            <div class="fg-row" data-wrap>
              <ui-state-badge [state]="runBadge(r.status)" [labelOverride]="r.status" />
              <span class="muted small">
                {{ r.rows ?? 0 }} row(s)
                @if (r.duration_ms !== undefined) {
                  · {{ r.duration_ms }}ms
                }
                @if (r.truncated) {
                  · truncated at row limit
                }
                @if (r.masked_columns?.length) {
                  · masked: {{ r.masked_columns!.join(', ') }}
                }
              </span>
              <code class="muted small">{{ r.id }}</code>
            </div>
            @if (r.error) {
              <p class="qerr">{{ r.error }}</p>
            }
            @if (r.columns?.length && r.result_preview?.length) {
              <p class="muted small">
                Preview — first {{ r.result_preview!.length }} of {{ r.rows ?? '?' }} row(s):
              </p>
              <div class="rwrap">
                <table class="table">
                  <thead>
                    <tr>
                      @for (c of r.columns!; track c) {
                        <th scope="col">{{ c }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of r.result_preview!; track $index) {
                      <tr>
                        @for (cell of row; track $index) {
                          <td>{{ cell }}</td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else if (r.status === 'completed') {
              <p class="muted small">{{ 'pf.analytics.queryCompletedWith0Rows' | t }}</p>
            }
          </div>
        }
      </section>

      <section class="card">
        <h2>
          {{ 'pf.analytics.askInPlainLanguage' | t
          }}<span class="muted small">{{ 'pf.analytics.semanticMetricsFirst' | t }}</span>
        </h2>
        <form class="fg-row nlform" (submit)="askNl($event)">
          <input
            class="input"
            [value]="nlQuestion()"
            (input)="nlQuestion.set($any($event.target).value)"
            placeholder="e.g. total revenue by region"
            aria-label="Natural language question"
          />
          <select
            class="select"
            [value]="nlSource()"
            (change)="nlSource.set($any($event.target).value)"
            aria-label="Data source for NL query"
          >
            @for (s of sources(); track s.id) {
              <option [value]="s.id">{{ s.name }}</option>
            }
          </select>
          <button
            class="btn btn--primary"
            type="submit"
            [disabled]="nlBusy() || !nlQuestion().trim()"
          >
            {{ nlBusy() ? 'Resolving…' : 'Ask' }}
          </button>
        </form>
        @if (nlResult(); as nl) {
          <div class="panel fg-enter" [attr.data-ok]="nl.ok || null" aria-live="polite">
            <div class="fg-row" data-wrap>
              <ui-state-badge
                [state]="nl.ok ? 'ok' : 'warn'"
                [labelOverride]="
                  nl.ok ? (nl.via ?? 'resolved') : (nl.reason ?? 'needs clarification')
                "
              />
              @if (nl.metric) {
                <span class="muted small">catalog metric: {{ nl.metric.name }}</span>
              }
            </div>
            @if (nl.sql) {
              <pre class="sqlout">{{ nl.sql }}</pre>
              <button class="btn btn--mini" (click)="loadIntoWorkbench(nl.sql!)">
                Load into workbench
              </button>
            }
          </div>
        }
      </section>

      <section class="card">
        <h2>
          {{ 'pf.analytics.metricsCatalog' | t
          }}<span class="muted small">{{ 'pf.analytics.kpisAsDataNotGuesses' | t }}</span>
        </h2>
        <form class="fg-row metricform" (submit)="createMetric($event)">
          <input
            class="input"
            [value]="mName()"
            (input)="mName.set($any($event.target).value)"
            placeholder="Metric name"
            required
            aria-label="Metric name"
          />
          <input
            class="input"
            [value]="mFormula()"
            (input)="mFormula.set($any($event.target).value)"
            placeholder="Formula — e.g. SUM(revenue)"
            required
            aria-label="Metric formula"
          />
          <input
            class="input"
            [value]="mDims()"
            (input)="mDims.set($any($event.target).value)"
            placeholder="Dimensions — comma-separated (optional)"
            aria-label="Metric dimensions"
          />
          <select
            class="select"
            [value]="mSource()"
            (change)="mSource.set($any($event.target).value)"
            aria-label="Metric data source"
          >
            <option value="">{{ 'pf.analytics.noSourceBinding' | t }}</option>
            @for (s of sources(); track s.id) {
              <option [value]="s.id">{{ s.name }}</option>
            }
          </select>
          <button class="btn" type="submit" [disabled]="!mName().trim() || !mFormula().trim()">
            Add metric
          </button>
        </form>
        @if (metrics().length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'pf.analytics.name' | t }}</th>
                <th scope="col">{{ 'pf.analytics.formula' | t }}</th>
                <th scope="col">{{ 'pf.analytics.dimensions' | t }}</th>
                <th scope="col">{{ 'pf.analytics.source' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (m of metrics(); track m.id) {
                <tr>
                  <td>
                    <strong>{{ m.name }}</strong>
                  </td>
                  <td>
                    <code>{{ m.formula }}</code>
                  </td>
                  <td class="muted small">{{ m.dimensions?.join(', ') || '—' }}</td>
                  <td class="muted small">{{ sourceName(m.source_id) }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <ui-empty
            icon="inbox"
            title="No catalog metrics — NL questions fall back to heuristics"
          />
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
    .dsform {
      display: grid;
      gap: var(--space-2);
      grid-template-columns: 1fr 10rem;
      margin-bottom: var(--space-4);
    }
    .dsform .input,
    .dsform .select {
      width: 100%;
    }
    .dsform .btn {
      grid-column: 1 / -1;
      justify-self: start;
    }
    .acts {
      white-space: nowrap;
    }
    .acts .btn + .btn {
      margin-left: var(--space-1);
    }
    .vnote {
      margin: 0;
      font-size: var(--font-sm);
      color: var(--ok);
    }
    .vnote[data-bad] {
      color: var(--error);
    }
    .stree {
      display: grid;
      gap: var(--space-2);
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      margin-bottom: var(--space-2);
    }
    .stree__t {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-2) var(--space-3);
      background: var(--bg-hover);
    }
    .stree__t ul {
      list-style: none;
      margin: var(--space-1) 0 0;
      padding: 0;
      display: grid;
      gap: 2px;
    }
    .stree__t li {
      display: flex;
      justify-content: space-between;
      gap: var(--space-2);
      font-size: var(--font-xs);
    }
    .stack {
      display: grid;
      gap: var(--space-3);
    }
    .mono {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
    }
    .exec-src {
      max-width: 16rem;
    }
    .panel {
      margin-top: var(--space-4);
      border: 1px solid var(--border);
      border-left: 3px solid var(--border-strong);
      border-radius: var(--radius-md);
      background: var(--bg-hover);
      padding: var(--space-3);
      display: grid;
      gap: var(--space-2);
    }
    .panel[data-ok] {
      border-left-color: var(--ok);
    }
    .verrs {
      margin: 0;
      padding-left: var(--space-4);
      color: var(--error);
      font-size: var(--font-sm);
    }
    .qerr {
      margin: 0;
      color: var(--error);
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
    .nlform,
    .metricform {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin-bottom: var(--space-3);
    }
    .nlform .input {
      flex: 1 1 16rem;
    }
    .metricform .input {
      flex: 1 1 12rem;
    }
    .sqlout {
      margin: 0;
      padding: var(--space-2) var(--space-3);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
      font-size: var(--font-sm);
      white-space: pre-wrap;
      word-break: break-word;
    }
  `,
})
export class PfAnalyticsTab implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly pid = input.required<string>();

  readonly connectors = CONNECTORS;
  readonly sources = signal<PfDataSource[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<ApiError | null>(null);

  readonly dsName = signal('');
  readonly dsConnector = signal('sqlite');
  readonly dsLocator = signal('');
  readonly dsAllowlist = signal('');

  readonly verifyingId = signal<string | null>(null);
  readonly verifyResults = signal<Record<string, PfVerifyResult>>({});
  readonly schemaFor = signal<string | null>(null);
  readonly schema = signal<PfSourceSchema | null>(null);
  readonly schemaLoading = signal(false);

  readonly sql = signal('');
  readonly execSource = signal('');
  readonly qbusy = signal<'' | 'validate' | 'execute'>('');
  readonly validation = signal<PfQueryValidation | null>(null);
  readonly run = signal<PfQueryRun | null>(null);

  readonly metrics = signal<PfMetric[]>([]);
  readonly nlQuestion = signal('');
  readonly nlSource = signal('');
  readonly nlBusy = signal(false);
  readonly nlResult = signal<PfNlQueryResult | null>(null);
  readonly mName = signal('');
  readonly mFormula = signal('');
  readonly mDims = signal('');
  readonly mSource = signal('');

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const ds = await firstValueFrom(this.api.dataSources(this.pid()));
      this.sources.set(ds.items ?? []);
      if (!this.execSource() && ds.items?.length) this.execSource.set(ds.items[0].id);
      if (!this.nlSource() && ds.items?.length) this.nlSource.set(ds.items[0].id);
      this.metrics.set((await firstValueFrom(this.api.metrics(this.pid()))).items ?? []);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  sourceBadge(status: string | undefined): string {
    switch (status) {
      case 'healthy':
        return 'ok';
      case 'degraded':
        return 'warn';
      case 'error':
        return 'error';
      default:
        return 'unverified';
    }
  }

  runBadge(status: string): string {
    if (status === 'completed') return 'ok';
    if (status === 'failed' || status === 'rejected' || status === 'timeout') return 'error';
    if (status === 'cancelled') return 'warn';
    return 'info';
  }

  colName(c: unknown): string {
    if (typeof c === 'string') return c;
    if (c && typeof c === 'object' && 'name' in c) return String((c as { name: unknown }).name);
    return String(c ?? '—');
  }

  colType(c: unknown): string {
    if (c && typeof c === 'object' && 'type' in c) {
      return String((c as { type?: unknown }).type ?? '');
    }
    return '';
  }

  async createSource(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.dsName().trim();
    if (!name || this.busy()) return;
    this.busy.set(true);
    try {
      const allowlist = this.dsAllowlist()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await firstValueFrom(
        this.api.createDataSource(this.pid(), {
          name,
          connector: this.dsConnector(),
          locator: this.dsLocator().trim(),
          catalog_allowlist: allowlist.length ? allowlist : undefined,
        }),
      );
      this.dsName.set('');
      this.dsLocator.set('');
      this.dsAllowlist.set('');
      this.toast.show(`Data source "${name}" registered`, 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async verify(s: PfDataSource): Promise<void> {
    if (this.verifyingId()) return;
    this.verifyingId.set(s.id);
    try {
      const r = await firstValueFrom(this.api.verifyDataSource(this.pid(), s.id));
      this.verifyResults.update((m) => ({ ...m, [s.id]: r }));
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.verifyingId.set(null);
    }
  }

  async loadSchema(s: PfDataSource): Promise<void> {
    if (this.schemaFor() === s.id) {
      this.schemaFor.set(null);
      return;
    }
    this.schemaFor.set(s.id);
    this.schema.set(null);
    this.schemaLoading.set(true);
    try {
      this.schema.set(await firstValueFrom(this.api.dataSourceSchema(this.pid(), s.id)));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.schemaLoading.set(false);
    }
  }

  sourceName(id: string | null | undefined): string {
    if (!id) return '—';
    return this.sources().find((s) => s.id === id)?.name ?? id;
  }

  loadIntoWorkbench(sql: string): void {
    this.sql.set(sql);
  }

  async askNl(ev: Event): Promise<void> {
    ev.preventDefault();
    const q = this.nlQuestion().trim();
    if (!q || this.nlBusy()) return;
    this.nlBusy.set(true);
    this.nlResult.set(null);
    try {
      this.nlResult.set(
        await firstValueFrom(
          this.api.nlQuery(this.pid(), { question: q, source_id: this.nlSource() || undefined }),
        ),
      );
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.nlBusy.set(false);
    }
  }

  async createMetric(ev: Event): Promise<void> {
    ev.preventDefault();
    const name = this.mName().trim();
    const formula = this.mFormula().trim();
    if (!name || !formula) return;
    try {
      const dimensions = this.mDims()
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      await firstValueFrom(
        this.api.createMetric(this.pid(), {
          name,
          formula,
          source_id: this.mSource() || undefined,
          dimensions: dimensions.length ? dimensions : undefined,
        }),
      );
      this.mName.set('');
      this.mFormula.set('');
      this.mDims.set('');
      this.toast.show(`Metric "${name}" added to catalog`, 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  async runQuery(ev: Event, mode: 'validate' | 'execute'): Promise<void> {
    ev.preventDefault();
    const statement = this.sql().trim();
    if (!statement || this.qbusy()) return;
    this.qbusy.set(mode);
    try {
      if (mode === 'validate') {
        this.validation.set(await firstValueFrom(this.api.validateQuery(this.pid(), statement)));
      } else {
        const source_id = this.execSource();
        if (!source_id) return;
        this.run.set(
          await firstValueFrom(this.api.executeQuery(this.pid(), { source_id, statement })),
        );
      }
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.qbusy.set('');
    }
  }
}
