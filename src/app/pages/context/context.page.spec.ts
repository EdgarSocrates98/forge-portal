import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ContextPage } from './context.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { PortalEvent, WorkspaceResources } from '../../core/api/api.models';

const WS: WorkspaceResources = {
  workspace: '/ws',
  forges: ['the-forge'],
  members: [],
  resources: [
    {
      forge_id: 'the-forge',
      id: 'a',
      kind: 'skill',
      resource_class: 'agentic',
      availability: 'available',
      unavailable_reason: null,
      location: 'x',
      tags: [],
      description: null,
      format: null,
    },
    {
      forge_id: 'the-forge',
      id: 'b',
      kind: 'knowledge',
      resource_class: 'read-only',
      availability: 'unavailable',
      unavailable_reason: 'not shipped',
      location: null,
      tags: [],
      description: null,
      format: null,
    },
  ],
  errors: [],
};

const EVENTS: PortalEvent[] = [
  {
    schema: 'forge/PortalEvent/1',
    event_type: 'operation.start',
    status: 'started',
    target: '/resources',
    metadata: { mutating: false, cache: 'hit' },
  },
  {
    schema: 'forge/PortalEvent/1',
    event_type: 'cache.store',
    target: '/resources',
    metadata: { cache: 'miss' },
  },
  {
    schema: 'forge/PortalEvent/1',
    event_type: 'cache.store',
    target: '/hosts',
    metadata: { cache: 'bypass' },
  },
  {
    schema: 'forge/PortalEvent/1',
    event_type: 'operation.end',
    status: 'refused',
    target: '/registry/execute',
    duration_ms: 3,
  },
  {
    schema: 'forge/PortalEvent/1',
    event_type: 'operation.end',
    status: 'ok',
    target: '/resources',
    duration_ms: 12,
  },
];

const REPORT = {
  schema: 'forge/PortalEventReport/1' as const,
  generated_at: '2026-01-01T00:00:00Z',
  count: EVENTS.length,
  dropped: 0,
  truncated: false,
  capacity: 512,
  counters: {},
  events: EVENTS,
};

function setup(failEvents = false) {
  const api = {
    workspaceResources: () => of(WS),
    events: () => (failEvents ? throwError(() => new ApiError(404)) : of(REPORT)),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
  });
  return TestBed.createComponent(ContextPage).componentInstance;
}

describe('ContextPage', () => {
  it('counts discovered resources and keeps unavailable reasons', async () => {
    const p = setup();
    await p.load();
    const ws = p.resSrc.data()!;
    expect(ws.resources.length).toBe(2);
    expect(p.unavailableCount(ws.resources)).toBe(1);
    expect(p.unavailableEntries(ws.resources)[0].unavailable_reason).toBe('not shipped');
    expect(p.byKind(ws.resources)).toEqual([
      { kind: 'knowledge', count: 1 },
      { kind: 'skill', count: 1 },
    ]);
  });

  it('derives cache rows only from recorded hit/miss/bypass events', async () => {
    const p = setup();
    await p.load();
    const rows = p.cacheRows(EVENTS);
    expect(rows).toEqual([
      { target: '/hosts', hit: 0, miss: 0, bypass: 1 },
      { target: '/resources', hit: 1, miss: 1, bypass: 0 },
    ]);
  });

  it('failures are recorded refused/timeout/failed records only', async () => {
    const p = setup();
    await p.load();
    const f = p.failures(EVENTS);
    expect(f.length).toBe(1);
    expect(f[0].status).toBe('refused');
  });

  it('a missing /events op degrades honestly (UNVERIFIED), inventory intact', async () => {
    const p = setup(true);
    await p.load();
    expect(p.evSrc.unavailable()).toBe(true);
    expect(p.resSrc.data()?.resources.length).toBe(2);
  });
});
