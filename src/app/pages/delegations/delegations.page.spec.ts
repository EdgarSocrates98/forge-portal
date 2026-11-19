import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { DelegationsPage } from './delegations.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { DelegationGraph, DelegationsReport } from '../../core/api/api.models';

const REP: DelegationsReport = {
  schema: 'theforge/PortalDelegations/v1',
  availability: { state: 'available', detail: null },
  runs: [
    {
      file: 'a.json',
      correlation_id: 'cid-1',
      intent: 'api review',
      generated_at: '2026-01-01T00:00:00Z',
      plan_status: 'completed',
      duration_ms: null, // not persisted — honest gap
      entries: [
        {
          coordinator: 'the-forge',
          specialist: 'api-forge',
          capability: 'api-review',
          status: 'completed',
          risks: [],
          cost_bearing: false,
          delegation_stage: 'planned',
          handoff_status: 'delivered',
        },
      ],
      prior_runs_same_intent: 2,
    },
  ],
};

const GRAPH: DelegationGraph = {
  schema: 'theforge/PortalDelegationGraph/v1',
  availability: { state: 'available', declared: 'available', observed_reports: 1 },
  views: [
    {
      nodes: [
        { id: 'specialist:api-forge', kind: 'specialist' },
        { id: 'capability:api-forge:api-review', kind: 'capability' },
      ],
      edges: [
        {
          source: 'specialist:api-forge',
          target: 'capability:api-forge:api-review',
          kind: 'agent-capability',
          provenance: 'declared',
        },
      ],
      edge_kinds: ['agent-capability'],
      provenances: ['declared'],
    },
  ],
};

describe('DelegationsPage', () => {
  function setup(withGraph = true) {
    const api = {
      delegations: () => of(REP),
      delegationsGraph: () => (withGraph ? of(GRAPH) : throwError(() => new ApiError(404))),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    });
    return TestBed.createComponent(DelegationsPage).componentInstance;
  }

  it('renders persisted runs verbatim — duration null stays null', async () => {
    const p = setup();
    await p.load();
    const run = p.report()!.runs[0];
    expect(run.correlation_id).toBe('cid-1');
    expect(run.duration_ms).toBeNull();
    expect(run.prior_runs_same_intent).toBe(2);
    expect(run.entries?.[0].specialist).toBe('api-forge');
  });

  it('renders graph edges with provenance', async () => {
    const p = setup();
    await p.load();
    expect(p.view()?.edges.length).toBe(1);
    expect(p.view()?.edges[0].provenance).toBe('declared');
    expect(p.graph()?.availability.observed_reports).toBe(1);
  });

  it('missing graph op degrades only the graph section', async () => {
    const p = setup(false);
    await p.load();
    expect(p.gSrc.unavailable()).toBe(true);
    expect(p.report()?.runs.length).toBe(1);
  });
});
