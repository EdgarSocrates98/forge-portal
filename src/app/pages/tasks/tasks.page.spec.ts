import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { TasksPage } from './tasks.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { InstallationReceipt, MetricsReport, TaskExecution } from '../../core/api/api.models';

const TASKS: TaskExecution[] = [
  {
    id: 't1',
    verb: 'install',
    label: 'install apply',
    stage: 'completed',
    started_at: '2026-10-14T00:00:00.000Z',
    finished_at: '2026-10-14T00:00:01.500Z',
    exit_code: 0,
    correlation_id: 'corr-abc-123',
  },
  {
    id: 't2',
    verb: 'analyze',
    label: 'analyze scripts',
    stage: 'running',
    started_at: '2026-10-14T00:01:00.000Z',
    finished_at: null,
    exit_code: null,
  },
];

const PLAN = {
  plan_token: 'tok-1',
  plan: {
    verb: 'doctor.check',
    label: 'doctor check',
    intent: 'check env',
    args: { deep: true },
  },
  correlation_id: 'corr-plan-1',
};

const RECEIPT: InstallationReceipt = {
  status: 'completed',
  detail: 'all checks passed',
  task: {
    id: 't9',
    verb: 'doctor.check',
    label: 'doctor check',
    stage: 'completed',
    started_at: '2026-10-14T00:00:00.000Z',
    finished_at: '2026-10-14T00:00:02.000Z',
    exit_code: 0,
    correlation_id: 'corr-exec-9',
  },
};

const STALE = () =>
  new ApiError(409, { code: 'PORTAL-PLAN-STALE', message: 'plan token is stale' });

const METRICS: MetricsReport = {
  generated_at: '2026-10-14T00:02:00.000Z',
  counters: { tasks: 2 },
  truncated: false,
  events: [
    {
      kind: 'task',
      at: '2026-10-14T00:00:00.000Z',
      duration_ms: null,
      status: 'started',
      origin: 'tasks',
      correlation_id: 'corr-abc-123',
    },
    {
      kind: 'task',
      at: '2026-10-14T00:00:01.500Z',
      duration_ms: 1500,
      status: 'completed',
      origin: 'tasks',
      correlation_id: 'corr-abc-123',
      detail: 'install apply finished',
    },
    {
      kind: 'verify',
      at: '2026-10-14T00:00:03.000Z',
      duration_ms: 10,
      status: 'ok',
      origin: 'verify',
      correlation_id: 'unrelated',
    },
  ],
};

