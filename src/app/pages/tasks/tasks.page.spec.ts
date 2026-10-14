import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TasksPage } from './tasks.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { InstallationReceipt, TaskExecution } from '../../core/api/api.models';

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

function fakeApi(overrides: Partial<Record<keyof PortalApi, unknown>> = {}): PortalApi {
  return {
    tasks: vi.fn(() => of(TASKS)),
    tasksPlan: vi.fn(() => of(PLAN)),
    tasksExecute: vi.fn(() => of(RECEIPT)),
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
      providers: [{ provide: PortalApi, useValue: api }],
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
