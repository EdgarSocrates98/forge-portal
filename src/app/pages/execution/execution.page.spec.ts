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
    expect(g1.querySelectorAll('.tl__tick').length).toBe(3);
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