function fakeApi(overrides: Partial<Record<keyof PortalApi, unknown>> = {}): PortalApi {
  return {
    tasks: vi.fn(() => of(TASKS)),
    tasksPlan: vi.fn(() => of(PLAN)),
    tasksExecute: vi.fn(() => of(RECEIPT)),
    metrics: vi.fn(() => of(METRICS)),
    ...overrides,
  } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const section = (el: HTMLElement, name: string) =>
  el.querySelector(`[data-section="${name}"]`) as HTMLElement | null;

describe('TasksPage — Execution Center', () => {
  async function setup(overrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [TasksPage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(TasksPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('runs plan → review → execute → receipt in order and refreshes history', async () => {
    const { fixture, api, c, el } = await setup();

    c.intent.set('check env');
    await c.plan();
    fixture.detectChanges();

    expect(api.tasksPlan).toHaveBeenCalledWith({ intent: 'check env' });
    const plan = section(el, 'plan');
    expect(plan).toBeTruthy();
    expect(text(plan)).toContain('doctor check');
    expect(text(plan)).toContain('doctor.check');

    plan!.querySelector<HTMLElement>('[data-action="execute"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.tasksExecute).toHaveBeenCalledWith(PLAN.plan, 'tok-1');
    expect(c.pending()).toBeNull();
    expect(c.receipt()?.status).toBe('completed');
    // history re-fetched after execute (once in ctor, once after)
    expect(api.tasks).toHaveBeenCalledTimes(2);
    expect(section(el, 'receipt')).toBeTruthy();
    expect(section(el, 'plan')).toBeNull();
  });

  it('surfaces correlation ids on the plan card, receipt and history rows', async () => {
    const { fixture, c, el } = await setup();

    // history rows — real correlation_id, truncated cell keeps title attr
    const corrCell = el.querySelector('tbody tr td.corr');
    expect(text(corrCell)).toContain('corr-abc-123');
    expect(corrCell?.getAttribute('title')).toBe('corr-abc-123');
    // row without correlation_id renders '—', never fabricated
    const cells = [...el.querySelectorAll('tbody tr td.corr')];
    expect(text(cells[1]).trim()).toBe('—');
    expect(cells[1]?.getAttribute('title')).toBeNull();

    // plan card — payload-level correlation_id
    c.intent.set('check env');
    await c.plan();
    fixture.detectChanges();
    expect(text(section(el, 'plan'))).toContain('corr-plan-1');
    expect(c.planCorrelation(c.pending()!)).toBe('corr-plan-1');

    // receipt — task record correlation_id
    await c.execute(PLAN.plan, 'tok-1');
    fixture.detectChanges();
    expect(text(section(el, 'receipt'))).toContain('corr-exec-9');
    expect(c.receiptCorrelation(c.receipt()!)).toBe('corr-exec-9');
  });

  it('renders — for correlation ids that are not reachable in the payload', async () => {
    const { fixture, c, el } = await setup({
      tasksPlan: () => of({ plan_token: 'tok-2', plan: { verb: 'x' } }),
      tasksExecute: () => of({ status: 'completed' } satisfies InstallationReceipt),
    });
    c.intent.set('do x');
    await c.plan();
    fixture.detectChanges();
    expect(c.planCorrelation(c.pending()!)).toBe('—');
    await c.execute({ verb: 'x' }, 'tok-2');
    expect(c.receiptCorrelation(c.receipt()!)).toBe('—');
  });

  it('exports receipt-<task_id>.json with the real payload', async () => {
    const { fixture, c, el } = await setup();
    const createUrl = vi.fn((b: unknown) => 'blob:fake-1');
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeUrl, configurable: true });
    let anchor: HTMLAnchorElement | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchor = this;
    });

    c.receipt.set(RECEIPT);
    fixture.detectChanges();
    section(el, 'receipt')!.querySelector<HTMLElement>('[data-action="export"]')!.click();

    expect(createUrl).toHaveBeenCalledTimes(1);
    const blob = createUrl.mock.calls[0]![0] as unknown as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toEqual(JSON.parse(JSON.stringify(RECEIPT)));
    expect(anchor!.download).toBe('receipt-t9.json');
    expect(anchor!.href).toBe('blob:fake-1');
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake-1');
  });

  it('PORTAL-PLAN-STALE surfaces a regenerate action — never a silent retry', async () => {
    const { fixture, api, c, el } = await setup({
      tasksExecute: vi.fn(() => throwError(STALE)),
    });
    c.intent.set('check env');
    await c.plan();
    fixture.detectChanges();
    await c.execute(PLAN.plan, 'tok-1');
    fixture.detectChanges();

    // dead token: pending plan dropped, stale card up, no ui-error path
    expect(c.pending()).toBeNull();
    expect(c.stale()?.body.code).toBe('PORTAL-PLAN-STALE');
    expect(c.error()).toBeNull();
    const staleCard = section(el, 'stale');
    expect(staleCard).toBeTruthy();
    expect(text(staleCard)).toContain('PORTAL-PLAN-STALE');
    expect(api.tasksExecute).toHaveBeenCalledTimes(1);

    // regenerate re-plans with the SAME intent — execute untouched
    staleCard!.querySelector<HTMLElement>('[data-action="regenerate"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.tasksPlan).toHaveBeenCalledTimes(2);
    expect(api.tasksPlan).toHaveBeenLastCalledWith({ intent: 'check env' });
    expect(api.tasksExecute).toHaveBeenCalledTimes(1);
    expect(c.stale()).toBeNull();
    expect(c.pending()?.plan_token).toBe('tok-1');
  });

  it('renders a refused receipt honestly — code, unlock, no fake success', async () => {
    const { fixture, c, el } = await setup({
      tasksExecute: () =>
        of({ status: 'refused', refusal: 'PORTAL-LOCKED', unlock: 'close the CLI' }),
    });
    c.intent.set('check env');
    await c.plan();
    await c.execute(PLAN.plan, 'tok-1');
    fixture.detectChanges();

    const receipt = section(el, 'receipt');
    expect(receipt).toBeTruthy();
    const refusal = receipt!.querySelector('.refusal');
    expect(refusal).toBeTruthy();
    expect(text(refusal)).toContain('PORTAL-LOCKED');
    expect(text(refusal)).toContain('close the CLI');
    expect(receipt!.querySelector('.badge[data-kind="ok"]')).toBeNull();
  });

  it('computes duration from real finished_at − started_at only', async () => {
    const { c, el } = await setup();
    expect(c.duration(TASKS[0]!)).toBe('1.5 s');
    expect(c.duration(TASKS[1]!)).toBe('—'); // running — no finished_at
    expect(
      c.duration({ ...TASKS[0]!, finished_at: '2026-10-13T00:00:00Z' }), // negative
    ).toBe('—');

    const rows = [...el.querySelectorAll('tbody tr')];
    expect(text(rows[0]!.querySelector('.num'))).toBe('1.5 s');
    expect(text(rows[1]!.querySelector('.num'))).toBe('—');
  });

  it('renders cancel as UNVERIFIED capability — a row, not a dead button', async () => {
    const { el } = await setup();
    const cancel = el.querySelector('[data-op="cancel"]');
    expect(cancel).toBeTruthy();
    expect(cancel!.getAttribute('data-state')).toBe('unverified');
    expect(cancel!.querySelector('ui-state-badge')).toBeTruthy();
    expect(cancel!.querySelector('button')).toBeNull();
    // plan/execute rows are marked supported
    expect(el.querySelector('[data-op="plan"] ui-state-badge')).toBeTruthy();
    expect(el.querySelector('[data-op="execute"] ui-state-badge')).toBeTruthy();
    // rate-limit + plan-token note present in the ops area
    expect(section(el, 'ops')!.querySelector('.limits')).toBeTruthy();
  });

  it('shows the error state when the task history fails to load', async () => {
    const { c, el } = await setup({
      tasks: () => throwError(() => new ApiError(503, { message: 'session store down' })),
    });
    expect(c.error()?.body.code).toBe('HTTP-503');
    expect(el.querySelector('ui-error')).toBeTruthy();
  });

  it('surfaces a planning failure via ui-error and keeps the flow clean', async () => {
    const { fixture, c, el } = await setup({
      tasksPlan: () => throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND' })),
    });
    c.intent.set('do x');
    await c.plan();
    fixture.detectChanges();
    expect(c.error()?.body.code).toBe('PORTAL-NOT-FOUND');
    expect(c.pending()).toBeNull();
    expect(el.querySelector('ui-error')).toBeTruthy();
  });
});

describe('TasksPage — execution timeline (Cycle 4)', () => {
  async function setup(overrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [TasksPage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(TasksPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('draws bars only from recorded timestamps — running task is an open bar', async () => {
    const { c, el } = await setup();
    const tl = c.timeline();
    expect(tl.rows.length).toBe(2);
    expect(tl.rows[0]!.task.id).toBe('t1');
    expect(tl.rows[1]!.endMs).toBeNull(); // running — open bar
    const section = el.querySelector('[data-section="timeline"]');
    expect(section).toBeTruthy();
    const bars = section!.querySelectorAll('.tl__bar');
    expect(bars.length).toBe(2);
    expect(bars[0]!.getAttribute('data-open')).toBeNull();
    expect(bars[1]!.getAttribute('data-open')).not.toBeNull();
    // durations come from real finished−started only
    expect(text(bars[0]!.closest('.tl__row')!.querySelector('.tl__dur'))).toContain('1.5 s');
    expect(text(bars[1]!.closest('.tl__row')!.querySelector('.tl__dur')).trim()).toBe('—');
  });

  it('marks the timeline partial when a record carries no usable started_at', async () => {
    const { c, el } = await setup({
      tasks: () => of([...TASKS, { ...TASKS[0]!, id: 'ghost', started_at: '', finished_at: null }]),
    });
    expect(c.timeline().partial).toBe(true);
    expect(c.timeline().unplaced.map((t) => t.id)).toEqual(['ghost']);
    const section = el.querySelector('[data-section="timeline"]')!;
    expect(section.querySelector('.badge')).toBeTruthy(); // PARTIAL badge
    expect(section.querySelector('[data-note="unplaced"]')).toBeTruthy();
    expect(text(section.querySelector('[data-note="unplaced"]'))).toContain('1');
  });

  it('is absent only when there are no task records at all', async () => {
    const { el } = await setup({ tasks: () => of([]) });
    expect(el.querySelector('[data-section="timeline"]')).toBeNull();
    expect(el.querySelector('[data-section="history"] ui-empty')).toBeTruthy();
  });
});

describe('TasksPage — recorded-events replay (Cycle 4)', () => {
  async function setup(overrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [TasksPage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(TasksPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('opens the task detail and replays only the events that share its correlation id', async () => {
    const { fixture, c, el } = await setup();
    c.selectTask(TASKS[0]!);
    fixture.detectChanges();

    const detail = section(el, 'task-detail');
    expect(detail).toBeTruthy();
    expect(text(detail)).toContain('t1');
    expect(text(detail)).toContain('corr-abc-123');

    const rep = c.replay();
    expect(rep.state).toBe('ready');
    expect(rep.steps.map((e) => e.status)).toEqual(['started', 'completed']);

    const replay = section(el, 'replay');
    expect(replay).toBeTruthy();
    const steps = replay!.querySelectorAll('.replay__step');
    expect(steps.length).toBe(2);
    expect(steps[0]!.getAttribute('data-current')).not.toBeNull();
    expect(text(steps[1])).toContain('install apply finished');

    // step through: next highlights the second recorded event
    replay!.querySelector<HTMLElement>('[data-action="next"]')!.click();
    fixture.detectChanges();
    expect(c.replayIdx()).toBe(1);
    expect(steps[1]!.getAttribute('data-current')).not.toBeNull();
  });

  it('says no-correlation when the task record carries no id — nothing invented', async () => {
    const { fixture, c, el } = await setup();
    c.selectTask(TASKS[1]!); // no correlation_id
    fixture.detectChanges();
    expect(c.replay().state).toBe('no-correlation');
    const replay = section(el, 'replay');
    expect(replay).toBeTruthy();
    expect(replay!.querySelector('[data-state="no-correlation"]')).toBeTruthy();
    expect(replay!.querySelectorAll('.replay__step').length).toBe(0);
  });

  it('is empty (not fabricated) when no recorded event shares the id', async () => {
    const { fixture, c, el } = await setup({
      tasks: () => of([{ ...TASKS[0]!, id: 't-x', correlation_id: 'no-events-for-me' }]),
    });
    c.selectTask(c.tasks()[0]!);
    fixture.detectChanges();
    expect(c.replay().state).toBe('empty');
    expect(section(el, 'replay')!.querySelector('[data-state="empty"]')).toBeTruthy();
  });

  it('reports UNVERIFIED when /metrics is absent on this adapter', async () => {
    const { fixture, c, el } = await setup({
      metrics: () => throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND' })),
    });
    c.selectTask(TASKS[0]!);
    fixture.detectChanges();
    expect(c.replay().state).toBe('unavailable');
    const replay = section(el, 'replay');
    expect(replay!.querySelector('[data-state="unavailable"]')).toBeTruthy();
    expect(text(replay)).toContain('UNVERIFIED');
    // the timeline itself does not depend on /metrics
    expect(el.querySelector('[data-section="timeline"]')).toBeTruthy();
  });

  it('selecting via the timeline row opens the same detail card', async () => {
    const { fixture, c, el } = await setup();
    const row = el.querySelector<HTMLElement>('[data-section="timeline"] .tl__row')!;
    row.click();
    fixture.detectChanges();
    expect(c.selectedId()).toBe('t1');
    expect(section(el, 'task-detail')).toBeTruthy();
  });

  it('renders history labels as real ?task= links — shareable deep links', async () => {
    const { el } = await setup();
    const link = el.querySelector<HTMLAnchorElement>('[data-action="inspect"]');
    expect(link).toBeTruthy();
    expect(link!.tagName).toBe('A');
    expect(link!.getAttribute('href')).toContain('task=t1');
    expect(text(link)).toContain('install apply');
  });

  it('a ?task= deep link selects the matching record — applied once per value', async () => {
    const { fixture, c, el } = await setup();
    fixture.componentRef.setInput('task', 't1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(c.selectedId()).toBe('t1');
    expect(section(el, 'task-detail')).toBeTruthy();
    expect(c.replay().state).toBe('ready');

    // closing stays closed while the same param value is still bound —
    // the effect must not re-open what the user dismissed
    c.selectedId.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(c.selectedId()).toBeNull();

    // a new value (same-page navigation) applies again
    fixture.componentRef.setInput('task', 't2');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(c.selectedId()).toBe('t2');
  });

  it('ignores a ?task= value that matches no record — nothing is fabricated', async () => {
    const { fixture, c, el } = await setup();
    fixture.componentRef.setInput('task', 'no-such-task');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(c.selectedId()).toBeNull();
    expect(section(el, 'task-detail')).toBeNull();
  });
});
