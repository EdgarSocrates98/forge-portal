import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ExecutionPage } from './execution.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { PortalEvent, PortalEventReport } from '../../core/api/api.models';

const ev = (over: Partial<PortalEvent>): PortalEvent => ({
  schema: 'forge/PortalEvent/1',
  event_type: 'operation.start',
  ...over,
});

const REPORT: PortalEventReport = {
  schema: 'forge/PortalEventReport/1',
  generated_at: '2026-10-20T12:00:10Z',
  forge_id: 'e2e-forge',
  count: 5,
  dropped: 2,
  truncated: true,
  capacity: 500,
  counters: {
    'operation.start': 2,
    'operation.end': 1,
    'request.rejected': 1,
    'tool.invocation': 1,
  },
  events: [
    ev({
      event_id: 'e1',
      event_type: 'operation.start',
      correlation_id: 'cid-aaa111',
      span_id: 'sp1',
      timestamp: '2026-10-20T12:00:00.000Z',
      source: 'portal_core',
      target: 'GET /tasks',
      status: 'started',
    }),
    ev({
      event_id: 'e2',
      event_type: 'tool.invocation',
      correlation_id: 'cid-aaa111',
      span_id: 'sp1',
      timestamp: '2026-10-20T12:00:00.500Z',
      source: 'forge:e2e-forge',
      target: 'tool:forge-cli',
      status: 'ok',
      metadata: { action: 'pin' },
    }),
    ev({
      event_id: 'e3',
      event_type: 'operation.end',
      correlation_id: 'cid-aaa111',
      span_id: 'sp1',
      timestamp: '2026-10-20T12:00:01.000Z',
      source: 'portal_core',
      target: 'GET /tasks',
      status: 'ok',
      duration_ms: 1000,
    }),
    ev({
      event_id: 'e4',
      event_type: 'request.rejected',
      correlation_id: 'cid-bbb222',
      timestamp: '2026-10-20T12:00:05.000Z',
      source: 'portal_core',
      target: 'POST /apply',
      status: 'refused',
      metadata: { code: 'PORTAL-CONFIRM' },
    }),
    ev({
      event_id: 'e5',
      event_type: 'task.finished',
      correlation_id: 'cid-ccc333',
      timestamp: '2026-10-20T12:00:06.000Z',
      source: 'forge:e2e-forge',
      target: 'operation:task-1',
      status: 'ok',
      metadata: { task_id: 'task-1' },
    }),
  ],
};

function fakeApi(overrides: Partial<Record<keyof PortalApi, unknown>> = {}): PortalApi {
  return {
    events: vi.fn(() => of(REPORT)),
    ...overrides,
  } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const section = (el: HTMLElement, name: string) =>
  el.querySelector(`[data-section="${name}"]`) as HTMLElement | null;
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('tbody tr')];

/** 240-event window — exercises the bounded page slices and the
 *  keyboard journey across page boundaries. */
const BIG: PortalEventReport = {
  ...REPORT,
  count: 240,
  dropped: 0,
  truncated: false,
  events: Array.from({ length: 240 }, (_, i) =>
    ev({
      event_id: `b${i}`,
      event_type: i % 3 ? 'tool.invocation' : 'operation.end',
      correlation_id: `cid-${(i % 60).toString().padStart(3, '0')}`,
      timestamp: `2026-10-20T12:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(
        i % 60,
      ).padStart(2, '0')}.000Z`,
      source: `forge:scale-${i % 4}`,
      status: i % 5 ? 'ok' : 'failed',
    }),
  ),
};

