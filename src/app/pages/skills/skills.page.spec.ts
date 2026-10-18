import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { SkillsPage } from './skills.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { PortalStore } from '../../core/portal/portal.store';
import { PREFS_KEY } from '../../core/prefs/prefs.store';
import { SkillDescriptor } from '../../core/api/api.models';

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
  {
    // same normalized name + identical description → possible-duplicate
    id: 'glue-etl-copy',
    name: 'Glue ETL',
    domain: 'data',
    description: 'PySpark Glue ETL authoring.',
    state: 'available',
    hosts: [],
    source: 'catalog',
  },
  {
    // same name, different content → same-name-different-entity
    id: 'deploy-a',
    name: 'deploy',
    domain: 'ops',
    description: 'cluster bootstrap pipeline',
    state: 'available',
    hosts: [],
    source: 'catalog',
  },
  {
    id: 'deploy-b',
    name: 'deploy',
    domain: 'ops',
    description: 'quantum firewall orchestration suite',
    state: 'available',
    hosts: [],
    source: 'catalog',
  },
  {
    id: 'kiro-spec',
    name: 'kiro-spec',
    domain: 'spec',
    description: 'Spec workflow phases.',
    state: 'available',
    hosts: ['claude'],
    source: 'catalog',
  },
];

function setup(apiOverrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
  const api = {
    skills: vi.fn(() => of(SKILLS)),
    ...apiOverrides,
  };
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    // jsdom without storage
  }
  TestBed.configureTestingModule({
    imports: [SkillsPage],
    providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
  });
  return { api };
}

async function make() {
  const fixture = TestBed.createComponent(SkillsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const badgeTexts = (root: ParentNode) =>
  [...root.querySelectorAll('ui-state-badge .badge')].map((b) => (b.textContent ?? '').trim());

describe('SkillsPage — Skills Studio', () => {
  it('renders every real catalog row — duplicates are flagged, never merged', async () => {
    setup();
    const el = (await make()).nativeElement as HTMLElement;
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(5);
    expect(el.textContent).toContain('glue-etl');
    expect(el.textContent).toContain('kiro-spec');
  });

  it('filters by domain chip and by free text', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(c.domainOptions()).toEqual(['data', 'ops', 'spec']);
    c.toggleDomain('data');
    expect(c.filtered().map((s) => s.id)).toEqual(['glue-etl', 'glue-etl-copy']);
    c.toggleDomain('data');
    c.query.set('spec workflow');
    expect(c.filtered().map((s) => s.id)).toEqual(['kiro-spec']);
  });

  it('reports both dedup warning classes with pair evidence', async () => {
    setup();
    const fixture = await make();
    const findings = fixture.componentInstance.findings();
    expect(findings.length).toBe(2);
    const possible = findings.find((f) => f.kind === 'possible-duplicate');
    const different = findings.find((f) => f.kind === 'same-name-different-entity');
    expect(possible?.entries.map((e) => e.id)).toEqual(['glue-etl', 'glue-etl-copy']);
    expect(different?.entries.map((e) => e.id)).toEqual(['deploy-a', 'deploy-b']);
    expect(different?.pairs[0].verdict).toBe('same-name-different-entity');
    // the section renders with both warning badges
    fixture.detectChanges();
    const section = fixture.nativeElement.querySelector('[data-section="dedup"]');
    expect(section).toBeTruthy();
    expect(badgeTexts(section).length).toBeGreaterThanOrEqual(2);
    // colliding rows carry the data-dup edge
    expect(fixture.nativeElement.querySelectorAll('tr[data-dup]').length).toBe(4);
  });

  it('marks adapter-absent fields UNVERIFIED in the detail', async () => {
    setup();
    const fixture = await make();
    fixture.componentInstance.selected.set(SKILLS[0]);
    fixture.detectChanges();
    const detail = fixture.nativeElement.querySelector('[data-section="skill-detail"]');
    expect(detail).toBeTruthy();
    const text = detail.textContent ?? '';
    expect(text).toContain('glue-etl');
    expect(text).toContain('GET /api/v1/skills');
    expect(text).toContain('catalog'); // source evidence
    // version, prerequisites, file validation, deps, actions, hosts
    const unv = badgeTexts(detail).filter((t) => t === 'UNVERIFIED');
    expect(unv.length).toBeGreaterThanOrEqual(5);
    expect(text).not.toContain('undefined');
  });

  it('seeds the search from the ?q= route input', async () => {
    setup();
    const fixture = TestBed.createComponent(SkillsPage);
    fixture.componentRef.setInput('q', 'glue');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.query()).toBe('glue');
    expect(fixture.componentInstance.filtered().map((s) => s.id)).toEqual([
      'glue-etl',
      'glue-etl-copy',
    ]);
  });

  it('renders the error state when the catalog cannot load', async () => {
    setup({ skills: () => throwError(() => new ApiError(0)) });
    const fixture = await make();
    expect(fixture.nativeElement.querySelector('ui-error')).toBeTruthy();
  });

  it('keeps the origin row honest when no descriptor is bootstrapped', async () => {
    setup();
    // no PortalStore.bootstrap() → descriptor null → origin UNVERIFIED
    expect(TestBed.inject(PortalStore).descriptor()).toBeNull();
    const fixture = await make();
    fixture.componentInstance.selected.set(SKILLS[0]);
    fixture.detectChanges();
    const detail = fixture.nativeElement.querySelector('[data-section="skill-detail"]');
    expect(badgeTexts(detail)).toContain('UNVERIFIED');
  });
});
