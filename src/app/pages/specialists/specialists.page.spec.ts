import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { SpecialistsPage } from './specialists.page';
import { PortalApi } from '../../core/api/api.client';
import { SpecialistsReport } from '../../core/api/api.models';

const REP: SpecialistsReport = {
  schema: 'theforge/PortalSpecialists/v1',
  availability: { state: 'available', detail: null, probed: false },
  generated_at: '2026-01-01T00:00:00Z',
  probed: false,
  specialists: [
    {
      provider: 'api-forge',
      state: 'declared',
      version: '0.4.0',
      capabilities: [{ id: 'api-review' }, { id: 'api-scan' }],
      capability_count: 2,
      relations: { declared: { family: 'api', composes_with: ['doctordata'] } },
      last_check: '2026-01-01T00:00:00Z',
    },
    {
      provider: 'doctordata',
      state: 'declared',
      capabilities: [{ id: 'doctor' }],
      capability_count: 1,
    },
  ],
};

describe('SpecialistsPage', () => {
  function setup(rep = REP) {
    const api = { specialists: () => of(rep) };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
    });
    return TestBed.createComponent(SpecialistsPage).componentInstance;
  }

  it('renders the verbatim discovery report', async () => {
    const p = setup();
    await p.load();
    expect(p.report()?.specialists.length).toBe(2);
    expect(p.report()?.probed).toBe(false);
    expect(p.filtered().length).toBe(2);
  });

  it('filters by provider and capability id', async () => {
    const p = setup();
    await p.load();
    p.q.set('api-scan');
    expect(p.filtered().map((s) => s.provider)).toEqual(['api-forge']);
    p.q.set('doctor');
    expect(p.filtered().map((s) => s.provider)).toEqual(['doctordata']);
  });

  it('declared relations come only from the report', async () => {
    const p = setup();
    await p.load();
    const s = p.report()!.specialists[0];
    expect(p.declared(s)?.composes_with).toEqual(['doctordata']);
    expect(p.declared(p.report()!.specialists[1])).toBeNull();
  });
});
