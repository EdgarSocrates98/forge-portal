import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SpecialistsPage } from './specialists.page';
import { PortalApi } from '../../core/api/api.client';
import { I18nService } from '../../core/i18n/i18n.service';
import { PortalSpecialistsReport } from '../../core/api/api.models';

const REPORT: PortalSpecialistsReport = {
  schema: 'theforge/PortalSpecialists/v1',
  availability: { state: 'available', probed: false },
  generated_at: '2026-10-20T00:00:00Z',
  probed: false,
  truncated: false,
  limitations: [],
  specialists: [
    {
      provider: 'spark-forge-aws',
      state: 'DISCOVERED',
      version: '0.5.0',
      checks: { handshake: 'SKIP' },
      notes: [],
      limitations: [],
      capabilities: [
        {
          id: 'sentinel.databricks-logs',
          description: 'logs',
          execution_mode: 'local',
          risk: 'read_only',
          requires: ['logs'],
          external_cost: 'none',
        },
      ],
      capability_count: 1,
      compatibility: { state: 'unverified', detail: '' },
      relations: {
        declared: {
          family: 'spark-engineering',
          composes_with: ['forge-doctor-data'],
          preferred_verifiers: [],
          fallback: [],
        },
      },
      last_check: '2026-10-20T00:00:00Z',
    },
    {
      provider: 'data-sentinel-forge',
      state: 'NOT_INSTALLED',
      version: 'unknown',
      checks: {},
      notes: [],
      limitations: [],
      capabilities: [],
      capability_count: 0,
      compatibility: { state: 'unverified', detail: '' },
      relations: { declared: { family: 'verification' } },
      last_check: '2026-10-20T00:00:00Z',
    },
  ],
};

function fakeApi(overrides: Partial<Record<keyof PortalApi, unknown>> = {}): PortalApi {
  return {
    specialists: vi.fn(() => of(REPORT)),
    ...overrides,
  } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';

describe('SpecialistsPage', () => {
  async function setup(overrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [SpecialistsPage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(SpecialistsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  it('renders every specialist row with verbatim state, version and counts', async () => {
    const { el } = await setup();
    expect(text(el)).toContain('spark-forge-aws');
    expect(text(el)).toContain('data-sentinel-forge');
    expect(text(el)).toContain('0.5.0');
    expect(text(el)).toContain('DISCOVERED');
    expect(text(el)).toContain('Not installed');
    expect(text(el)).toContain('2026-10-20T00:00:00Z');
  });

  it('surfaces the not-probed limitation honestly', async () => {
    const { el } = await setup();
    expect(text(el)).toContain('did not probe');
  });

  it('expands a row into declared relations and capabilities', async () => {
    const { el, fixture } = await setup();
    const head = el.querySelector('.spec__head') as HTMLButtonElement;
    head.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el)).toContain('sentinel.databricks-logs');
    expect(text(el)).toContain('spark-engineering');
    expect(text(el)).toContain('forge-doctor-data');
  });

  it('renders the named empty state when no specialists exist', async () => {
    const { el } = await setup({
      specialists: vi.fn(() => of({ ...REPORT, specialists: [] })),
    });
    expect(text(el)).toContain('No specialists');
  });
});
