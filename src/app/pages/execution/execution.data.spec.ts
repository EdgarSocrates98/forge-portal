import { PortalEvent } from '../../core/api/api.models';
import {
  REPLAY_MAX_WAIT_MS,
  buildExecutions,
  buildReplay,
  causedBy,
  filterEvents,
  fmtGap,
  placeEvents,
  relatedEvents,
  shortId,
  statusKind,
} from './execution.data';

const ev = (over: Partial<PortalEvent>): PortalEvent => ({
  schema: 'forge/PortalEvent/1',
  event_type: 'operation.start',
  ...over,
});

const T0 = '2026-10-20T12:00:00.000Z';
const T1 = '2026-10-20T12:00:01.000Z';
const T2 = '2026-10-20T12:00:02.500Z';

describe('placeEvents — real timestamps only', () => {
  it('orders by parsed timestamp, keeps backend order for unplaced', () => {
    const a = ev({ event_id: 'a', timestamp: T2 });
    const b = ev({ event_id: 'b' }); // no timestamp — real, undrawn
    const c = ev({ event_id: 'c', timestamp: T0 });
    const d = ev({ event_id: 'd', timestamp: 'garbage' });
    const { placed, unplaced } = placeEvents([a, b, c, d]);
    expect(placed.map((p) => p.event.event_id)).toEqual(['c', 'a']);
    expect(unplaced.map((p) => p.event.event_id)).toEqual(['b', 'd']);
  });
});

describe('buildExecutions — correlation grouping', () => {
  const events: PortalEvent[] = [
    ev({
      event_id: 's1',
      event_type: 'operation.start',
      correlation_id: 'c1',
      timestamp: T0,
      span_id: 'sp1',
      status: 'started',
    }),
    ev({
      event_id: 'e1',
      event_type: 'operation.end',
      correlation_id: 'c1',
      timestamp: T1,
      span_id: 'sp1',
      status: 'ok',
      duration_ms: 1000,
    }),
    ev({
      event_id: 'f1',
      event_type: 'request.rejected',
      correlation_id: 'c2',
      timestamp: T2,
      status: 'refused',
    }),
    ev({ event_id: 'u1', event_type: 'tool.invocation', source: 'forge:x', target: 'tool:cli' }), // no cid, no timestamp
  ];

  it('groups by the real correlation_id and keeps an unlinked bucket', () => {
    const { groups, unlinked } = buildExecutions(events);
    const cids = groups.map((g) => g.correlationId);
    expect(cids).toContain('c1');
    expect(cids).toContain('c2');
    expect(cids).toContain(null); // the unlinked bucket
    expect(unlinked.map((p) => p.event.event_id)).toEqual(['u1']);
    const c1 = groups.find((g) => g.correlationId === 'c1')!;
    expect(c1.events.map((p) => p.event.event_id)).toEqual(['s1', 'e1']);
    expect(c1.durationMs).toBe(1000); // T1 - T0
    const c2 = groups.find((g) => g.correlationId === 'c2')!;
    expect(c2.errorCount).toBe(1); // 'refused' is an error status
  });

  it('derives a span only from recorded timestamp + duration_ms', () => {
    const { groups } = buildExecutions(events);
    const c1 = groups.find((g) => g.correlationId === 'c1')!;
    expect(c1.spans.length).toBe(1);
    expect(c1.spans[0].spanId).toBe('sp1');
    expect(c1.spans[0].endMs).toBe(Date.parse(T1));
    expect(c1.spans[0].startMs).toBe(Date.parse(T1) - 1000);
    // the unlinked event has no span/duration — nothing derived
    const un = groups.find((g) => g.correlationId === null)!;
    expect(un.spans.length).toBe(0);
    expect(un.partial).toBe(true); // its only event has no timestamp
  });

  it('sorts groups by first recorded timestamp; unplaceable trails', () => {
    const { groups } = buildExecutions([
      ev({ event_id: 'x', correlation_id: 'late', timestamp: T2 }),
      ev({ event_id: 'y', correlation_id: 'early', timestamp: T0 }),
      ev({ event_id: 'z' }), // no timestamp → unlinked, last
    ]);
    expect(groups.map((g) => g.correlationId)).toEqual(['early', 'late', null]);
  });

  it('computes the window from placed events only', () => {
    const { windowStart, windowEnd, unplacedCount, partial } = buildExecutions(events);
    expect(windowStart).toBe(Date.parse(T0));
    expect(windowEnd).toBe(Date.parse(T2));
    expect(unplacedCount).toBe(1);
    expect(partial).toBe(true);
  });

  it('empty input → empty window, not a fake one', () => {
    const out = buildExecutions([]);
    expect(out.groups).toEqual([]);
    expect(out.windowStart).toBeNull();
    expect(out.windowEnd).toBeNull();
    expect(out.partial).toBe(false);
  });
});

