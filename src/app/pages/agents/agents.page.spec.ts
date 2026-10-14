import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { AgentsPage } from './agents.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { PortalStore } from '../../core/portal/portal.store';
import { AgentDescriptor, BootstrapPayload } from '../../core/api/api.models';

const AGENTS: AgentDescriptor[] = [
  {
    id: 'kiro-review',
    name: 'Kiro Review',
    role: 'adversarial reviewer',
    description: 'Reviews specs adversarially.',
    authority: null,
    domains: ['spec', 'review'],
    skills: ['kiro-spec'],
    hosts: [],
    state: 'available',
  },
  {
    id: 'spark-runner',
    name: 'Spark Runner',
    role: 'glue executor',
    description: 'Runs PySpark Glue jobs.',
    authority: null,
    domains: ['data'],
    skills: ['glue-etl'],
    hosts: ['devin'],
    state: 'available',
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

function setup(apiOverrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
  const api = {
    bootstrap: vi.fn(() => of(BOOTSTRAP)),
    agents: vi.fn(() => of(AGENTS)),
    ...apiOverrides,
  };
  TestBed.configureTestingModule({
    imports: [AgentsPage],
    providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
  });
  return { api };
}

async function make() {
  const fixture = TestBed.createComponent(AgentsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('AgentsPage — Agent Studio', () => {
  it('lists the real roster', async () => {
    setup();
    const el = (await make()).nativeElement as HTMLElement;
    const cards = el.querySelectorAll('article.card');
    expect(cards.length).toBe(2);
    expect(el.textContent).toContain('Kiro Review');
    expect(el.textContent).toContain('Spark Runner');
  });

  it('builds domain filters from the catalog itself and filters on chip toggle', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(c.domainOptions()).toEqual(['data', 'review', 'spec']);
    c.toggleDomain('data');
    fixture.detectChanges();
    const cards = fixture.nativeElement.querySelectorAll('article.card');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Spark Runner');
    c.toggleDomain('data'); // toggle off
    expect(c.filtered().length).toBe(2);
  });

  it('filters by skill and by free text', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(c.skillOptions()).toEqual(['glue-etl', 'kiro-spec']);
    c.skill.set('kiro-spec');
    expect(c.filtered().map((a) => a.id)).toEqual(['kiro-review']);
    c.skill.set(null);
    c.query.set('glue');
    expect(c.filtered().map((a) => a.id)).toEqual(['spark-runner']);
  });

  it('marks adapter-absent fields UNVERIFIED in the detail — never fabricated', async () => {
    setup();
    await TestBed.inject(PortalStore).bootstrap();
    const fixture = await make();
    fixture.componentInstance.selected.set(AGENTS[0]);
    fixture.detectChanges();
    const detail = fixture.nativeElement.querySelector('[data-section="agent-detail"]');
    expect(detail).toBeTruthy();
    const text = detail.textContent ?? '';
    // real fields
    expect(text).toContain('kiro-review');
    expect(text).toContain('adversarial reviewer');
    expect(text).toContain('The Forge'); // origin = serving forja
    expect(text).toContain('GET /api/v1/agents');
    // unverifiable rows: tools, permissions, deps, version (+hosts empty)
    const badges = detail.querySelectorAll('ui-state-badge .badge');
    const unv = [...badges].filter((b) => (b.textContent ?? '').trim() === 'UNVERIFIED');
    expect(unv.length).toBeGreaterThanOrEqual(4);
    expect(text).not.toContain('undefined');
  });

  it('links associated skills into the skills catalog with a seeded query', async () => {
    setup();
    const fixture = await make();
    fixture.componentInstance.selected.set(AGENTS[0]);
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector(
      '[data-section="agent-detail"] a[href^="/skills"]',
    );
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toContain('q=kiro-spec');
  });

  it('renders the error state when the roster cannot load', async () => {
    setup({ agents: () => throwError(() => new ApiError(0)) });
    const fixture = await make();
    expect(fixture.nativeElement.querySelector('ui-error')).toBeTruthy();
  });
});
