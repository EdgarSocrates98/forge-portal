import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { DelegationsPage } from './delegations.page';
import { PortalApi } from '../../core/api/api.client';
import { I18nService } from '../../core/i18n/i18n.service';
import { DelegationGraphReport, PortalDelegationsReport } from '../../core/api/api.models';

const RUNS: PortalDelegationsReport = {
  schema: 'theforge/PortalDelegations/v1',
  availability: { state: 'available' },
  notes: [],
  runs: [
    {
      file: 'corr-1-2026-10-20T00-00-00Z.json',
      correlation_id: 'corr-1',
      kind: 'run',
      intent: 'diagnose spark job',
      generated_at: '2026-10-20T00:00:00Z',
      plan_status: 'planned',
      duration_ms: null,
      prior_runs_same_intent: 1,
      entries: [
        {
          coordinator: 'the-forge',
          specialist: 'spark-forge-aws',
          capability: 'sentinel.databricks-logs',
          status: 'completed',
          finding_class: 'RUNTIME',
          risks: ['LOCAL_READ'],
          cost_bearing: false,
          justification: ['intent matched'],
          command: ['sentinel', 'scan'],
          delegation_stage: 'executed',
          handoff_status: 'received',
          notes: [],
        },
      ],
      findings: [
        {
          id: 'F-1',
          finding_class: 'RUNTIME',
          severity: 'high',
          confidence: 'confirmed',
          summary: 'skew detected',
          providers: ['spark-forge-aws'],
          correlated: false,
        },
      ],
      unresolved: [{ code: 'insufficient-evidence', detail: 'no event log', provider: 'x' }],
      recommended: [],
      limitations: [],
      unknowns: [],
    },
  ],
};

const GRAPH: DelegationGraphReport = {
  schema: 'theforge/PortalDelegationGraph/v1',
  availability: { state: 'available', declared: 'available', observed_reports: 1 },
  notes: [],
  views: [
    {
      nodes: [
        { id: 'delegation:corr-1', kind: 'delegation' },
        { id: 'execution:c', kind: 'execution' },
      ],
      edges: [
        {
          source: 'delegation:corr-1',
          target: 'execution:c',
          kind: 'delegation-execution',
          provenance: 'observed',
        },
        {
          source: 'family:spark',
          target: 'specialist:spark-forge-aws',
          kind: 'forge-specialist',
          provenance: 'declared',
        },
      ],
      edge_kinds: ['delegation-execution', 'forge-specialist'],
      provenances: ['declared', 'observed'],
    },
  ],
};

function fakeApi(overrides: Partial<Record<keyof PortalApi, unknown>> = {}): PortalApi {
  return {
    delegations: vi.fn(() => of(RUNS)),
    delegationsGraph: vi.fn(() => of(GRAPH)),
    ...overrides,
  } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';

describe('DelegationsPage', () => {
  async function setup(overrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [DelegationsPage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(DelegationsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  it('renders run history verbatim with revalidation marker', async () => {
    const { el } = await setup();
    expect(text(el)).toContain('diagnose spark job');
    expect(text(el)).toContain('corr-1');
    expect(text(el)).toContain('revalidation #1');
    expect(text(el)).toContain('planned');
  });

  it('expands a run into the full delegation chain', async () => {
    const { el, fixture } = await setup();
    (el.querySelector('.run__head') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    const body = text(el);
    for (const part of ['the-forge', 'spark-forge-aws', 'sentinel.databricks-logs', 'executed', 'received', 'completed', 'unavailable']) {
      expect(body).toContain(part);
    }
    expect(body).toContain('skew detected');
    expect(body).toContain('insufficient-evidence');
  });

  it('renders relation edges grouped by kind with provenance verbatim', async () => {
    const { el } = await setup();
    expect(text(el)).toContain('delegation-execution');
    expect(text(el)).toContain('forge-specialist');
    expect(text(el)).toContain('observed');
    expect(text(el)).toContain('declared');
  });

  it('renders the named empty state when no reports exist', async () => {
    const { el } = await setup({
      delegations: vi.fn(() =>
        of({ ...RUNS, runs: [], availability: { state: 'no_delegations', detail: 'none' } }),
      ),
    });
    expect(text(el)).toContain('No delegations yet');
  });
});
