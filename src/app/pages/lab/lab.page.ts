import { Component, computed, inject, signal } from '@angular/core';
import { PortalApi } from '../../core/api/api.client';
import { LabData, LabForgeRow, LabRun, LabScenarioResult } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, stamp } from '../explorer/forges.data';

interface ScenarioRow extends LabScenarioResult {
  forge: string;
  runFile: string;
}

/**
 * Forge Lab (cyc9-10, §9.9) — `GET /lab` rendered verbatim: run history,
 * scenario catalog with per-forge filter, metric table, run-vs-run
 * comparison, JSON/Markdown export. Every row traces to a real receipt
 * emitted by `theforge lab collect`; nothing is synthesized.
 *
 * Honesty contract: `runs: []` renders an explicit "Sem dados" state;
 * adapter unavailable renders UNVERIFIED; metrics with state
 * not_available/not_applicable render '—', never a guessed number.
 */
@Component({
  selector: 'page-lab',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'lab.title' | t" [subtitle]="'lab.subtitle' | t">
      <button class="btn" [disabled]="src.loading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (src.unavailable()) {
      <section class="card unv" data-section="unavailable" role="note">
        <ui-state-badge state="UNVERIFIED" />
        <span class="muted">{{ 'lab.unavailable' | t }}</span>
      </section>
    }

    @if (src.error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (src.loading() && !data()) {
      <section class="card" role="status">
        <ui-skeleton kind="row" [lines]="3" />
      </section>
    }

    @if (data(); as d) {
      <p class="src">
        <code>GET /api/v1/lab</code>
        @if (d.dir) {
          <span> · {{ d.dir }}</span>
        }
        @if (src.loadedAt(); as ts) {
          <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
        }
      </p>

      @if (!d.runs.length) {
        <ui-empty
          icon="pulse"
          [title]="'lab.empty.title' | t"
          [hint]="'lab.empty.subtitle' | t"
          data-section="empty"
        />
      } @else {
        <!-- run selector + comparison -->
        <section class="card" data-section="runs">
          <div class="sec__head">
            <h2><ui-icon name="history" [size]="15" />{{ 'lab.runs' | t }}</h2>
            <div class="row">
              <label
                >{{ 'lab.compare.a' | t }}
                <select [value]="runA()" (change)="runA.set($any($event.target).value)">
                  @for (r of d.runs; track r.file) {
                    <option [value]="r.file">{{ r.file }}</option>
                  }
                </select>
              </label>
              <label
                >{{ 'lab.compare.b' | t }}
                <select [value]="runB()" (change)="runB.set($any($event.target).value)">
                  <option value="">—</option>
                  @for (r of d.runs; track r.file) {
                    <option [value]="r.file">{{ r.file }}</option>
                  }
                </select>
              </label>
            </div>
          </div>
          <table class="tbl">
            <thead>
              <tr>
                <th>{{ 'lab.col.file' | t }}</th>
                <th>{{ 'lab.col.forges' | t }}</th>
                <th>{{ 'lab.col.scenarios' | t }}</th>
                <th>{{ 'lab.col.pass' | t }}</th>
                <th>{{ 'lab.col.fail' | t }}</th>
                <th>{{ 'lab.col.skipped' | t }}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (r of d.runs; track r.file) {
                <tr [class.sel]="r.file === runA()">
                  <td>
                    <code>{{ r.file }}</code>
                  </td>
                  <td>{{ r.forges.length }}</td>
                  <td>{{ countOf(r, null) }}</td>
                  <td class="ok">{{ countOf(r, 'pass') }}</td>
                  <td class="bad">{{ countOf(r, 'fail') }}</td>
                  <td>{{ countOf(r, 'skipped') }}</td>
                  <td>
                    <button class="btn sm" (click)="exportJson(r)">
                      {{ 'lab.export.json' | t }}
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        <!-- forge filter + scenario catalog -->
        <section class="card" data-section="catalog">
          <div class="sec__head">
            <h2><ui-icon name="compass" [size]="15" />{{ 'lab.catalog' | t }}</h2>
            <div class="chips">
              <button class="chip" [class.on]="!forge()" (click)="forge.set('')">
                {{ 'lab.filter.all' | t }}
              </button>
              @for (f of forgeNames(); track f) {
                <button class="chip" [class.on]="forge() === f" (click)="forge.set(f)">
                  {{ f }}
                </button>
              }
            </div>
          </div>
          <table class="tbl" data-table="scenarios">
            <thead>
              <tr>
                <th>{{ 'lab.col.forge' | t }}</th>
                <th>{{ 'lab.col.scenario' | t }}</th>
                <th>{{ 'lab.col.verdict' | t }}</th>
                <th>{{ 'lab.col.duration' | t }}</th>
                <th>{{ 'lab.col.metrics' | t }}</th>
                <th>{{ 'lab.col.detail' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (s of scenarioRows(); track s.forge + '/' + s.scenario_id) {
                <tr>
                  <td>
                    <code>{{ s.forge }}</code>
                  </td>
                  <td>{{ s.scenario_id }}</td>
                  <td><ui-state-badge [state]="badgeFor(s.verdict)" /></td>
                  <td>{{ s.duration_ms != null ? s.duration_ms + 'ms' : '—' }}</td>
                  <td class="metrics">
                    @for (mk of metricKeys(s); track mk) {
                      <span class="metric" [attr.title]="mk">
                        {{ mk }}={{ metricText(s, mk) }}
                      </span>
                    }
                  </td>
                  <td class="muted">{{ s.detail || '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        @if (comparison().length) {
          <section class="card" data-section="compare">
            <div class="sec__head">
              <h2><ui-icon name="graph" [size]="15" />{{ 'lab.compare.title' | t }}</h2>
              <button class="btn sm" (click)="exportComparisonMd()">
                {{ 'lab.export.md' | t }}
              </button>
            </div>
            <table class="tbl">
              <thead>
                <tr>
                  <th>{{ 'lab.col.scenario' | t }}</th>
                  <th>{{ runA() }}</th>
                  <th>{{ runB() }}</th>
                </tr>
              </thead>
              <tbody>
                @for (c of comparison(); track c.id) {
                  <tr>
                    <td>
                      <code>{{ c.forge }}</code> {{ c.id }}
                    </td>
                    <td><ui-state-badge [state]="badgeFor(c.a)" /></td>
                    <td><ui-state-badge [state]="badgeFor(c.b)" /></td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }

        @if (d.reports.length) {
          <section class="card" data-section="reports">
            <div class="sec__head">
              <h2><ui-icon name="tasks" [size]="15" />{{ 'lab.reports' | t }}</h2>
            </div>
            @for (rep of d.reports; track rep.file) {
              <details class="rep">
                <summary>
                  <code>{{ rep.file }}</code>
                  <button
                    class="btn sm"
                    (click)="exportReport(rep.file, rep.content); $event.preventDefault()"
                  >
                    {{ 'lab.export.md' | t }}
                  </button>
                </summary>
                <pre class="rep__body">{{ rep.content }}</pre>
              </details>
            }
          </section>
        }

        @if (d.notes.length) {
          <section class="card" data-section="notes">
            <h2>{{ 'lab.notes' | t }}</h2>
            @for (n of d.notes; track n) {
              <p class="muted">{{ n }}</p>
            }
          </section>
        }
      }
    }
  `,
  styles: `
    .unv {
      display: flex;
      gap: 10px;
      align-items: center;
    }
    .src {
      color: var(--muted, #888);
      font-size: 12px;
    }
    .sec__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .row {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .chip {
      padding: 3px 10px;
      border-radius: 99px;
      border: 1px solid var(--line, #444);
      background: none;
      cursor: pointer;
    }
    .chip.on {
      background: var(--accent, #4f8cff);
      color: #fff;
    }
    .tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .tbl th,
    .tbl td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid var(--line, #333);
    }
    .ok {
      color: var(--ok, #4caf50);
    }
    .bad {
      color: var(--bad, #f44336);
    }
    .sel {
      background: color-mix(in srgb, var(--accent, #4f8cff) 10%, transparent);
    }
    .metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      max-width: 420px;
    }
    .metric {
      font-size: 11px;
      padding: 1px 6px;
      border: 1px solid var(--line, #444);
      border-radius: 4px;
    }
    .rep__body {
      max-height: 340px;
      overflow: auto;
      font-size: 12px;
      white-space: pre-wrap;
    }
    select {
      margin-left: 6px;
    }
    .muted {
      color: var(--muted, #888);
    }
  `,
})
export class LabPage {
  private readonly api = inject(PortalApi);
  readonly src = new Source<LabData>();
  readonly data = computed(() => this.src.data());
  readonly forge = signal('');
  readonly runA = signal('');
  readonly runB = signal('');

  ngOnInit() {
    this.load();
  }

  async load() {
    await this.src.load(() => this.api.lab());
  }

  forgeNames() {
    const d = this.data();
    if (!d) return [] as string[];
    const names = new Set<string>();
    for (const r of d.runs) for (const f of r.forges) if (f.forge) names.add(f.forge);
    return [...names].sort();
  }

  scenarioRows(): ScenarioRow[] {
    const d = this.data();
    const a = run(this, 'a');
    const rows: ScenarioRow[] = [];
    const sel = this.runA() || a;
    for (const r of d?.runs ?? []) {
      if (sel && r.file !== sel) continue;
      for (const f of r.forges) {
        if (this.forge() && f.forge !== this.forge()) continue;
        for (const s of f.results ?? [])
          rows.push({ ...s, forge: f.forge ?? '?', runFile: r.file });
      }
    }
    return rows;
  }

  countOf(r: { forges: LabForgeRow[] }, verdict: string | null) {
    let n = 0;
    for (const f of r.forges)
      for (const s of f.results ?? []) if (verdict === null || s.verdict === verdict) n++;
    return n;
  }

  comparison() {
    const d = this.data();
    const out: { forge: string; id: string; a: string; b: string }[] = [];
    if (!d || !this.runA() || !this.runB() || this.runA() === this.runB()) return out;
    const index = (file: string) => {
      const map = new Map<string, string>();
      const run = d.runs.find((r: LabRun) => r.file === file);
      for (const f of run?.forges ?? [])
        for (const s of f.results ?? []) map.set(`${f.forge}|${s.scenario_id}`, s.verdict);
      return map;
    };
    const a = index(this.runA());
    const b = index(this.runB());
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      const [forge, id] = key.split('|');
      out.push({ forge, id, a: a.get(key) ?? 'absent', b: b.get(key) ?? 'absent' });
    }
    return out.sort((x, y) => x.id.localeCompare(y.id));
  }

  metricKeys(s: LabScenarioResult) {
    return Object.keys(s.metrics ?? {});
  }

  metricText(s: LabScenarioResult, k: string) {
    const m = s.metrics?.[k];
    if (!m || m.state !== 'measured' || m.value === null) return '—';
    return `${m.value}${m.unit && m.unit !== 'ratio' ? m.unit : ''}`;
  }

  badgeFor(verdict: string) {
    if (verdict === 'pass') return 'PASS';
    if (verdict === 'fail') return 'FAIL';
    if (verdict === 'not_applicable') return 'not_applicable';
    return 'SKIPPED';
  }

  exportJson(r: { file: string }) {
    const run = this.data()?.runs.find((x: LabRun) => x.file === r.file);
    if (!run) return;
    this.download(
      r.file.replace(/\.jsonl$/, '.json'),
      JSON.stringify(run, null, 2),
      'application/json',
    );
  }

  exportReport(name: string, content: string) {
    this.download(name, content, 'text/markdown');
  }

  exportComparisonMd() {
    const lines = [
      `# Lab comparison ${this.runA()} vs ${this.runB()}`,
      '',
      '| scenario | A | B |',
      '|---|---|---|',
    ];
    for (const c of this.comparison()) lines.push(`| ${c.forge}/${c.id} | ${c.a} | ${c.b} |`);
    this.download(
      `lab-compare-${this.runA()}-vs-${this.runB()}.md`,
      lines.join('\n') + '\n',
      'text/markdown',
    );
  }

  private download(name: string, content: string, type: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  protected readonly stamp = stamp;
}

function run(self: LabPage, _k: string): string {
  const d = self.data();
  return d?.runs.length ? d.runs[d.runs.length - 1].file : '';
}
