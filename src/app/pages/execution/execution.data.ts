import { PortalEvent } from '../../core/api/api.models';
import { fmtDurationMs } from '../tasks/tasks.data';

/**
 * Cycle 3 — execution observability over `forge/PortalEvent/1`.
 * Same honesty contract as tasks.data.ts:
 *
 * - Ordering: producer `timestamp` is real recorded time — parsed when
 *   present, never inferred. Events without a parseable timestamp keep
 *   their backend order and land in `unplaced`, which marks the group
 *   `partial` — undrawn history is surfaced, never silently dropped.
 * - Windows/spans are DERIVED only from recorded fields (timestamp ±
 *   duration_ms, shared span_id) and labelled as such — no stage is
 *   reconstructed from a conceptual model.
 * - Relations (correlation_id, span_id, parent_span_id, source→target)
 *   are rendered only when the producer actually sent them — missing
 *   fields mean 'no observed relation', never a guess.
 */

/** Parse an ISO timestamp → epoch ms, or null when absent/broken. */
export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Diacritic-insensitive lowercase for free-text filters. */
export const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

// ------------------------------------------------------------------
// event placement
// ------------------------------------------------------------------

export interface PlacedEvent {
  event: PortalEvent;
  /** Backend order — the deterministic tiebreak; never invented. */
  idx: number;
  /** Producer timestamp as epoch ms, null when absent/unparsable. */
  timeMs: number | null;
}

/** Split the recorded window into placed/unplaced, stable-ordered:
 *  placed events ascend by real timestamp (backend order breaks ties),
 *  unplaced keep backend order — the same rule the tasks replay uses. */
export function placeEvents(events: readonly PortalEvent[]): {
  placed: PlacedEvent[];
  unplaced: PlacedEvent[];
} {
  const tagged = events.map((event, idx) => ({
    event,
    idx,
    timeMs: parseTime(event.timestamp),
  }));
  const placed = tagged
    .filter((e) => e.timeMs !== null)
    .sort((a, b) => a.timeMs! - b.timeMs! || a.idx - b.idx);
  const unplaced = tagged.filter((e) => e.timeMs === null);
  return { placed, unplaced };
}

// ------------------------------------------------------------------
// executions — the correlation grouping
// ------------------------------------------------------------------

export interface ExecutionGroup {
  /** Display key — the real correlation id, or '' for the unlinked bucket. */
  key: string;
  correlationId: string | null;
  /** Ordered events — placed first, unplaced trailing (real order kept). */
  events: PlacedEvent[];
  /** Events with a parseable timestamp — the drawn subset of `events`. */
  placed: PlacedEvent[];
  unplaced: PlacedEvent[];
  /** First/last recorded timestamps — null when nothing was placeable. */
  startMs: number | null;
  endMs: number | null;
  /** Derived span: endMs - startMs (only when both ends are real). */
  durationMs: number | null;
  /** Events whose status reads as an error — counted, never invented. */
  errorCount: number;
  /** Observed spans: end-event `timestamp` − its recorded `duration_ms`
   *  → [start, end] both derived from producer values only. */
  spans: ExecSpan[];
  /** Waterfall position — filled by `buildExecutions`. */
  leftPct: number;
  widthPct: number;
  /** Every placed event as one CSS background layer on the track — the
   *  same position/tone data the old per-tick spans drew, at zero DOM
   *  cost per event. '' when nothing is placed. */
  tickGradient: string;
  /** True when the group holds undrawn (timestamp-less) events. */
  partial: boolean;
}

export interface ExecSpan {
  spanId: string;
  startMs: number;
  endMs: number;
  leftPct: number;
  widthPct: number;
}

const ERROR_STATUSES = new Set(['refused', 'failed', 'timeout', 'error', 'denied']);

function isErr(e: PortalEvent): boolean {
  return ERROR_STATUSES.has((e.status ?? '').toLowerCase());
}

/**
 * Group the recorded window into executions. The ONLY grouping key is
 * the real `correlation_id`; events that carry none fall into one
 * 'unlinked' bucket (correlationId null) — honest, not forced.
 * Groups sort by their first recorded timestamp; an entirely
 * timestamp-less window keeps backend order inside one bucket.
 */
