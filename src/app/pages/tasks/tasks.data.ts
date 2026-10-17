import { MetricsEvent, MetricsReport, TaskExecution } from '../../core/api/api.models';

/**
 * Execution Intelligence derivations — pure functions over real task
 * records (`GET /tasks`) and persisted metric events (`GET /metrics`).
 * Same contract as dashboard `ops.data.ts`: a bar exists only when the
 * record carries a parseable `started_at`, an end only when a
 * `finished_at ≥ started_at` exists, and nothing is ever interpolated.
 * Records without usable timestamps land in `unplaced` so the timeline
 * can mark itself partial instead of silently dropping history.
 */

/** Parse an ISO timestamp → epoch ms, or null when absent/broken. */
export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Real recorded duration, or null when either end is untrusted. */
export function taskDurationMs(t: TaskExecution): number | null {
  const start = parseTime(t.started_at);
  const end = parseTime(t.finished_at);
  if (start === null || end === null || end < start) return null;
  return end - start;
}

/** Human-readable duration — the existing Tasks page formatting. */
export function fmtDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${Number(s.toFixed(1))} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export function fmtTaskDuration(t: TaskExecution): string {
  const ms = taskDurationMs(t);
  return ms === null ? '—' : fmtDurationMs(ms);
}

// ------------------------------------------------------------------
// timeline — bars positioned by recorded timestamps only
// ------------------------------------------------------------------

export interface TimelineRow {
  task: TaskExecution;
  /** Recorded start (epoch ms). */
  startMs: number;
  /** Recorded end — null when the task has no trustworthy finished_at
   *  (still running, missing, or contradictory); the bar then extends
   *  to the window end and renders open/dashed, never a fake finish. */
  endMs: number | null;
  leftPct: number;
  widthPct: number;
}

export interface TaskTimeline {
  /** Placed rows, sorted by recorded start (ties by id — deterministic). */
  rows: TimelineRow[];
  /** Records with no usable `started_at` — real history, undrawn. */
  unplaced: TaskExecution[];
  /** Window bounds in epoch ms — null when nothing was placeable. */
  windowStart: number | null;
  windowEnd: number | null;
  /** True when the drawn window does not cover every record — i.e.
   *  records were unplaceable. Open (unfinished) bars alone do NOT mark
   *  the timeline partial: a running task is present history. */
  partial: boolean;
}

export function buildTimeline(tasks: readonly TaskExecution[]): TaskTimeline {
  const placed: { task: TaskExecution; startMs: number; endMs: number | null }[] = [];
  const unplaced: TaskExecution[] = [];
  for (const t of tasks) {
    const startMs = parseTime(t.started_at);
    if (startMs === null) {
      unplaced.push(t);
      continue;
    }
    const end = parseTime(t.finished_at);
    placed.push({ task: t, startMs, endMs: end !== null && end >= startMs ? end : null });
  }
  placed.sort((a, b) => a.startMs - b.startMs || (a.task.id < b.task.id ? -1 : 1));

  if (!placed.length) {
    return { rows: [], unplaced, windowStart: null, windowEnd: null, partial: unplaced.length > 0 };
  }

  const windowStart = Math.min(...placed.map((r) => r.startMs));
  const windowEnd = Math.max(...placed.map((r) => r.endMs ?? r.startMs));
  const span = windowEnd - windowStart;

  const rows: TimelineRow[] = placed.map((r) => {
    const end = r.endMs ?? windowEnd;
    const leftPct = span === 0 ? 0 : ((r.startMs - windowStart) / span) * 100;
    const widthPct = span === 0 ? 100 : Math.max(0, ((end - r.startMs) / span) * 100);
    // Zero-width real durations still render as a hairline tick.
    return { task: r.task, startMs: r.startMs, endMs: r.endMs, leftPct, widthPct };
  });

  return { rows, unplaced, windowStart, windowEnd, partial: unplaced.length > 0 };
}

// ------------------------------------------------------------------
// replay — stepping through persisted metric events
// ------------------------------------------------------------------

export type ReplayState =
  /** /metrics did not answer — recorded events unverified. */
  | 'unavailable'
  /** The task record carries no correlation_id — nothing can be linked. */
  | 'no-correlation'
  /** Metrics loaded but no recorded event shares the correlation id. */
  | 'empty'
  /** Real recorded events, ordered by their `at` timestamps. */
  | 'ready';

export interface ReplayResult {
  state: ReplayState;
  /** Ordered recorded events for the task — empty unless `ready`. */
  steps: MetricsEvent[];
  /** The report was truncated upstream — the replay window is partial. */
  truncated: boolean;
}

/**
 * Replay the recorded evidence of one task: the persisted `/metrics`
 * events whose `correlation_id` matches the task record, in recorded
 * order (`at` ascending; unparsable timestamps keep their backend order
 * at the end). This is playback of real events — it never reconstructs
 * stages the adapter did not record.
 */
export function buildReplay(
  report: MetricsReport | null | undefined,
  task: TaskExecution | null,
): ReplayResult {
  if (!report) return { state: 'unavailable', steps: [], truncated: false };
  if (!task?.correlation_id) {
    return { state: 'no-correlation', steps: [], truncated: report.truncated };
  }
  const cid = task.correlation_id;
  const steps = report.events
    .filter((e) => e.correlation_id === cid)
    .map((e, i) => ({ e, i, t: parseTime(e.at) }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;
      if (a.t === null) return 1;
      if (b.t === null) return -1;
      return a.t - b.t || a.i - b.i;
    })
    .map(({ e }) => e);
  return { state: steps.length ? 'ready' : 'empty', steps, truncated: report.truncated };
}
