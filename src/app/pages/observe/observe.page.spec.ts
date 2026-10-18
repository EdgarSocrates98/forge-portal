import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ObservePage } from './observe.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { MetricsReport } from '../../core/api/api.models';

const REPORT: MetricsReport = {
  generated_at: '2026-01-03T12:00:00Z',
  counters: { 'tasks.completed': 4, 'installs.failed': 1, 'verify.ok': 9 },
  events: [
    {
      kind: 'task',
      at: '2026-01-03T11:00:00Z',
      duration_ms: 1200,
      status: 'completed',
      origin: 'cli',
      correlation_id: 'corr-abc123def456',
      detail: 'ran doctor checks',
    },
    {
      kind: 'install',
      at: '2026-01-02T09:00:00Z',
      duration_ms: null,
      status: 'failed',
      origin: 'portal',
      correlation_id: null,
    },
    {
      kind: 'task',
      at: '2026-01-03T10:00:00Z',
      duration_ms: 40,
      status: 'running',
      origin: 'mcp',
      correlation_id: 'short',
    },
  ],
  truncated: true,
};

function fakeApi(overrides: Partial<Record<keyof PortalApi, unknown>> = {}): PortalApi {
  return {
    metrics: vi.fn(() => of(REPORT)),
    ...overrides,
  } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const section = (el: HTMLElement, name: string) =>
  el.querySelector(`[data-section="${name}"]`) as HTMLElement | null;
const rows = (el: HTMLElement) => [...el.querySelectorAll('tbody tr')];

/** Drive a <select data-filter> to a value and dispatch change. */
function setFilter(el: HTMLElement, name: string, value: string): void {
  const sel = el.querySelector<HTMLSelectElement>(`select[data-filter="${name}"]`);
  expect(sel).toBeTruthy();
  sel!.value = value;
  sel!.dispatchEvent(new Event('change'));
}

describe('ObservePage', () => {
  async function setup(
    overrides: Partial<Record<keyof PortalApi, unknown>> = {},
    inputs: Record<string, unknown> = {},
  ) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [ObservePage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(ObservePage);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  it('renders real counters and events sorted by `at` descending', async () => {
    const { el } = await setup();

    // counters grid — every reported key, sorted by name
    const counters = section(el, 'counters');
    expect(counters?.querySelectorAll('.counter').length).toBe(3);
    expect(text(counters?.querySelector('[data-counter="tasks.completed"]'))).toContain('4');
    expect(text(counters?.querySelector('[data-counter="installs.failed"]'))).toContain('1');
    const keys = [...counters!.querySelectorAll('.counter__key')].map((n) => text(n).trim());
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));

    // events table — deterministic newest-first order
    const trs = rows(section(el, 'events')!);
    expect(trs.length).toBe(3);
    expect(text(trs[0])).toContain('completed'); // 11:00 newest
    expect(text(trs[1])).toContain('running'); // 10:00
    expect(text(trs[2])).toContain('failed'); // 09:00 previous day
    expect(text(trs[0])).toContain('cli');
    expect(text(trs[0])).toContain('1200 ms');
  });

  it('renders null duration/correlation/detail as honest placeholders', async () => {
    const { el } = await setup();
    const failedRow = rows(section(el, 'events')!).find((tr) => text(tr).includes('install'))!;

    // duration_ms null → '—', correlation_id null → '—', no detail → '—'
    expect(failedRow.querySelectorAll('td .muted').length).toBeGreaterThanOrEqual(3);
    expect(text(failedRow)).not.toContain('NaN');
    expect(failedRow.querySelector('code.corr')).toBeNull();

    // a real correlation id renders truncated mono + full title
    const taskRow = rows(section(el, 'events')!).find((tr) => text(tr).includes('completed'))!;
    const corr = taskRow.querySelector<HTMLElement>('code.corr');
    expect(corr?.getAttribute('title')).toBe('corr-abc123def456');
    expect(text(corr)).toContain('…');
    expect(text(corr).trim().length).toBeLessThan('corr-abc123def456'.length);
  });

  it('maps event status onto badge tone without rewriting the label', async () => {
    const { el } = await setup();
    const events = section(el, 'events')!;
    const badge = (status: string) =>
      rows(events)
        .find((tr) => text(tr).includes(status))
        ?.querySelector('.badge');

    expect(badge('completed')?.getAttribute('data-kind')).toBe('ok');
    expect(badge('failed')?.getAttribute('data-kind')).toBe('error');
    expect(badge('running')?.getAttribute('data-kind')).toBe('info');
    // the raw adapter status is the label — never translated away
    expect(text(badge('completed'))).toContain('completed');
  });

  it('filters by kind and status client-side, including the zero-match case', async () => {
    const { el, fixture } = await setup();
    const events = section(el, 'events')!;

    setFilter(events, 'kind', 'task');
    fixture.detectChanges();
    expect(rows(events).length).toBe(2);
    // the select still offers 'install' as an option — only rows are filtered
    expect(text(events.querySelector('tbody'))).not.toContain('install');

    setFilter(events, 'status', 'running');
    fixture.detectChanges();
    expect(rows(events).length).toBe(1);
    expect(text(events)).toContain('mcp');

    // filters that exclude everything show a distinct "no matches" state
    setFilter(events, 'status', 'failed');
    fixture.detectChanges();
    expect(rows(events).length).toBe(0);
    expect(events.querySelector('ui-empty[data-empty="no-matches"]')).toBeTruthy();

    // clearing filters restores the full window
    setFilter(events, 'kind', '');
    setFilter(events, 'status', '');
    fixture.detectChanges();
    expect(rows(events).length).toBe(3);
  });

  it('seeds the correlation filter from the ?cid= route input', async () => {
    const { el, fixture } = await setup({}, { cid: 'corr-abc123def456' });
    expect(fixture.componentInstance.corrFilter()).toBe('corr-abc123def456');
    const trs = rows(section(el, 'events')!);
    expect(trs.length).toBe(1);
    expect(text(trs[0])).toContain('completed');
    // the filter input visibly reflects the seeded value
    const input = el.querySelector<HTMLInputElement>('input[data-filter="correlation"]');
    expect(input?.value).toBe('corr-abc123def456');
  });

  it('shows the bounded-window note when the report is truncated', async () => {
    const { el } = await setup();
    expect(el.querySelector('[data-note="truncated"]')).toBeTruthy();
  });

  it('hides the bounded-window note when the report is not truncated', async () => {
    const { el } = await setup({
      metrics: () => of({ ...REPORT, truncated: false }),
    });
    expect(el.querySelector('[data-note="truncated"]')).toBeNull();
  });

  it('always shows the local-only scope note', async () => {
    const { el } = await setup();
    const note = section(el, 'local-only');
    expect(note).toBeTruthy();
    expect(note!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('marks the whole capability UNVERIFIED on 404 / PORTAL-NOT-FOUND', async () => {
    const { el } = await setup({
      metrics: () =>
        throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
    });

    const unv = section(el, 'unavailable');
    expect(unv).toBeTruthy();
    expect(text(unv)).toContain('UNVERIFIED');
    // never an empty-looking success: no counters, no table, no error crash
    expect(section(el, 'counters')).toBeNull();
    expect(section(el, 'events')).toBeNull();
    expect(el.querySelector('ui-empty')).toBeNull();
    expect(el.querySelector('ui-error')).toBeNull();
    // the local-only scope note still applies
    expect(section(el, 'local-only')).toBeTruthy();
  });

  it('renders a retryable error state for non-404 failures', async () => {
    const { el, api, fixture } = await setup({
      metrics: vi
        .fn()
        .mockImplementationOnce(() => throwError(() => new ApiError(500, { message: 'boom' })))
        .mockImplementation(() => of(REPORT)),
    });

    expect(el.querySelector('ui-error')).toBeTruthy();
    el.querySelector<HTMLElement>('ui-error button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.metrics).toHaveBeenCalledTimes(2);
    expect(rows(section(el, 'events')!).length).toBe(3);
  });

  it('distinguishes a real empty report from the unverified state', async () => {
    const { el } = await setup({
      metrics: () => of({ ...REPORT, counters: {}, events: [], truncated: false }),
    });

    // answered-with-nothing → honest empty state, not UNVERIFIED
    expect(section(el, 'unavailable')).toBeNull();
    const events = section(el, 'events')!;
    expect(events.querySelector('ui-empty[data-empty="events"]')).toBeTruthy();
    expect(events.querySelector('ui-error')).toBeNull();
    // no filter controls when there is nothing to filter
    expect(events.querySelector('select[data-filter]')).toBeNull();
    // empty counters render as none, not as a fake grid
    expect(text(section(el, 'counters'))).toContain('None');
  });
});
