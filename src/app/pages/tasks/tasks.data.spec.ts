import { MetricsReport, TaskExecution } from '../../core/api/api.models';
import {
  buildReplay,
  buildTimeline,
  fmtTaskDuration,
  parseTime,
  taskDurationMs,
} from './tasks.data';

const T = (id: string, extra: Partial<TaskExecution> = {}): TaskExecution => ({
  id,
  verb: 'v',
  label: id,
  stage: 'completed',
  started_at: '2026-10-14T00:00:00.000Z',
  finished_at: '2026-10-14T00:00:01.000Z',
  exit_code: 0,
  ...extra,
});

describe('tasks.data — time helpers', () => {
  it('parses only real timestamps', () => {
    expect(parseTime('2026-10-14T00:00:00.000Z')).toBe(Date.parse('2026-10-14T00:00:00.000Z'));
    expect(parseTime('')).toBeNull();
    expect(parseTime(null)).toBeNull();
    expect(parseTime('not-a-date')).toBeNull();
  });

  it('duration is finished−started only when both are trustworthy', () => {
    expect(taskDurationMs(T('a'))).toBe(1000);
    expect(fmtTaskDuration(T('a'))).toBe('1 s');
    expect(taskDurationMs(T('b', { finished_at: null }))).toBeNull();
    expect(taskDurationMs(T('c', { finished_at: '2026-10-13T00:00:00Z' }))).toBeNull(); // negative
  });
});

describe('tasks.data — buildTimeline', () => {
  it('positions rows by recorded start/end inside the window', () => {
    const tl = buildTimeline([
      T('early', {
        started_at: '2026-10-14T00:00:00Z',
        finished_at: '2026-10-14T00:00:10Z',
      }),
      T('late', {
        started_at: '2026-10-14T00:00:10Z',
        finished_at: '2026-10-14T00:00:20Z',
      }),
    ]);
    expect(tl.rows.map((r) => r.task.id)).toEqual(['early', 'late']);
    expect(tl.windowStart).toBe(Date.parse('2026-10-14T00:00:00Z'));
    expect(tl.windowEnd).toBe(Date.parse('2026-10-14T00:00:20Z'));
    expect(tl.rows[0]!.leftPct).toBe(0);
    expect(tl.rows[0]!.widthPct).toBe(50);
    expect(tl.rows[1]!.leftPct).toBe(50);
    expect(tl.rows[1]!.widthPct).toBe(50);
    expect(tl.partial).toBe(false);
    expect(tl.unplaced).toEqual([]);
  });

  it('marks the timeline partial when records lack usable timestamps', () => {
    const tl = buildTimeline([
      T('ok'),
      T('ghost', { started_at: '', finished_at: null }),
      T('broken', { started_at: '×××', finished_at: null }),
    ]);
    expect(tl.rows.map((r) => r.task.id)).toEqual(['ok']);
    expect(tl.unplaced.map((t) => t.id).sort()).toEqual(['broken', 'ghost']);
    expect(tl.partial).toBe(true);
  });

  it('renders unfinished tasks as open bars — never a fake finish', () => {
    const tl = buildTimeline([
      T('done', { finished_at: '2026-10-14T00:00:05Z' }),
      T('running', { started_at: '2026-10-14T00:00:05Z', finished_at: null }),
    ]);
    const running = tl.rows.find((r) => r.task.id === 'running')!;
    expect(running.endMs).toBeNull();
    expect(running.leftPct).toBe(100);
    expect(running.widthPct).toBe(0); // open bar pinned at the window end
    // open ≠ partial: a running task is present history, not missing data
    expect(tl.partial).toBe(false);
  });

  it('contradictory finished_at (before start) degrades to open, never negative width', () => {
    const tl = buildTimeline([
      T('a', { started_at: '2026-10-14T00:00:00Z', finished_at: '2026-10-14T00:00:10Z' }),
      T('b', {
        started_at: '2026-10-14T00:00:05Z',
        finished_at: '2026-10-14T00:00:01Z', // before its own start
      }),
    ]);
    const b = tl.rows.find((r) => r.task.id === 'b')!;
    expect(b.endMs).toBeNull();
    expect(b.widthPct).toBeGreaterThanOrEqual(0);
  });

  it('zero-span window gives every bar the full row', () => {
    const tl = buildTimeline([
      T('x', { finished_at: '2026-10-14T00:00:00.000Z' }),
      T('y', { finished_at: '2026-10-14T00:00:00.000Z' }),
    ]);
    expect(tl.rows.every((r) => r.leftPct === 0 && r.widthPct === 100)).toBe(true);
  });

  it('empty and all-unplaced inputs stay honest', () => {
    expect(buildTimeline([]).rows).toEqual([]);
    expect(buildTimeline([]).partial).toBe(false);
    const tl = buildTimeline([T('z', { started_at: '', finished_at: null })]);
    expect(tl.rows).toEqual([]);
    expect(tl.windowStart).toBeNull();
    expect(tl.partial).toBe(true);
  });
});

describe('tasks.data — buildReplay', () => {
  const report: MetricsReport = {
    generated_at: '2026-10-14T00:01:00Z',
    counters: {},
    truncated: false,
    events: [
      {
        kind: 'task',
        at: '2026-10-14T00:00:02Z',
        duration_ms: null,
        status: 'completed',
        origin: 'tasks',
        correlation_id: 'corr-1',
      },
      {
        kind: 'task',
        at: '2026-10-14T00:00:00Z',
        duration_ms: null,
        status: 'started',
        origin: 'tasks',
        correlation_id: 'corr-1',
      },
      {
        kind: 'install',
        at: '2026-10-14T00:00:01Z',
        duration_ms: 900,
        status: 'ok',
        origin: 'install',
        correlation_id: 'other',
      },
    ],
  };

  it('returns recorded events for the task correlation id in time order', () => {
    const r = buildReplay(report, T('t1', { correlation_id: 'corr-1' }));
    expect(r.state).toBe('ready');
    expect(r.steps.map((e) => e.status)).toEqual(['started', 'completed']);
  });

  it('is unavailable when /metrics did not answer', () => {
    expect(buildReplay(null, T('t1', { correlation_id: 'corr-1' })).state).toBe('unavailable');
    expect(buildReplay(undefined, null).state).toBe('unavailable');
  });

  it('is no-correlation when the task record carries no id', () => {
    expect(buildReplay(report, T('t1')).state).toBe('no-correlation');
    expect(buildReplay(report, { ...T('t1'), correlation_id: undefined }).state).toBe(
      'no-correlation',
    );
  });

  it('is empty when no recorded event shares the id — never synthesized', () => {
    const r = buildReplay(report, T('t1', { correlation_id: 'nobody' }));
    expect(r.state).toBe('empty');
    expect(r.steps).toEqual([]);
  });

  it('carries the truncated flag so partial windows stay visible', () => {
    const r = buildReplay({ ...report, truncated: true }, T('t1', { correlation_id: 'corr-1' }));
    expect(r.truncated).toBe(true);
  });
});
