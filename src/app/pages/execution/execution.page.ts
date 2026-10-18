import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PortalApi } from '../../core/api/api.client';
import { PortalEvent, PortalEventReport } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { Source, stamp } from '../explorer/forges.data';
import {
  ExecutionGroup,
  ReplayStep,
  buildExecutions,
  buildReplay,
  causedBy,
  filterEvents,
  fmtAt,
  fmtGap,
  relatedEvents,
  shortId,
  statusKind,
} from './execution.data';

/**
 * Execução — Cycle 3 observability over `forge/PortalEvent/1`
 * (`GET /api/v1/events`). docs/observability/execution-events.md.
 *
 * Honesty contract:
 * - 404 / PORTAL-NOT-FOUND → the adapter did not opt into telemetry;
 *   the capability renders UNVERIFIED, never an empty-looking success.
 * - Executions group ONLY by the real `correlation_id`; events without
 *   one collect in an 'unlinked' bucket — grouping is never invented.
 * - The waterfall draws real producer timestamps; events without one
 *   stay undrawn inside a `partial` marker. Span underlays are DERIVED
 *   (timestamp − recorded duration_ms) and labelled as such.
 * - Replay walks the recorded order at scaled real gaps; gaps beyond
 *   the playback cap show `compressed` — the real delta is always
 *   displayed, never hidden and never simulated.
 * - The inspector shows fields verbatim; relations render only when
 *   the producer sent the ids (correlation/span/parent_span).
 */
