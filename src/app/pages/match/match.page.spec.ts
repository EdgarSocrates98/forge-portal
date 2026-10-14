import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatchPage } from './match.page';
import { MatchService } from '../../core/match/match.service';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { PortalStore } from '../../core/portal/portal.store';
import { AgentDescriptor, BootstrapPayload, SkillDescriptor } from '../../core/api/api.models';

const AGENTS: AgentDescriptor[] = [
  {
    id: 'spark-runner',
    name: 'Spark Runner',
    role: 'glue etl executor',
    description: 'Runs PySpark Glue jobs on EMR.',
    authority: null,
    domains: ['data'],
    skills: ['glue-etl'],
    hosts: [],
    state: 'available',
  },
];

const SKILLS: SkillDescriptor[] = [
  {
    id: 'glue-etl',
    name: 'glue-etl',
    domain: 'data',
    description: 'PySpark Glue ETL authoring.',
    state: 'available',
    hosts: [],
    source: 'catalog',
  },
];

const BOOTSTRAP: BootstrapPayload = {
  descriptor: {
    forge_id: 'the-forge',
    forge_name: 'The Forge',
    forge_version: '1.0.0',
    cli: 'theforge',
    theme: 'the-forge',
    portal_version: '0.9.0',
    federated: true,
    capabilities: [],
    nav: [],
  },
  health: { state: 'VERIFIED', checks: [], workspace: null, profile: null, updated_at: null },
};

function fakeApi(overrides: Partial<PortalApi> = {}): PortalApi {
  return {
    bootstrap: () => of(BOOTSTRAP),
    installationStatus: () => of(BOOTSTRAP.health),
    agents: () => of(AGENTS),
    skills: () => of(SKILLS),
    mcpServers: () => of([]),
    federation: () =>
      of({
        specialists: [{ provider: 'spark-forge-aws', state: 'INSTALLED', cli: 'sparkforge' }],
        installed_forges: ['the-forge', 'spark-forge-aws'],
        registry: { count: 2, path: 'x' },
        summary: { catalog: 1, installed: 2, with_mcp: 0, with_checkout: 0 },
      }),
    ...overrides,
  } as unknown as PortalApi;
}

async function setup(overrides: Partial<PortalApi> = {}) {
  TestBed.configureTestingModule({
    imports: [MatchPage],
    providers: [provideRouter([]), { provide: PortalApi, useValue: fakeApi(overrides) }],
  });
  await TestBed.inject(PortalStore).bootstrap();
  const fixture = TestBed.createComponent(MatchPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('MatchPage — capability matching', () => {
  it('groups hits by kind with field-level evidence', async () => {
    const fixture = await setup();
    const svc = fixture.componentInstance.svc;
    await svc.searchNow('glue');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const kinds = [...el.querySelectorAll('.group')].map((g) => g.getAttribute('data-kind'));
    expect(kinds).toContain('agent');
    expect(kinds).toContain('skill');
    // evidence rows show the real matched field + value + tokens
    const ev = el.querySelector('.ev');
    expect(ev?.textContent).toContain('glue');
    expect(el.querySelectorAll('.ev__field').length).toBeGreaterThan(0);
    // every hit carries a warn-kind limitations badge (runtime unverified)
    const hits = el.querySelectorAll('article.hit');
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const h of hits) {
      expect(h.querySelector('.badge[data-kind="warn"]')).toBeTruthy();
    }
  });

  it('narrows groups through the kind chips', async () => {
    const fixture = await setup();
    const svc = fixture.componentInstance.svc;
    await svc.searchNow('glue');
    fixture.componentInstance.filter.set('skill');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const kinds = [...el.querySelectorAll('.group')].map((g) => g.getAttribute('data-kind'));
    expect(kinds).toEqual(['skill']);
  });

  it('shows the honest empty state for an unmatched capability', async () => {
    const fixture = await setup();
    const svc = fixture.componentInstance.svc;
    await svc.searchNow('nonexistent-zzz');
    fixture.componentInstance.query.set('nonexistent-zzz');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ui-empty')).toBeTruthy();
    expect(el.querySelectorAll('.group').length).toBe(0);
  });

  it('marks a kind chip unverified when its source fails', async () => {
    const fixture = await setup({ agents: () => throwError(() => new ApiError(0)) });
    const svc = fixture.componentInstance.svc;
    await svc.searchNow('glue');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const chip = el.querySelector('.fg-pill[data-unverified]');
    expect(chip).toBeTruthy();
    // agents kind is absent from results but flagged, not silent
    expect(svc.unverified()).toContain('agent');
  });

  it('forwards the search box to the debounced service query', async () => {
    const fixture = await setup();
    const svc = fixture.componentInstance.svc;
    const spy = vi.spyOn(svc, 'setQuery');
    fixture.componentInstance.query.set('new query');
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledWith('new query');
  });
});