export function buildExecutions(events: readonly PortalEvent[]): {
  groups: ExecutionGroup[];
  windowStart: number | null;
  windowEnd: number | null;
  /** Events no correlation id links — real, just ungrouped. */
  unlinked: PlacedEvent[];
  unplacedCount: number;
  partial: boolean;
} {
  const byCid = new Map<string, PortalEvent[]>();
  const unlinkedEvents: PortalEvent[] = [];
  for (const e of events) {
    const cid = e.correlation_id;
    if (cid) {
      const list = byCid.get(cid);
      if (list) list.push(e);
      else byCid.set(cid, [e]);
    } else {
      unlinkedEvents.push(e);
    }
  }

  const groups: ExecutionGroup[] = [];
  const make = (cid: string | null, evs: PortalEvent[]): ExecutionGroup => {
    const { placed, unplaced } = placeEvents(evs);
    const startMs = placed.length ? placed[0].timeMs : null;
    const endMs = placed.length ? placed[placed.length - 1].timeMs : null;
    return {
      key: cid ?? '',
      correlationId: cid,
      events: [...placed, ...unplaced],
      placed,
      unplaced,
      startMs,
      endMs,
      durationMs: startMs !== null && endMs !== null ? endMs - startMs : null,
      errorCount: evs.filter(isErr).length,
      spans: buildSpans(placed),
      leftPct: 0,
      widthPct: 0,
      tickGradient: buildTickGradient(placed, startMs, endMs),
      partial: unplaced.length > 0,
    };
  };

  for (const [cid, evs] of byCid) groups.push(make(cid, evs));
  let unlinked: PlacedEvent[] = [];
  if (unlinkedEvents.length) {
    const g = make(null, unlinkedEvents);
    unlinked = g.events;
    groups.push(g);
  }

  groups.sort((a, b) => {
    if (a.startMs === null && b.startMs === null) return a.key < b.key ? -1 : 1;
    if (a.startMs === null) return 1;
    if (b.startMs === null) return -1;
    return a.startMs - b.startMs || (a.key < b.key ? -1 : 1);
  });

  const starts = groups.map((g) => g.startMs).filter((x): x is number => x !== null);
  const ends = groups.map((g) => g.endMs).filter((x): x is number => x !== null);
  const windowStart = starts.length ? Math.min(...starts) : null;
  const windowEnd = ends.length ? Math.max(...ends) : null;
  const span = windowStart !== null && windowEnd !== null ? windowEnd - windowStart : 0;

  for (const g of groups) {
    if (g.startMs === null || windowStart === null || !span) {
      g.leftPct = 0;
      g.widthPct = g.startMs === null ? 0 : 100;
    } else {
      g.leftPct = ((g.startMs - windowStart) / span) * 100;
      g.widthPct = Math.max(0, (((g.endMs ?? g.startMs) - g.startMs) / span) * 100);
    }
    for (const s of g.spans) {
      if (windowStart === null || !span) {
        s.leftPct = 0;
        s.widthPct = 0;
      } else {
        s.leftPct = ((s.startMs - windowStart) / span) * 100;
        s.widthPct = Math.max(0, ((s.endMs - s.startMs) / span) * 100);
      }
    }
  }

  const unplacedCount = groups.reduce((n, g) => n + g.unplaced.length, 0);
  return { groups, windowStart, windowEnd, unlinked, unplacedCount, partial: unplacedCount > 0 };
}

/**
 * Observed spans: an event that carries BOTH a timestamp and a
 * duration_ms records a real [t−d, t] window (e.g. `operation.end`).
 * Same-span mates (shared span_id) merge: the window belongs to the
 * span, not the point event. Start events (`.start` types) pair with
 * their span's end when the end recorded its duration — still only
 * recorded fields, never inferred times.
 */
function buildSpans(placed: PlacedEvent[]): ExecSpan[] {
  const bySpan = new Map<string, { start?: number; end?: number }>();
  for (const p of placed) {
    const t = p.timeMs;
    if (t === null) continue;
    const sid = p.event.span_id ?? '';
    const acc = bySpan.get(sid) ?? {};
    const dur = p.event.duration_ms;
    if (typeof dur === 'number' && dur >= 0) {
      // end-event: timestamp is the real end, duration the measured span
      acc.end = t;
      acc.start = t - dur;
    }
    if (p.event.event_type.endsWith('.start')) {
      acc.start = acc.start === undefined ? t : Math.min(acc.start, t);
    }
    bySpan.set(sid, acc);
  }
  const out: ExecSpan[] = [];
  for (const [spanId, w] of bySpan) {
    if (w.start === undefined || w.end === undefined || w.end < w.start) continue;
    if (!spanId) continue; // an unspanned pair cannot be claimed as one span
    out.push({ spanId, startMs: w.start, endMs: w.end, leftPct: 0, widthPct: 0 });
  }
  return out.sort((a, b) => a.startMs - b.startMs || (a.spanId < b.spanId ? -1 : 1));
}