@Component({
  selector: 'page-execution',
  standalone: true,
  imports: [RouterLink, TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header
      [title]="'execution.title' | t"
      [subtitle]="'execution.subtitle' | t"
      hintId="evidence"
    >
      <button class="btn" [disabled]="src.loading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    <!-- Scope note — the buffer lives in this portal process only. -->
    <p class="local" data-section="local-only" role="note">
      <ui-icon name="shield-check" [size]="15" />
      <span>{{ 'execution.localOnly' | t }}</span>
    </p>

    <!-- /events absent on this adapter → UNVERIFIED capability. -->
    @if (src.unavailable()) {
      <section class="card unv" data-section="unavailable" role="note">
        <ui-state-badge state="UNVERIFIED" />
        <span class="muted">{{ 'execution.unavailable' | t }}</span>
      </section>
    }

    @if (src.error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (src.loading() && !report()) {
      <section class="card" role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="row" [lines]="3" />
      </section>
    }

    @if (report(); as r) {
      <!-- Summary — the report's own counts; a bounded buffer never
           claims to be the whole history. -->
      <section class="card" data-section="summary" aria-labelledby="ex-sum">
        <div class="sec__head">
          <div>
            <h2 id="ex-sum">{{ 'execution.summary' | t }}</h2>
            <p class="src">
              <code>GET /api/v1/events</code>
              @if (src.loadedAt(); as ts) {
                <span> · {{ 'common.updatedAt' | t: { time: stamp(ts) } }}</span>
              }
            </p>
          </div>
        </div>
        <div class="counts">
          <div class="count" data-count="events">
            <span class="count__value">{{ r.count }}</span>
            <span class="count__key">{{ 'execution.count.events' | t }}</span>
          </div>
          <div class="count" data-count="executions">
            <span class="count__value">{{ executions().groups.length }}</span>
            <span class="count__key">{{ 'execution.count.executions' | t }}</span>
          </div>
          <div class="count" data-count="dropped">
            <span class="count__value">{{ r.dropped }}</span>
            <span class="count__key">{{ 'execution.count.dropped' | t }}</span>
          </div>
          <div class="count" data-count="capacity">
            <span class="count__value">{{ r.capacity }}</span>
            <span class="count__key">{{ 'execution.count.capacity' | t }}</span>
          </div>
        </div>
        @if (r.truncated) {
          <p class="truncated" data-note="truncated" role="note">
            <ui-icon name="alert" [size]="14" />
            <span>{{ 'execution.truncated' | t: { dropped: r.dropped } }}</span>
          </p>
        }
      </section>

      <!-- Waterfall — one row per execution (correlation group). Bars
           cover first→last recorded timestamp; ticks are the placed
           events; span underlays derive from recorded duration only.
           Groups with zero placed events render no bar. -->
      @if (executions().groups.length) {
        <section class="card" data-section="timeline" aria-labelledby="ex-tl">
          <h2 id="ex-tl">
            {{ 'execution.timeline.title' | t }}
            @if (executions().partial) {
              <ui-state-badge state="PARTIAL" />
            }
          </h2>
          <p class="muted">{{ 'execution.timeline.hint' | t }}</p>
          @if (executions().windowStart !== null) {
            <div class="tl" role="list" [attr.aria-label]="'execution.timeline.title' | t">
              <div class="tl__axis" aria-hidden="true">
                <span>{{ fmtMs(executions().windowStart) }}</span>
                <span>{{ fmtMs(executions().windowEnd) }}</span>
              </div>
              @for (g of executions().groups; track g.key || 'unlinked') {
                <button
                  class="tl__row"
                  type="button"
                  role="listitem"
                  [attr.data-execution]="g.correlationId ?? 'unlinked'"
                  [attr.data-selected]="selectedCid() === g.correlationId || null"
                  [attr.data-errors]="g.errorCount || null"
                  [attr.aria-label]="g.correlationId ?? ('execution.unlinked' | t)"
                  (click)="selectExecution(g)"
                >
                  <span class="tl__label" [attr.title]="g.correlationId">
                    @if (g.correlationId) {
                      <code>{{ shortId(g.correlationId) }}</code>
                    } @else {
                      <span class="muted">{{ 'execution.unlinked' | t }}</span>
                    }
                    <span class="tl__n">{{ g.events.length }}</span>
                  </span>
                  <span class="tl__track">
                    @for (s of g.spans; track s.spanId) {
                      <span
                        class="tl__span"
                        [style.left.%]="s.leftPct"
                        [style.width.%]="s.widthPct"
                      ></span>
                    }
                    @for (p of placedIn(g); track p.idx) {
                      <span
                        class="tl__tick"
                        [attr.data-status]="statusKind(p.event.status)"
                        [style.left.%]="tickLeft(g, p)"
                        [title]="p.event.event_type + ' — ' + fmtAt(p.event.timestamp)"
                      ></span>
                    }
                  </span>
                  <span class="tl__dur num">{{
                    g.durationMs === null ? '—' : fmtDur(g.durationMs)
                  }}</span>
                </button>
              }
            </div>
            @if (executions().unplacedCount) {
              <p class="muted tl__unplaced" data-note="unplaced">
                {{ 'execution.timeline.unplaced' | t: { count: executions().unplacedCount } }}
              </p>
            }
          } @else {
            <ui-empty icon="execution" [title]="'execution.timeline.empty' | t" />
          }
        </section>
      }

      <!-- Replay — the selected execution's recorded events, or the
           whole filtered window when nothing is selected. Real order,
           real gaps (scaled); compressed gaps say so. -->
      @if (replaySteps().length) {
        <section class="card" data-section="replay" aria-labelledby="ex-rp">
          <h2 id="ex-rp" class="rp__title">
            <ui-icon name="history" [size]="14" />
            {{ 'execution.replay.title' | t }}
            <span class="muted rp__scope">{{ replayScope() }}</span>
          </h2>
          <p class="muted">{{ 'execution.replay.hint' | t }}</p>
          <div class="rp__controls" data-section="replay-controls">
            <button
              class="btn btn--mini"
              data-action="step-prev"
              [disabled]="replayIdx() <= 0"
              (click)="stepReplay(-1)"
            >
              {{ 'execution.replay.prev' | t }}
            </button>
            @if (playing()) {
              <button class="btn btn--mini" data-action="pause" (click)="pause()">
                {{ 'execution.replay.pause' | t }}
              </button>
            } @else {
              <button
                class="btn btn--mini"
                data-action="play"
                [disabled]="replayIdx() >= replaySteps().length - 1"
                (click)="play()"
              >
                {{ 'execution.replay.play' | t }}
              </button>
            }
            <button
              class="btn btn--mini"
              data-action="step-next"
              [disabled]="replayIdx() >= replaySteps().length - 1"
              (click)="stepReplay(1)"
            >
              {{ 'execution.replay.next' | t }}
            </button>
            <label class="rp__speed">
              <span class="muted">{{ 'execution.replay.speed' | t }}</span>
              <select
                class="select"
                data-control="speed"
                (change)="setSpeed($event)"
                [attr.aria-label]="'execution.replay.speed' | t"
              >
                @for (s of SPEEDS; track s) {
                  <option [value]="s" [selected]="speed() === s">×{{ s }}</option>
                }
              </select>
            </label>
            <span class="muted">
              {{
                'execution.replay.step'
                  | t: { current: replayIdx() + 1, total: replaySteps().length }
              }}
            </span>
          </div>
          <ol class="rp__steps">
            @for (s of replaySteps(); track s.event.idx) {
              <li [attr.data-current]="$index === replayIdx() || null">
                <button
                  class="rp__step"
                  type="button"
                  data-action="inspect"
                  [attr.data-current]="$index === replayIdx() || null"
                  (click)="inspect(s.event.event); replayIdx.set($index)"
                >
                  <span class="rp__gap" [attr.title]="'execution.replay.gap' | t">{{
                    fmtGap(s.gapMs)
                  }}</span>
                  @if (s.compressed) {
                    <span class="rp__compressed" [title]="'execution.replay.compressed' | t"
                      >⇥</span
                    >
                  }
                  <code class="rp__kind">{{ s.event.event.event_type }}</code>
                  <span class="rp__at">{{ fmtAt(s.event.event.timestamp) }}</span>
                  <ui-state-badge
                    [state]="statusKind(s.event.event.status)"
                    [labelOverride]="s.event.event.status ?? '—'"
                  />
                  @if (s.event.event.duration_ms !== undefined) {
                    <span class="num">{{ s.event.event.duration_ms }} ms</span>
                  }
                  @if (s.event.event.source || s.event.event.target) {
                    <span class="rp__flow"
                      >{{ s.event.event.source ?? '—' }} → {{ s.event.event.target ?? '—' }}</span
                    >
                  }
                  @if (!s.event.event.timestamp || !timeParseable(s.event.event.timestamp)) {
                    <span class="rp__unplaced muted">{{ 'execution.noTimestamp' | t }}</span>
                  }
                </button>
              </li>
            }
          </ol>
        </section>
      }

      <!-- Events — the recorded window, filtered client-side over real
           fields only. Row click opens the inspector. -->
      <section class="card" data-section="events" aria-labelledby="ex-ev">
        <div class="sec__head">
          <div>
            <h2 id="ex-ev">{{ 'execution.events' | t }}</h2>
          </div>
        </div>

        @if (events().length) {
          <div class="filters" data-section="filters">
            <label class="filter">
              <span class="filter__lbl">{{ 'execution.filter.type' | t }}</span>
              <select class="select" data-filter="type" (change)="setType($event)">
                <option value="" [selected]="typeFilter() === null">{{ 'state.all' | t }}</option>
                @for (k of typeOptions(); track k) {
                  <option [value]="k" [selected]="typeFilter() === k">{{ k }}</option>
                }
              </select>
            </label>
            <label class="filter">
              <span class="filter__lbl">{{ 'execution.filter.status' | t }}</span>
              <select class="select" data-filter="status" (change)="setStatus($event)">
                <option value="" [selected]="statusFilter() === null">{{ 'state.all' | t }}</option>
                @for (s of statusOptions(); track s) {
                  <option [value]="s" [selected]="statusFilter() === s">{{ s }}</option>
                }
              </select>
            </label>
            <label class="filter">
              <span class="filter__lbl">{{ 'execution.filter.corr' | t }}</span>
              <input
                class="input"
                type="search"
                data-filter="correlation"
                [value]="corrFilter()"
                (input)="setCorr($event)"
                [attr.aria-label]="'execution.filter.corr' | t"
              />
            </label>
            <label class="filter">
              <span class="filter__lbl">{{ 'execution.filter.search' | t }}</span>
              <input
                class="input"
                type="search"
                data-filter="search"
                [value]="qFilter()"
                (input)="setQuery($event)"
                [attr.aria-label]="'execution.filter.search' | t"
              />
            </label>
          </div>
        }

        @if (filteredEvents().length) {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th scope="col">{{ 'execution.col.type' | t }}</th>
                  <th scope="col">{{ 'execution.col.at' | t }}</th>
                  <th scope="col">{{ 'execution.col.status' | t }}</th>
                  <th scope="col">{{ 'execution.col.flow' | t }}</th>
                  <th scope="col">{{ 'execution.col.duration' | t }}</th>
                  <th scope="col">{{ 'execution.col.correlation' | t }}</th>
                </tr>
              </thead>
              <tbody>
                @for (e of filteredEvents(); track e.event_id ?? $index) {
                  <tr
                    data-action="inspect"
                    [attr.data-selected]="inspected() === e || null"
                    (click)="inspect(e)"
                  >
                    <td>
                      <code>{{ e.event_type }}</code>
                    </td>
                    <td class="num">{{ fmtAt(e.timestamp) }}</td>
                    <td>
                      <ui-state-badge
                        [state]="statusKind(e.status)"
                        [labelOverride]="e.status ?? '—'"
                      />
                    </td>
                    <td class="flow">
                      @if (e.source || e.target) {
                        {{ e.source ?? '—' }} → {{ e.target ?? '—' }}
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td class="num">
                      @if (e.duration_ms !== undefined) {
                        {{ e.duration_ms }} ms
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td>
                      @if (e.correlation_id; as cid) {
                        <code class="corr" [attr.title]="cid">{{ shortId(cid) }}</code>
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          @if (events().length) {
            <ui-empty icon="search" data-empty="no-matches" [title]="'execution.noMatches' | t" />
          } @else {
            <ui-empty
              icon="inbox"
              data-empty="events"
              [title]="'execution.empty' | t"
              [hint]="'execution.empty.hint' | t"
            />
          }
        }
      </section>

      <!-- Inspector — every recorded field verbatim + observed links. -->
      @if (inspected(); as e) {
        <section class="card detail fg-enter" data-section="inspector" aria-live="polite">
          <header class="detail__head">
            <h2>
              <ui-icon name="execution" [size]="15" /><code>{{ e.event_type }}</code>
              @if (e.event_id) {
                <span class="muted detail__id">{{ e.event_id }}</span>
              }
            </h2>
            <button
              class="icon-btn"
              (click)="inspected.set(null)"
              [attr.aria-label]="'state.close' | t"
            >
              <ui-icon name="chevron-right" [size]="14" />
            </button>
          </header>
          <dl class="plan-card">
            <div class="kv">
              <dt>{{ 'execution.insp.schema' | t }}</dt>
              <dd>
                <code>{{ e.schema }}</code>
              </dd>
            </div>
            <div class="kv">
              <dt>{{ 'execution.insp.at' | t }}</dt>
              <dd>{{ fmtAt(e.timestamp) }}</dd>
            </div>
            <div class="kv">
              <dt>{{ 'execution.insp.status' | t }}</dt>
              <dd>
                <ui-state-badge [state]="statusKind(e.status)" [labelOverride]="e.status ?? '—'" />
              </dd>
            </div>
            <div class="kv">
              <dt>{{ 'execution.insp.duration' | t }}</dt>
              <dd class="num">{{ e.duration_ms !== undefined ? e.duration_ms + ' ms' : '—' }}</dd>
            </div>
            <div class="kv">
              <dt>{{ 'execution.insp.correlation' | t }}</dt>
              <dd class="corr" [attr.title]="e.correlation_id ?? null">
                <code>{{ e.correlation_id ?? '—' }}</code>
              </dd>
            </div>
            <div class="kv">
              <dt>{{ 'execution.insp.span' | t }}</dt>
              <dd>
                <code>{{ e.span_id ?? '—' }}</code>
              </dd>
            </div>
            <div class="kv">
              <dt>{{ 'execution.insp.parent' | t }}</dt>
              <dd>
                <code>{{ e.parent_span_id ?? '—' }}</code>
              </dd>
            </div>
            <div class="kv">
              <dt>{{ 'execution.insp.trace' | t }}</dt>
              <dd>
                <code>{{ e.trace_id ?? '—' }}</code>
              </dd>
            </div>
            <div class="kv">
              <dt>{{ 'execution.insp.source' | t }}</dt>
              <dd>
                <code>{{ e.source ?? '—' }}</code>
              </dd>
            </div>
            <div class="kv">
              <dt>{{ 'execution.insp.target' | t }}</dt>
              <dd>
                <code>{{ e.target ?? '—' }}</code>
              </dd>
            </div>
            @if (taskIdOf(e); as tid) {
              <div class="kv">
                <dt>{{ 'execution.insp.task' | t }}</dt>
                <dd>
                  <a
                    class="linklike"
                    data-action="task"
                    [routerLink]="['/tasks']"
                    [queryParams]="{ task: tid }"
                  >
                    {{ tid }}
                  </a>
                </dd>
              </div>
            }
          </dl>

          @if (causedByOf(e); as parent) {
            <p class="muted cause" data-note="caused-by">
              {{ 'execution.insp.causedBy' | t }}
              <button class="linklike" data-action="parent" (click)="inspect(parent)">
                <code>{{ parent.event_type }}</code>
              </button>
            </p>
          }

          @if (e.metadata) {
            <details class="raw" open>
              <summary>{{ 'execution.insp.metadata' | t }}</summary>
              <pre>{{ json(e.metadata) }}</pre>
            </details>
          }
          @if (e.evidence) {
            <details class="raw" open>
              <summary>{{ 'execution.insp.evidence' | t }}</summary>
              <pre>{{ json(e.evidence) }}</pre>
            </details>
          }

          @if (related(e).length) {
            <div class="related" data-section="related">
              <h3>{{ 'execution.insp.related' | t }}</h3>
              <ul>
                @for (x of related(e); track x.event_id ?? $index) {
                  <li>
                    <button class="linklike" data-action="related" (click)="inspect(x)">
                      <code>{{ x.event_type }}</code>
                    </button>
                    <span class="muted">{{ fmtAt(x.timestamp) }}</span>
                  </li>
                }
              </ul>
            </div>
          }
        </section>
      }
    }
  `,
  styles: `
    .src,
    .count__key,
    .tl__axis,
    .tl__n,
    .tl__dur,
    .tl__unplaced,
    .filter__lbl,
    .kv dt,
    .local,
    .truncated,
    .corr,
    .flow,
    .detail__id {
      color: var(--fg-muted);
    }
    .src,
    .count__key,
    .tl__axis,
    .tl__n,
    .tl__dur,
    .tl__unplaced,
    .corr,
    .flow,
    .filter__lbl,
    .kv dt,
    .detail__id {
      font-size: var(--font-xs);
    }
    .filter__lbl,
    .kv dt {
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .local {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-4);
      padding: var(--space-3);
      border: 1px dashed var(--border);
      border-radius: var(--radius-md);
      font-size: var(--font-sm);
    }
    .local ui-icon,
    .truncated ui-icon {
      flex: none;
    }
    .card {
      margin-bottom: var(--space-4);
    }
    .sec__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .sec__head h2,
    #ex-tl,
    .detail__head h2 {
      margin: 0;
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .src {
      margin: 4px 0 0;
    }
    .unv,
    .truncated {
      display: flex;
      align-items: center;
      border: 1px dashed color-mix(in srgb, var(--warn) 55%, transparent);
      background: var(--warn-bg);
      font-size: var(--font-sm);
    }
    .unv {
      gap: var(--space-3);
    }
    .counts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: var(--space-3);
    }
    .count {
      display: grid;
      gap: 2px;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: color-mix(in srgb, var(--bg-hover) 40%, transparent);
    }
    .count__value {
      font-family: var(--font-mono);
      font-size: var(--font-2xl);
      font-weight: 650;
    }
    .truncated {
      gap: var(--space-2);
      margin: var(--space-3) 0 0;
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
    }
    .truncated ui-icon {
      color: var(--warn);
    }
    .tl {
      display: grid;
      gap: 4px;
      margin-top: var(--space-3);
    }
    .tl__axis {
      display: flex;
      justify-content: space-between;
      margin-left: 12rem;
      font-variant-numeric: tabular-nums;
    }
    .tl__row {
      display: grid;
      grid-template-columns: 12rem 1fr 5.5rem;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      border: 1px solid transparent;
      border-radius: var(--radius-md);
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      padding: 3px var(--space-2);
      cursor: pointer;
      transition:
        background var(--motion-fast),
        border-color var(--motion-fast);
    }
    .tl__row:hover {
      background: var(--bg-hover);
    }
    .tl__row[data-selected] {
      border-color: var(--accent-ink);
      background: var(--accent-bg);
    }
    .tl__label {
      font-size: var(--font-sm);
      font-weight: 550;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
    }
    .tl__track {
      position: relative;
      height: 16px;
      border-radius: var(--radius-pill);
      background: var(--bg);
      border: 1px solid var(--border);
      overflow: hidden;
    }
    .tl__span,
    .tl__tick {
      position: absolute;
      top: 0;
      bottom: 0;
    }
    .tl__span {
      background: color-mix(in srgb, var(--info) 28%, transparent);
      border-radius: var(--radius-pill);
    }
    .tl__tick {
      width: 3px;
      background: var(--tick, var(--fg-muted));
    }
    .tl__tick[data-status='supported'] {
      --tick: var(--ok);
    }
    .tl__tick[data-status='error'] {
      --tick: var(--error);
    }
    .tl__tick[data-status='warn'] {
      --tick: var(--warn);
    }
    .tl__tick[data-status='info'] {
      --tick: var(--info);
    }
    .tl__dur {
      text-align: right;
    }
    .tl__unplaced {
      margin: var(--space-2) 0 0;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .filter {
      display: grid;
      gap: 4px;
      min-width: 150px;
    }
    .filter .input {
      min-width: 190px;
    }
    .table-wrap {
      overflow-x: auto;
    }
    .table {
      min-width: 840px;
    }
    .table tbody tr {
      cursor: pointer;
    }
    .detail {
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
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .kv dd {
      margin: 0;
      font-weight: 550;
      word-break: break-all;
    }
    .cause {
      margin: var(--space-2) 0 var(--space-3);
      font-size: var(--font-sm);
    }
    .related {
      margin-top: var(--space-3);
      border-top: 1px solid var(--border);
      padding-top: var(--space-3);
    }
    .related h3 {
      margin: 0 0 var(--space-2);
      font-size: var(--font-md);
    }
    .related ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 4px;
    }
    .related li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    @media (max-width: 720px) {
      .tl__axis {
        margin-left: 0;
      }
      .tl__row {
        grid-template-columns: 1fr;
        gap: 2px;
      }
      .tl__dur {
        text-align: left;
      }
    }
  `,
})
export class ExecutionPage {
  private readonly api = inject(PortalApi);
  private readonly destroyRef = inject(DestroyRef);

  /** Route `?cid=` / `?q=` deep links — a correlation id selects its
   *  execution; `q` seeds the free-text filter. Applied once per value
   *  so closing a detail is never undone by a refresh. */
  readonly cid = input('');
  readonly q = input('');

  readonly src = new Source<PortalEventReport>();
  readonly report = computed(() => this.src.data());

  readonly typeFilter = signal<string | null>(null);
  readonly statusFilter = signal<string | null>(null);
  readonly corrFilter = signal('');
  readonly qFilter = signal('');

  readonly selectedCid = signal<string | null | undefined>(undefined);
  readonly inspected = signal<PortalEvent | null>(null);

  readonly replayIdx = signal(0);
  readonly playing = signal(false);
  readonly speed = signal(1);
  readonly SPEEDS = [1, 4, 16, 64] as const;

  private replayTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly deepApplied = signal<string | null>(null);

  /** The report's own event list — the whole recorded window. */
  readonly events = computed(() => this.report()?.events ?? []);

  readonly typeOptions = computed(() =>
    [...new Set(this.events().map((e) => e.event_type))].sort((a, b) => a.localeCompare(b)),
  );
  readonly statusOptions = computed(() =>
    [
      ...new Set(
        this.events()
          .map((e) => e.status)
          .filter((s): s is string => !!s),
      ),
    ].sort((a, b) => a.localeCompare(b)),
  );

  readonly filteredEvents = computed(() =>
    filterEvents(this.events(), {
      type: this.typeFilter(),
      status: this.statusFilter(),
      correlation: this.corrFilter(),
      q: this.qFilter(),
    }),
  );

  /** Waterfall over the filtered window — filters narrow what is drawn;
   *  they never add history. */
  readonly executions = computed(() => buildExecutions(this.filteredEvents()));

  readonly selectedGroup = computed<ExecutionGroup | null>(() => {
    const cid = this.selectedCid();
    if (cid === undefined) return null;
    return this.executions().groups.find((g) => g.correlationId === cid) ?? null;
  });

  /** Replay walks the selected execution, or the filtered window when
   *  nothing is selected — always recorded events, never simulated. */
  readonly replaySteps = computed<ReplayStep[]>(() =>
    buildReplay(this.selectedGroup()?.events.map((p) => p.event) ?? this.filteredEvents()),
  );

  readonly replayScope = computed(() => {
    const cid = this.selectedCid();
    if (cid === undefined) return '';
    return cid ?? 'unlinked';
  });

  readonly stamp = stamp;
  readonly fmtAt = fmtAt;
  readonly fmtGap = fmtGap;
  readonly shortId = shortId;
  readonly statusKind = statusKind;

  constructor() {
    // Deep link: once data answers, a new ?cid= selects its execution.
    effect(() => {
      const id = this.cid();
      if (!id || id === this.deepApplied() || !this.report()) return;
      this.deepApplied.set(id);
      this.corrFilter.set(id);
      this.selectedCid.set(id);
    });
    effect(() => {
      const q = this.q();
      if (q) this.qFilter.set(q);
    });
    // Any data/filter change re-derives the step list — reset position
    // and stop a playback that would otherwise walk stale steps.
    effect(() => {
      this.replaySteps();
      this.replayIdx.set(0);
      this.pause();
    });
    this.destroyRef.onDestroy(() => this.clearTimer());
    void this.load();
  }

  async load(): Promise<void> {
    await this.src.load(() => this.api.events());
  }

  selectExecution(g: ExecutionGroup): void {
    const next = this.selectedCid() === g.correlationId ? undefined : g.correlationId;
    this.selectedCid.set(next);
    this.replayIdx.set(0);
  }

  inspect(e: PortalEvent): void {
    this.inspected.set(e);
  }

  placedIn(g: ExecutionGroup) {
    return g.events.filter((p) => p.timeMs !== null);
  }

  /** Tick position inside the group's own bar — derived from the
   *  recorded window only; returns the bar start when the group has a
   *  single point in time. */
  tickLeft(g: ExecutionGroup, p: { timeMs: number | null }): number {
    if (g.startMs === null || g.endMs === null || g.endMs === g.startMs || p.timeMs === null)
      return 0;
    return ((p.timeMs - g.startMs) / (g.endMs - g.startMs)) * 100;
  }

  fmtMs(ms: number | null): string {
    return ms === null ? '—' : new Date(ms).toLocaleString();
  }

  fmtDur(ms: number): string {
    return ms < 1000 ? `${ms} ms` : `${Number((ms / 1000).toFixed(1))} s`;
  }

  timeParseable(iso: string | undefined): boolean {
    return !!iso && Number.isFinite(Date.parse(iso));
  }

  json(v: unknown): string {
    return JSON.stringify(v, null, 2);
  }

  related(e: PortalEvent): PortalEvent[] {
    return relatedEvents(e, this.events());
  }

  causedByOf(e: PortalEvent): PortalEvent | null {
    return causedBy(e, this.events());
  }

  /** The task id an event really names — `metadata.task_id` only. */
  taskIdOf(e: PortalEvent): string | null {
    const v = e.metadata?.['task_id'];
    return typeof v === 'string' && v ? v : null;
  }

  setType(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.typeFilter.set(v === '' ? null : v);
  }
  setStatus(e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    this.statusFilter.set(v === '' ? null : v);
  }
  setCorr(e: Event): void {
    this.corrFilter.set((e.target as HTMLInputElement).value);
  }
  setQuery(e: Event): void {
    this.qFilter.set((e.target as HTMLInputElement).value);
  }
  setSpeed(e: Event): void {
    const v = Number((e.target as HTMLSelectElement).value);
    this.speed.set(this.SPEEDS.includes(v as (typeof this.SPEEDS)[number]) ? v : 1);
  }

  // -- replay transport ---------------------------------------------
  play(): void {
    if (this.playing() || this.replayIdx() >= this.replaySteps().length - 1) return;
    this.playing.set(true);
    this.scheduleNext();
  }

  pause(): void {
    this.playing.set(false);
    this.clearTimer();
  }

  stepReplay(delta: number): void {
    this.pause();
    const next = this.replayIdx() + delta;
    const last = this.replaySteps().length - 1;
    this.replayIdx.set(Math.max(0, Math.min(next, last)));
  }

  /** Wait the step's REAL inter-event gap ÷ speed (capped at the
   *  declared playback cap — `compressed` steps display that). */
  private scheduleNext(): void {
    this.clearTimer();
    if (!this.playing()) return;
    const next = this.replayIdx() + 1;
    const steps = this.replaySteps();
    if (next >= steps.length) {
      this.playing.set(false);
      return;
    }
    const wait = steps[next].waitMs / this.speed();
    this.replayTimer = setTimeout(
      () => {
        this.replayTimer = null;
        this.replayIdx.set(next);
        this.scheduleNext();
      },
      Math.min(wait, 8000),
    );
  }

  private clearTimer(): void {
    if (this.replayTimer) {
      clearTimeout(this.replayTimer);
      this.replayTimer = null;
    }
  }
}