describe('buildReplay — recorded order, real gaps', () => {
  const events: PortalEvent[] = [
    ev({ event_id: 'a', timestamp: T0 }),
    ev({ event_id: 'b', timestamp: T1 }),
    ev({ event_id: 'c', timestamp: T2 }),
    ev({ event_id: 'u' }), // unplaced trails in backend order
  ];

  it('walks real timestamp order; unplaced trail in backend order', () => {
    const steps = buildReplay([events[2], events[0], events[1], events[3]]);
    expect(steps.map((s) => s.event.event.event_id)).toEqual(['a', 'b', 'c', 'u']);
  });

  it('gap = real inter-event delta; first step has none', () => {
    const steps = buildReplay(events);
    expect(steps[0].gapMs).toBeNull();
    expect(steps[1].gapMs).toBe(1000);
    expect(steps[2].gapMs).toBe(1500);
    // the unplaced step carries no gap — not a fake 0
    expect(steps[3].gapMs).toBeNull();
  });

  it('playback wait scales the real gap and marks compression', () => {
    const huge = ev({ event_id: 'big', timestamp: '2026-10-20T12:10:00.000Z' });
    const steps = buildReplay([events[0], huge]);
    expect(steps[1].gapMs).toBe(600000);
    expect(steps[1].waitMs).toBe(REPLAY_MAX_WAIT_MS);
    expect(steps[1].compressed).toBe(true);
    // a gap inside the cap passes through uncompressed
    expect(buildReplay(events)[1].compressed).toBe(false);
    expect(buildReplay(events)[1].waitMs).toBe(1000);
  });
});

describe('filterEvents — real fields only', () => {
  const events: PortalEvent[] = [
    ev({
      event_id: 'a',
      event_type: 'tool.invocation',
      status: 'ok',
      source: 'forge:e2e',
      target: 'tool:cli',
      correlation_id: 'abc123',
    }),
    ev({
      event_id: 'b',
      event_type: 'request.rejected',
      status: 'refused',
      target: 'GET /x',
      correlation_id: 'zzz',
    }),
    ev({
      event_id: 'c',
      event_type: 'operation.end',
      status: 'ok',
      metadata: { task_id: 'task-9' },
    }),
  ];

  it('matches each criterion against the real field', () => {
    expect(
      filterEvents(events, { type: 'tool.invocation', status: null, correlation: '', q: '' }).map(
        (e) => e.event_id,
      ),
    ).toEqual(['a']);
    expect(
      filterEvents(events, { type: null, status: 'refused', correlation: '', q: '' }).map(
        (e) => e.event_id,
      ),
    ).toEqual(['b']);
    expect(
      filterEvents(events, { type: null, status: null, correlation: 'abc', q: '' }).map(
        (e) => e.event_id,
      ),
    ).toEqual(['a']);
  });

  it('free text covers type/source/target/metadata — diacritic-insensitive', () => {
    expect(
      filterEvents(events, { type: null, status: null, correlation: '', q: 'CLI' }).map(
        (e) => e.event_id,
      ),
    ).toEqual(['a']);
    expect(
      filterEvents(events, { type: null, status: null, correlation: '', q: 'task-9' }).map(
        (e) => e.event_id,
      ),
    ).toEqual(['c']);
    expect(
      filterEvents(events, { type: null, status: null, correlation: '', q: 'não-existe' }),
    ).toEqual([]);
  });
});

describe('relations — observed links only', () => {
  const a = ev({ event_id: 'a', correlation_id: 'c1', span_id: 'sp1' });
  const b = ev({ event_id: 'b', correlation_id: 'c1', span_id: 'sp2', parent_span_id: 'sp1' });
  const c = ev({ event_id: 'c', correlation_id: 'c2' });
  const all = [a, b, c];

  it('related = same correlation or same span, self excluded', () => {
    expect(relatedEvents(a, all).map((e) => e.event_id)).toEqual(['b']);
    expect(relatedEvents(c, all)).toEqual([]);
  });

  it('causedBy resolves a declared parent_span_id only', () => {
    expect(causedBy(b, all)?.event_id).toBe('a');
    expect(causedBy(a, all)).toBeNull();
    expect(causedBy(c, all)).toBeNull();
  });
});

describe('labels', () => {
  it('statusKind maps tone without touching the verbatim label', () => {
    expect(statusKind('ok')).toBe('supported');
    expect(statusKind('refused')).toBe('error');
    expect(statusKind('timeout')).toBe('warn');
    expect(statusKind('started')).toBe('info');
    expect(statusKind(undefined)).toBe('muted');
  });
  it('shortId truncates long ids, keeps small ones', () => {
    expect(shortId('abc123')).toBe('abc123');
    expect(shortId('corr-abc123def456')).toBe('corr-abc…');
    expect(shortId(null)).toBe('—');
  });
  it('fmtGap shows the real delta or an honest placeholder', () => {
    expect(fmtGap(null)).toBe('—');
    expect(fmtGap(1500)).toBe('+1.5 s');
  });
});