/**
 * Status tone → the same theme token the old `.tl__tick[data-status]`
 * elements resolved — colours still come from the design tokens so
 * themes/high-contrast keep working.
 */
const TICK_COLOR: Record<string, string> = {
  supported: 'var(--ok)',
  error: 'var(--error)',
  warn: 'var(--warn)',
  info: 'var(--info)',
  muted: 'var(--fg-muted)',
};

/** Track-width fraction a single tick occupies — small but always
 *  visible regardless of the window span. */
const TICK_WIDTH_PCT = 0.8;

/**
 * Encode every placed event of a group as color stops of ONE
 * `linear-gradient` drawn on the track element: stop positions are the
 * same group-relative percentages the DOM ticks used, stops for
 * overlapping ticks resolve later-on-top (the same paint order the old
 * absolutely-positioned spans had). Rendering a dense execution then
 * costs zero elements per event instead of one <span> per tick.
 */
export function buildTickGradient(
  placed: readonly PlacedEvent[],
  startMs: number | null,
  endMs: number | null,
): string {
  if (!placed.length || startMs === null || endMs === null) return '';
  const span = endMs - startMs;
  const pct = (v: number) => +v.toFixed(3);
  // A group with a single point in time still draws its tick — stacked
  // at the left edge, last status on top (the old DOM behaviour).
  if (span <= 0) {
    const last = placed[placed.length - 1];
    const c = TICK_COLOR[statusKind(last.event.status)] ?? TICK_COLOR['muted'];
    return `linear-gradient(90deg, ${c} 0%, ${c} ${TICK_WIDTH_PCT}%, transparent ${TICK_WIDTH_PCT}%)`;
  }
  // clamped left edge per tick — non-decreasing because `placed` is
  // already sorted by recorded timestamp
  const ls = placed.map((p) =>
    Math.max(0, Math.min(((p.timeMs! - startMs) / span) * 100, 100 - TICK_WIDTH_PCT)),
  );
  const stops: string[] = ['transparent 0%'];
  for (let i = 0; i < placed.length; i++) {
    const l = ls[i];
    // last-wins for overlaps: the next tick's left edge caps this tick
    const r = Math.min(l + TICK_WIDTH_PCT, i + 1 < ls.length ? ls[i + 1] : 100);
    const c = TICK_COLOR[statusKind(placed[i].event.status)] ?? TICK_COLOR['muted'];
    stops.push(
      `transparent ${pct(l)}%`,
      `${c} ${pct(l)}%`,
      `${c} ${pct(r)}%`,
      `transparent ${pct(r)}%`,
    );
  }
  stops.push('transparent 100%');
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// ------------------------------------------------------------------
// replay — playback of the recorded order with real gaps
// ------------------------------------------------------------------

/** Playback wait cap at speed 1× — beyond it a step is marked
 *  `compressed`: the REAL gap stays visible, playback just does not
 *  hold the full duration. Declared, never hidden. */
export const REPLAY_MAX_WAIT_MS = 5000;

export interface ReplayStep {
  event: PlacedEvent;
  /** Real delta to the previous step's timestamp — null for the first
   *  step and whenever either side has no usable timestamp. */
  gapMs: number | null;
  /** Playback wait at 1× speed = gapMs capped at REPLAY_MAX_WAIT_MS;
   *  null-gap steps step instantly (0). */
  waitMs: number;
  /** gapMs exceeded the playback cap — shown real, waited less. */
  compressed: boolean;
}

/**
 * Order recorded events for replay: real timestamps ascending (backend
 * order breaks ties), unplaceable events trail in backend order — the
 * same deterministic rule as tasks.data.buildReplay. Nothing is
 * simulated: a step exists only for a recorded event.
 */
export function buildReplay(events: readonly PortalEvent[]): ReplayStep[] {
  const { placed, unplaced } = placeEvents(events);
  const ordered = [...placed, ...unplaced];
  const steps: ReplayStep[] = [];
  let prev: number | null = null;
  for (const p of ordered) {
    let gap: number | null = null;
    if (prev !== null && p.timeMs !== null) gap = Math.max(0, p.timeMs - prev);
    if (p.timeMs !== null) prev = p.timeMs;
    const wait = gap === null ? 0 : Math.min(gap, REPLAY_MAX_WAIT_MS);
    steps.push({ event: p, gapMs: gap, waitMs: wait, compressed: gap !== null && gap > wait });
  }
  return steps;
}

// ------------------------------------------------------------------
// filters — every criterion is a real field or absent
// ------------------------------------------------------------------

export interface EventFilter {
  type: string | null;
  status: string | null;
  correlation: string;
  /** Free text over type/source/target/correlation/metadata/evidence. */
  q: string;
}

/** Normalized searchable text for one event — built once, reused by
 *  every keystroke of the free-text filter. */
function haystack(e: PortalEvent): string {
  return [
    e.event_type,
    e.source ?? '',
    e.target ?? '',
    e.correlation_id ?? '',
    e.span_id ?? '',
    e.status ?? '',
    JSON.stringify(e.metadata ?? {}),
    JSON.stringify(e.evidence ?? {}),
  ]
    .map(norm)
    .join(' ');
}

/** event → normalized haystack. Build once per data change so a filter
 *  keystroke is `includes` over real fields, not JSON.stringify×N. */
export type EventSearchIndex = ReadonlyMap<PortalEvent, string>;

export function buildSearchIndex(events: readonly PortalEvent[]): EventSearchIndex {
  return new Map(events.map((e) => [e, haystack(e)]));
}

export function filterEvents(
  events: readonly PortalEvent[],
  f: EventFilter,
  index?: EventSearchIndex,
): PortalEvent[] {
  const corr = f.correlation.trim();
  const q = norm(f.q);
  return events.filter((e) => {
    if (f.type !== null && e.event_type !== f.type) return false;
    if (f.status !== null && e.status !== f.status) return false;
    if (corr && !(e.correlation_id ?? '').includes(corr)) return false;
    if (!q) return true;
    return (index?.get(e) ?? haystack(e)).includes(q);
  });
}

/**
 * Lookup tables over the recorded window — built once per data change.
 * The inspector's "related"/"caused by" then cost a map hit instead of
 * a full-window scan on every render.
 */
export interface RelationIndex {
  byCorrelation: Map<string, PortalEvent[]>;
  /** Every event carrying a span_id, per span — window order kept. */
  bySpan: Map<string, PortalEvent[]>;
  /** Position of each event in the recorded window — lets merged
   *  relation sets restore the original order. */
  pos: Map<PortalEvent, number>;
}

export function buildRelationIndex(events: readonly PortalEvent[]): RelationIndex {
  const byCorrelation = new Map<string, PortalEvent[]>();
  const bySpan = new Map<string, PortalEvent[]>();
  const pos = new Map<PortalEvent, number>();
  events.forEach((e, i) => {
    pos.set(e, i);
    if (e.correlation_id) {
      const list = byCorrelation.get(e.correlation_id);
      if (list) list.push(e);
      else byCorrelation.set(e.correlation_id, [e]);
    }
    if (e.span_id) {
      const list = bySpan.get(e.span_id);
      if (list) list.push(e);
      else bySpan.set(e.span_id, [e]);
    }
  });
  return { byCorrelation, bySpan, pos };
}

/** Observed relations of one event — same correlation or same span
 *  only, in recorded-window order; nothing is linked by timing. */
export function relatedIn(e: PortalEvent, idx: RelationIndex): PortalEvent[] {
  const out = new Set<PortalEvent>();
  for (const x of idx.byCorrelation.get(e.correlation_id ?? '') ?? []) {
    if (x !== e) out.add(x);
  }
  for (const x of idx.bySpan.get(e.span_id ?? '') ?? []) {
    if (x !== e) out.add(x);
  }
  return [...out].sort((a, b) => (idx.pos.get(a) ?? 0) - (idx.pos.get(b) ?? 0));
}

/** The event whose `span_id` this one names as `parent_span_id` —
 *  a real declared parent link, or null. */
export function causedByIn(e: PortalEvent, idx: RelationIndex): PortalEvent | null {
  if (!e.parent_span_id) return null;
  return idx.bySpan.get(e.parent_span_id)?.[0] ?? null;
}

/** Observed relations of one event inside the recorded window — same
 *  correlation or same span only; nothing is linked by timing. */
export function relatedEvents(e: PortalEvent, all: readonly PortalEvent[]): PortalEvent[] {
  return all.filter(
    (x) =>
      x !== e &&
      ((e.correlation_id && x.correlation_id === e.correlation_id) ||
        (e.span_id && x.span_id === e.span_id)),
  );
}

/** The event whose `span_id` this one names as `parent_span_id` —
 *  a real declared parent link, or null. */
export function causedBy(e: PortalEvent, all: readonly PortalEvent[]): PortalEvent | null {
  if (!e.parent_span_id) return null;
  return all.find((x) => x.span_id === e.parent_span_id) ?? null;
}

/** Badge tone for a free-form status — the same mapping the observe and
 *  tasks pages use; the label always stays verbatim. */
export function statusKind(status: string | undefined | null): string {
  const s = (status ?? '').toLowerCase();
  if (['ok', 'done', 'completed', 'success', 'succeeded', 'pass', 'passed'].includes(s))
    return 'supported';
  if (['failed', 'fail', 'error', 'refused', 'denied'].includes(s)) return 'error';
  if (['skipped', 'cancelled', 'canceled', 'partial', 'degraded', 'timeout'].includes(s))
    return 'warn';
  if (['running', 'pending', 'started', 'in_progress', 'planning', 'verifying'].includes(s))
    return 'info';
  return 'muted';
}

/** Short correlation display — full value stays on `title`. */
export function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

/** Localized timestamp; the raw value falls through when unparsable —
 *  it is still real recorded data, never replaced by 'now'. */
export function fmtAt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function fmtGap(ms: number | null): string {
  if (ms === null) return '—';
  return `+${fmtDurationMs(ms)}`;
}

// ------------------------------------------------------------------
// view-models — formatting resolved once per data change, not per
// change-detection pass (Cycle 4 §7)
// ------------------------------------------------------------------

/** A table row over a recorded event — every display string resolved
 *  up-front so the template is pure interpolation. `null` fields mean
 *  "render the honest '—' placeholder". */
export interface EventRow {
  e: PortalEvent;
  /** 1-based position in the full filtered window — aria-rowindex. */
  position: number;
  at: string;
  kind: string;
  label: string;
  dur: string | null;
  flow: string | null;
  cidShort: string | null;
  cidFull: string | null;
}

export function buildEventRows(events: readonly PortalEvent[], offset = 0): EventRow[] {
  return events.map((e, i) => ({
    e,
    position: offset + i + 1,
    at: fmtAt(e.timestamp),
    kind: statusKind(e.status),
    label: e.status ?? '—',
    dur: e.duration_ms !== undefined ? `${e.duration_ms} ms` : null,
    flow: e.source || e.target ? `${e.source ?? '—'} → ${e.target ?? '—'}` : null,
    cidShort: e.correlation_id ? shortId(e.correlation_id) : null,
    cidFull: e.correlation_id ?? null,
  }));
}

/** A replay step ready to render — `index` is the step's position in
 *  the FULL step list so a paged slice keeps honest numbering. */
export interface StepRow {
  step: ReplayStep;
  index: number;
  gap: string;
  at: string;
  kind: string;
  label: string;
  dur: string | null;
  flow: string | null;
  /** No parseable recorded timestamp — the step is real but undrawn. */
  unplaced: boolean;
}

export function buildStepRows(steps: readonly ReplayStep[], offset = 0): StepRow[] {
  return steps.map((step, i) => {
    const index = offset + i;
    const e = step.event.event;
    return {
      step,
      index,
      gap: fmtGap(step.gapMs),
      at: fmtAt(e.timestamp),
      kind: statusKind(e.status),
      label: e.status ?? '—',
      dur: e.duration_ms !== undefined ? `${e.duration_ms} ms` : null,
      flow: e.source || e.target ? `${e.source ?? '—'} → ${e.target ?? '—'}` : null,
      unplaced: step.event.timeMs === null,
    };
  });
}
