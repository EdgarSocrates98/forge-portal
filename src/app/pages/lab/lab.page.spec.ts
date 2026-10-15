import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { LabPage } from './lab.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { LabData } from '../../core/api/api.models';

const DATA: LabData = {
  dir: 'docs/programs/ecosystem-2026/benchmarks',
  runs: [
    {
      file: 'results-2026-10-14-A.jsonl',
      forges: [
        {
          forge: 'the-forge',
          status: 'ok',
          suite: 'the-forge-lab',
          mode: 'A',
          results: [
            { scenario_id: 'compat-manifest-parity', verdict: 'fail', duration_ms: 50 },
            { scenario_id: 'router-determinism', verdict: 'pass', duration_ms: 11 },
          ],
        },
      ],
    },
    {
      file: 'results-2026-10-15-A.jsonl',
      forges: [
        {
          forge: 'the-forge',
          status: 'ok',
          suite: 'the-forge-lab',
          mode: 'A',
          results: [
            {
              scenario_id: 'compat-manifest-parity',
              verdict: 'pass',
              duration_ms: 42,
              metrics: {
                components_total: { state: 'measured', value: 9, unit: 'count' },
                wall_ms: { state: 'measured', value: 42, unit: 'ms' },
              },
              detail: 'all components present',
            },
            {
              scenario_id: 'router-determinism',
              verdict: 'fail',
              duration_ms: 10,
              metrics: { quality: { state: 'not_available', unit: '', value: null } },
            },
          ],
        },
        { forge: 'spark-forge-aws', status: 'skipped', results: [] },
      ],
    },
  ],
  reports: [{ file: '2026-10-15-A.md', content: '# report\nbody' }],
  notes: ['line 7 malformed'],
};

function fakeApi(overrides: Partial<Record<keyof PortalApi, unknown>> = {}): PortalApi {
  return { lab: vi.fn(() => of(DATA)), ...overrides } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const section = (el: HTMLElement, name: string) =>
  el.querySelector(`[data-section="${name}"]`) as HTMLElement | null;

describe('LabPage', () => {
  async function setup(overrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [LabPage],
      providers: [{ provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(LabPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  it('renders run history with pass/fail counts', async () => {
    const { el } = await setup();
    const runs = section(el, 'runs');
    expect(runs).toBeTruthy();
    expect(text(runs)).toContain('results-2026-10-15-A.jsonl');
    expect(text(runs)).toContain('results-2026-10-14-A.jsonl');
  });

  it('renders scenario catalog rows with verdict and measured metrics', async () => {
    const { el } = await setup();
    const catalog = section(el, 'catalog');
    expect(text(catalog)).toContain('compat-manifest-parity');
    expect(text(catalog)).toContain('the-forge');
    expect(text(catalog)).toContain('components_total=9');
    expect(text(catalog)).toContain('PASS');
    expect(text(catalog)).toContain('FAIL');
  });

  it('not_available metrics render as dash, never a number', async () => {
    const { el } = await setup();
    const catalog = section(el, 'catalog');
    expect(text(catalog)).toContain('quality=—');
  });

  it('filters scenarios by forge', async () => {
    const { fixture, el } = await setup();
    fixture.componentInstance.forge.set('spark-forge-aws');
    fixture.detectChanges();
    const rows = el.querySelectorAll('[data-table="scenarios"] tbody tr');
    expect(rows.length).toBe(0); // skipped forge emitted no results — honest empty, not invented
    fixture.componentInstance.forge.set('the-forge');
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-table="scenarios"] tbody tr').length).toBe(2);
  });

  it('compares verdicts between two runs', async () => {
    const { fixture, el } = await setup();
    fixture.componentInstance.runA.set('results-2026-10-15-A.jsonl');
    fixture.componentInstance.runB.set('results-2026-10-14-A.jsonl');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const cmp = section(el, 'compare');
    expect(cmp).toBeTruthy();
    expect(text(cmp)).toContain('router-determinism');
  });

  it('renders reports and collector notes verbatim', async () => {
    const { el } = await setup();
    expect(text(section(el, 'reports'))).toContain('2026-10-15-A.md');
    expect(text(section(el, 'notes'))).toContain('line 7 malformed');
  });

  it('shows explicit empty state when no runs exist', async () => {
    const { el } = await setup({
      lab: vi.fn(() => of({ dir: 'x', runs: [], reports: [], notes: [] })),
    });
    expect(section(el, 'empty')).toBeTruthy();
    expect(text(section(el, 'empty'))).toContain('Sem dados');
    expect(section(el, 'catalog')).toBeNull();
  });

  it('shows UNVERIFIED when the adapter lacks /lab (404)', async () => {
    const { el } = await setup({
      lab: vi.fn(() =>
        throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no route' })),
      ),
    });
    expect(section(el, 'unavailable')).toBeTruthy();
    expect(text(section(el, 'unavailable'))).toContain('UNVERIFIED');
  });
});