describe('ExecutionPage — forge/PortalEvent/1 observability', () => {
  async function setup(
    overrides: Partial<Record<keyof PortalApi, unknown>> = {},
    inputs: Record<string, unknown> = {},
  ) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [ExecutionPage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(ExecutionPage);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  it('renders the report summary with the report’s own counts', async () => {
    const { el } = await setup();
    const sum = section(el, 'summary');
    expect(text(sum?.querySelector('[data-count="events"]'))).toContain('5');
    expect(text(sum?.querySelector('[data-count="dropped"]'))).toContain('2');
    expect(text(sum?.querySelector('[data-count="capacity"]'))).toContain('500');
    // the report self-reports truncation → the note is visible
    expect(el.querySelector('[data-note="truncated"]')).toBeTruthy();
    expect(section(el, 'local-only')).toBeTruthy();
  });

  it('draws one waterfall row per correlation group plus the unlinked bucket', async () => {
    const { el } = await setup();
    const rows_ = section(el, 'timeline')!.querySelectorAll('.tl__row');
    expect(rows_.length).toBe(3); // cid-aaa111, cid-bbb222, cid-ccc333
    expect(el.querySelector('[data-execution="cid-aaa111"]')).toBeTruthy();
    // ticks = placed events of that row
    const g1 = el.querySelector('[data-execution="cid-aaa111"]')!;
    // placed events draw as one gradient layer on the track — the real
    // count is advertised on data-ticks (Cycle 4: zero DOM per event)
    const track = g1.querySelector<HTMLElement>('.tl__track')!;
    expect(Number(track.getAttribute('data-ticks'))).toBe(3);
    expect(track.style.backgroundImage).toContain('linear-gradient');
    // a span underlay exists only where duration+timestamp were recorded
    expect(g1.querySelectorAll('.tl__span').length).toBe(1);
  });

  it('renders the events table with real fields and honest placeholders', async () => {
    const { el } = await setup();
    const trs = rows(section(el, 'events')!);
    expect(trs.length).toBe(5);
    expect(text(trs[0])).toContain('operation.start');
    expect(text(trs[0])).toContain('portal_core');
    // duration present only on e3
    expect(text(trs[0])).not.toContain('1000 ms');
    expect(text(trs[2])).toContain('1000 ms');
    expect(text(trs[0])).not.toContain('NaN');
  });

  it('filters by type/status/correlation and free text', async () => {
    const { el, fixture } = await setup();
    const events = section(el, 'events')!;
    const sel = events.querySelector<HTMLSelectElement>('select[data-filter="type"]')!;
    sel.value = 'tool.invocation';
    sel.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(rows(events).length).toBe(1);
    expect(text(events)).toContain('tool:forge-cli');
    // free text over metadata
    const q = el.querySelector<HTMLInputElement>('input[data-filter="search"]')!;
    sel.value = '';
    sel.dispatchEvent(new Event('change'));
    q.value = 'task-1';
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(rows(events).length).toBe(1);
    expect(text(events)).toContain('task.finished');
    // no match → the distinct empty state
    q.value = 'zzz-no-match';
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(rows(events).length).toBe(0);
    expect(events.querySelector('ui-empty[data-empty="no-matches"]')).toBeTruthy();
  });

  it('opens the inspector with verbatim fields and observed links', async () => {
    const { el, fixture } = await setup();
    const tr = rows(section(el, 'events')!)[1]; // tool.invocation
    tr.click();
    fixture.detectChanges();
    const insp = section(el, 'inspector');
    expect(insp).toBeTruthy();
    expect(text(insp)).toContain('tool.invocation');
    expect(text(insp)).toContain('cid-aaa111');
    expect(text(insp)).toContain('sp1');
    // metadata rendered verbatim
    expect(text(insp)).toContain('pin');
    // related events share the correlation id — all three of cid-aaa111
    const related = insp!.querySelectorAll('[data-section="related"] li');
    expect(related.length).toBe(2);
  });

  it('exposes a task deep-link only when metadata.task_id exists', async () => {
    const { el, fixture } = await setup();
    const trs = rows(section(el, 'events')!);
    trs[1].click(); // tool.invocation — no task_id
    fixture.detectChanges();
    expect(el.querySelector('[data-action="task"]')).toBeNull();
    trs[4].click(); // task.finished — metadata.task_id present
    fixture.detectChanges();
    const link = el.querySelector<HTMLAnchorElement>('[data-action="task"]');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toContain('task=task-1');
  });

  it('seeds filters and selects the execution from ?cid=', async () => {
    const { fixture } = await setup({}, { cid: 'cid-bbb222' });
    const inst = fixture.componentInstance;
    expect(inst.corrFilter()).toBe('cid-bbb222');
    expect(inst.selectedCid()).toBe('cid-bbb222');
    expect(inst.selectedGroup()?.events.length).toBe(1);
  });

  it('replays recorded steps with real order and real gaps', async () => {
    const { el, fixture } = await setup();
    const inst = fixture.componentInstance;
    inst.selectedCid.set('cid-aaa111');
    fixture.detectChanges();
    const steps = inst.replaySteps();
    expect(steps.map((s) => s.event.event.event_id)).toEqual(['e1', 'e2', 'e3']);
    expect(steps[1].gapMs).toBe(500);
    expect(steps[2].gapMs).toBe(500);
    // controls: prev disabled at 0, next enabled
    const prev = el.querySelector<HTMLButtonElement>('[data-action="step-prev"]')!;
    const next = el.querySelector<HTMLButtonElement>('[data-action="step-next"]')!;
    expect(prev.disabled).toBe(true);
    next.click();
    fixture.detectChanges();
    expect(inst.replayIdx()).toBe(1);
    // play schedules ahead; pause stops — no simulated events
    inst.play();
    expect(inst.playing()).toBe(true);
    inst.pause();
    expect(inst.playing()).toBe(false);
  });

  // -- Cycle 4 §7 — bounded rendering --------------------------------
  it('bounds the events table to a page slice — the range stays honest', async () => {
    const { el, fixture } = await setup({ events: vi.fn(() => of(BIG)) });
    const events = section(el, 'events')!;
    // 240 real events, but the DOM holds one page, not the window
    expect(rows(events).length).toBe(fixture.componentInstance.EVENTS_PAGE);
    const pager = events.querySelector('ui-pager')!;
    expect(pager).toBeTruthy();
    expect(text(pager.querySelector('[data-page="range"]'))).toContain('240');
    // aria-rowcount/rowindex keep the real table size in the a11y tree
    const table = events.querySelector('table')!;
    expect(Number(table.getAttribute('aria-rowcount'))).toBe(241);
    const firstRow = table.querySelector('tbody tr')!;
    expect(Number(firstRow.getAttribute('aria-rowindex'))).toBe(2);
    // next page renders the next real slice — never an empty view
    pager.querySelector<HTMLButtonElement>('[data-page="next"]')!.click();
    fixture.detectChanges();
    const p2 = events.querySelectorAll('tbody tr');
    expect(p2.length).toBe(fixture.componentInstance.EVENTS_PAGE);
    expect(Number(p2[0].getAttribute('aria-rowindex'))).toBe(
      fixture.componentInstance.EVENTS_PAGE + 2,
    );
  });

  it('bounds timeline groups and replay steps; transport keeps the page in view', async () => {
    const { el, fixture } = await setup({ events: vi.fn(() => of(BIG)) });
    const inst = fixture.componentInstance;
    const tl = section(el, 'timeline')!;
    // 60 real groups, one page of rows drawn
    expect(tl.querySelectorAll('.tl__row').length).toBe(inst.TL_PAGE);
    expect(tl.querySelector('ui-pager')).toBeTruthy();
    // 240 real steps, one page drawn; the current step stays visible
    const replay = section(el, 'replay')!;
    expect(replay.querySelectorAll('.rp__step').length).toBe(inst.STEPS_PAGE);
    // step 101 lands on page 2 automatically — no manual paging needed
    for (let i = 0; i < inst.STEPS_PAGE; i++)
      el.querySelector<HTMLButtonElement>('[data-action="step-next"]')!.click();
    fixture.detectChanges();
    expect(inst.replayIdx()).toBe(inst.STEPS_PAGE);
    const curLi = replay.querySelector<HTMLElement>('.rp__steps li[data-current]');
    expect(curLi).toBeTruthy();
    expect(curLi!.getAttribute('aria-posinset')).toBe(String(inst.STEPS_PAGE + 1));
  });

  it('destroys without leaks — the replay timer is cleared on teardown', async () => {
    const { fixture } = await setup({ events: vi.fn(() => of(BIG)) });
    const inst = fixture.componentInstance;
    vi.useFakeTimers();
    try {
      inst.play();
      expect(inst.playing()).toBe(true);
      fixture.destroy(); // the route-change destroy path
      // a surviving timer would advance the index; cleared, nothing moves
      vi.advanceTimersByTime(60000);
      expect(inst.replayIdx()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks the capability UNVERIFIED on 404 — never an empty success', async () => {
    const { el } = await setup({
      events: () =>
        throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
    });
    const unv = section(el, 'unavailable');
    expect(unv).toBeTruthy();
    expect(text(unv)).toContain('UNVERIFIED');
    expect(section(el, 'summary')).toBeNull();
    expect(section(el, 'timeline')).toBeNull();
    expect(el.querySelector('ui-error')).toBeNull();
  });

  it('renders the honest empty state when the window is empty', async () => {
    const { el } = await setup({
      events: () =>
        of({ ...REPORT, count: 0, dropped: 0, truncated: false, counters: {}, events: [] }),
    });
    expect(section(el, 'unavailable')).toBeNull();
    expect(el.querySelector('ui-empty[data-empty="events"]')).toBeTruthy();
    expect(section(el, 'timeline')).toBeNull();
    expect(section(el, 'replay')).toBeNull();
  });
});

describe('ExecutionPage — 2.2.1 cycle 6 keyboard navigation', () => {
  const key = (el: Element, k: string) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  async function setupKb(
    overrides: Partial<Record<keyof PortalApi, unknown>> = {},
    inputs: Record<string, unknown> = {},
  ) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [ExecutionPage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(ExecutionPage);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  it('each dense list costs exactly one tab stop (roving tabindex)', async () => {
    const { el } = await setupKb({ events: vi.fn(() => of(BIG)) });
    const evRows = rows(section(el, 'events')!);
    expect(evRows.length).toBe(100);
    // exactly one row owns the tab stop; every other row is reachable
    // by arrows, never by Tab — the 58-keypress mechanism removed
    expect(evRows.filter((r) => r.getAttribute('tabindex') === '0').length).toBe(1);
    expect(evRows[0].getAttribute('tabindex')).toBe('0');
    expect(evRows[1].getAttribute('tabindex')).toBe('-1');
    const tlRows = [...section(el, 'timeline')!.querySelectorAll<HTMLElement>('.tl__row')];
    expect(tlRows.filter((r) => r.getAttribute('tabindex') === '0').length).toBe(1);
    const steps = [...section(el, 'replay')!.querySelectorAll<HTMLElement>('.rp__step')];
    expect(steps.filter((s) => s.getAttribute('tabindex') === '0').length).toBe(1);
  });

  it('reaches an event in <= ~10 key actions (was ~58)', async () => {
    const { el, fixture } = await setupKb();
    // DOM order: the skip link precedes the dense blocks it bypasses
    const order = el.querySelectorAll('[data-action="skip-events"], [data-section="timeline"]');
    expect(order[0].getAttribute('data-action')).toBe('skip-events');
    // journey: Tab to refresh (1) → Tab to the skip link (2) → Enter (3)
    // lands focus on the table's tab row → Enter (4) opens the inspector
    let keys = 0;
    const skip = el.querySelector<HTMLElement>('[data-action="skip-events"]')!;
    expect(skip).toBeTruthy();
    skip.click();
    keys += 3;
    await vi.waitFor(() => {
      expect(document.activeElement?.getAttribute('data-action')).toBe('inspect');
    });
    key(document.activeElement!, 'Enter');
    keys += 1;
    fixture.detectChanges();
    expect(section(el, 'inspector')).toBeTruthy();
    expect(keys).toBeLessThanOrEqual(10);
  });

  it('arrows walk rows across page boundaries; Home/End/PageUp/PageDown jump', async () => {
    const { el, fixture } = await setupKb({ events: vi.fn(() => of(BIG)) });
    const inst = fixture.componentInstance;
    const evs = section(el, 'events')!;
    const row = (i: number) => evs.querySelector<HTMLElement>(`tbody tr[data-idx="${i}"]`)!;
    // one step inside the page
    key(row(0), 'ArrowDown');
    fixture.detectChanges();
    expect(inst.evCursor()).toBe(1);
    await vi.waitFor(() => expect(document.activeElement).toBe(row(1)));
    // page boundary: last row of page 1 → ArrowDown crosses to page 2
    key(row(99), 'ArrowDown');
    fixture.detectChanges();
    expect(inst.eventsPage()).toBe(1);
    await vi.waitFor(() => expect(document.activeElement).toBe(row(100)));
    // End jumps to the last row of the whole filtered window
    key(row(100), 'End');
    fixture.detectChanges();
    expect(inst.evCursor()).toBe(239);
    await vi.waitFor(() => expect(document.activeElement).toBe(row(239)));
    // PageUp/PageDown move one page size
    key(row(239), 'PageUp');
    fixture.detectChanges();
    expect(inst.evCursor()).toBe(139);
    await vi.waitFor(() => expect(document.activeElement).toBe(row(139)));
    // Home jumps back to the first row — and the page follows
    key(row(139), 'Home');
    fixture.detectChanges();
    expect(inst.evCursor()).toBe(0);
    expect(inst.eventsPage()).toBe(0);
    await vi.waitFor(() => expect(document.activeElement).toBe(row(0)));
  });

  it('opens the inspector with Enter on the focused row; Escape closes it', async () => {
    const { el, fixture } = await setupKb();
    const evs = section(el, 'events')!;
    const row = (i: number) => evs.querySelector<HTMLElement>(`tbody tr[data-idx="${i}"]`)!;
    key(row(1), 'ArrowDown'); // row 1 → cursor 2
    fixture.detectChanges();
    await vi.waitFor(() => expect(document.activeElement).toBe(row(2)));
    key(row(2), 'Enter');
    fixture.detectChanges();
    const insp = section(el, 'inspector');
    expect(insp).toBeTruthy();
    expect(text(insp)).toContain('operation.end'); // e3 — third event
    insp!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(section(el, 'inspector')).toBeNull();
  });

  it('closing the inspector returns focus to the row that opened it', async () => {
    const { el, fixture } = await setupKb();
    const evs = section(el, 'events')!;
    const row = (i: number) => evs.querySelector<HTMLElement>(`tbody tr[data-idx="${i}"]`)!;
    key(row(2), 'Enter');
    fixture.detectChanges();
    expect(section(el, 'inspector')).toBeTruthy();
    // the close button path
    section(el, 'inspector')!.querySelector<HTMLButtonElement>('.icon-btn')!.click();
    fixture.detectChanges();
    await vi.waitFor(() => expect(document.activeElement).toBe(row(2)));
    // the Escape-in-inspector path returns to the row too
    key(row(3), 'Enter');
    fixture.detectChanges();
    section(el, 'inspector')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    await vi.waitFor(() => expect(document.activeElement).toBe(row(3)));
  });

  it('paging keeps exactly one tab stop — the clamped row owns it', async () => {
    const { el, fixture } = await setupKb({ events: vi.fn(() => of(BIG)) });
    const evs = section(el, 'events')!;
    evs.querySelector<HTMLButtonElement>('ui-pager [data-page="next"]')!.click();
    fixture.detectChanges();
    const rs = rows(evs);
    expect(rs.filter((r) => r.getAttribute('tabindex') === '0').length).toBe(1);
    // cursor was on page 1 → the page-2 slice's first row takes the stop
    expect(rs[0].getAttribute('tabindex')).toBe('0');
    expect(rs[0].getAttribute('data-idx')).toBe('100');
  });

  it('timeline rows and replay steps share the same roving contract', async () => {
    const { el, fixture } = await setupKb({ events: vi.fn(() => of(BIG)) });
    const inst = fixture.componentInstance;
    const tl = section(el, 'timeline')!;
    const trow = (i: number) => tl.querySelector<HTMLElement>(`.tl__row[data-idx="${i}"]`)!;
    key(trow(0), 'ArrowDown');
    fixture.detectChanges();
    await vi.waitFor(() => expect(document.activeElement).toBe(trow(1)));
    // crossing the timeline page boundary moves the pager too
    key(trow(49), 'ArrowDown');
    fixture.detectChanges();
    expect(inst.tlPage()).toBe(1);
    await vi.waitFor(() => expect(document.activeElement).toBe(trow(50)));
    // replay steps: End jumps the whole recorded window
    const rp = section(el, 'replay')!;
    const step = (i: number) => rp.querySelector<HTMLElement>(`.rp__step[data-idx="${i}"]`)!;
    key(step(0), 'End');
    fixture.detectChanges();
    expect(inst.stepCursor()).toBe(239);
    await vi.waitFor(() => expect(document.activeElement).toBe(step(239)));
  });

  it('filter changes keep the tab row reachable — cursor self-heals', async () => {
    const { el, fixture } = await setupKb({ events: vi.fn(() => of(BIG)) });
    const inst = fixture.componentInstance;
    inst.evCursor.set(200);
    const q = el.querySelector<HTMLInputElement>('input[data-filter="search"]')!;
    q.value = 'zzz-no-match';
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    // empty window → no tab stop at all
    expect(inst.evTabIdx()).toBe(-1);
    q.value = 'scale-1'; // matches the recorded `source` field of 60 events
    q.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    // cursor 200 lands outside the 60-row window → clamped to its last
    // row — the tab stop is always a real rendered row, never a gap
    expect(inst.evTabIdx()).toBe(59);
    const evs = section(el, 'events')!;
    const rs = rows(evs).filter((r) => r.getAttribute('tabindex') === '0');
    expect(rs.length).toBe(1);
  });
});
