import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import cytoscape from 'cytoscape';
import { AgentsPage } from './agents.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { PortalStore } from '../../core/portal/portal.store';
import { AgentDescriptor, BootstrapPayload, SkillDescriptor } from '../../core/api/api.models';
import { UNDECLARED } from './agents.data';

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
    ...({ forge_id: 'the-forge' } as Record<string, unknown>),
  } as AgentDescriptor,
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
  } as AgentDescriptor,
];

const SKILLS: SkillDescriptor[] = [
  {
    id: 'kiro-spec',
    name: 'kiro-spec',
    domain: 'spec',
    description: 'Spec workflow.',
    state: 'available',
    hosts: [],
  },
  {
    id: 'glue-etl',
    name: 'glue-etl',
    domain: 'data',
    description: 'Glue ETL.',
    state: 'available',
    hosts: [],
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
    skills: vi.fn(() => of(SKILLS)),
    ...apiOverrides,
  };
  TestBed.configureTestingModule({
    imports: [AgentsPage],
    providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
  });
  return { api };
}

async function make() {
  await TestBed.inject(I18nService).applyPreference('en');
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
    expect(c.domainOpts()).toEqual(['data', 'review', 'spec']);
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
    expect(c.skillOpts()).toEqual(['glue-etl', 'kiro-spec']);
    c.skill.set('kiro-spec');
    expect(c.filtered().map((a) => a.id)).toEqual(['kiro-review']);
    c.skill.set(null);
    c.query.set('glue');
    expect(c.filtered().map((a) => a.id)).toEqual(['spark-runner']);
  });

  it('seeds the search from the ?q= route input — skills/agents deep links land here', async () => {
    setup();
    const fixture = TestBed.createComponent(AgentsPage);
    fixture.componentRef.setInput('q', 'spark');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.query()).toBe('spark');
    expect(fixture.componentInstance.filtered().map((a) => a.id)).toEqual(['spark-runner']);
  });

  it('filters by host and by declared Forja — undeclared is its own bucket', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(c.hostOpts()).toEqual(['devin']);
    c.host.set('devin');
    expect(c.filtered().map((a) => a.id)).toEqual(['spark-runner']);
    c.host.set(null);
    // kiro-review declares forge_id=the-forge; spark-runner declares none
    expect(c.forgeOpts().declared).toEqual(['the-forge']);
    expect(c.forgeOpts().hasUndeclared).toBe(true);
    c.forge.set('the-forge');
    expect(c.filtered().map((a) => a.id)).toEqual(['kiro-review']);
    c.forge.set(UNDECLARED);
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
    expect(text).toContain('the-forge'); // declared forja
    expect(text).toContain('GET /api/v1/agents');
    // unverifiable rows: tools, permissions, deps, version (+hosts empty)
    const badges = detail.querySelectorAll('ui-state-badge .badge');
    const unv = [...badges].filter((b) => (b.textContent ?? '').trim() === 'UNVERIFIED');
    expect(unv.length).toBeGreaterThanOrEqual(4);
    expect(text).not.toContain('undefined');
  });

  it('declared Forja row is honest — absent descriptors render "not declared"', async () => {
    setup();
    await TestBed.inject(PortalStore).bootstrap();
    const fixture = await make();
    fixture.componentInstance.selected.set(AGENTS[1]); // no declared origin
    fixture.detectChanges();
    const detail = fixture.nativeElement.querySelector('[data-section="agent-detail"]');
    const text = detail.textContent ?? '';
    expect(text).toContain('not declared');
    // serving Forja still identifies the catalog separately
    expect(text).toContain('The Forge');
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

describe('AgentsPage — view modes', () => {
  it('toggles cards → table → graph', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-section="cards"]')).toBeTruthy();
    expect(el.querySelector('[data-section="table"]')).toBeNull();

    c.setMode('table');
    fixture.detectChanges();
    expect(el.querySelector('[data-section="cards"]')).toBeNull();
    const rows = el.querySelectorAll('[data-section="table"] tbody tr');
    expect(rows.length).toBe(2);
    expect(el.textContent).toContain('spark-runner');

    c.setMode('graph');
    fixture.detectChanges();
    expect(el.querySelector('[data-section="graph"]')).toBeTruthy();
    expect(el.querySelector('[data-section="table"]')).toBeNull();
  });

  it('table rows carry real fields and never invent a value', async () => {
    setup();
    const fixture = await make();
    fixture.componentInstance.setMode('table');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = [...el.querySelectorAll('[data-section="table"] tbody tr')];
    // kiro-review has empty hosts → "not declared", never a guessed host
    expect(rows[0]!.textContent).toContain('not declared');
    expect(rows[1]!.textContent).toContain('devin');
  });
});

describe('AgentsPage — side-by-side comparison', () => {
  it('compares two agents over real fields, absent = not declared', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    c.toggleCompare('kiro-review');
    fixture.detectChanges();
    // one pick: tray hints for a second, no table yet
    expect(el.querySelector('[data-section="compare-tray"]')).toBeTruthy();
    expect(el.querySelector('[data-section="compare"]')).toBeNull();

    c.toggleCompare('spark-runner');
    fixture.detectChanges();
    const table = el.querySelector('[data-section="compare"]');
    expect(table).toBeTruthy();
    const text = table!.textContent ?? '';
    expect(text).toContain('kiro-review');
    expect(text).toContain('spark-runner');
    // real values on both sides
    expect(text).toContain('adversarial reviewer');
    expect(text).toContain('glue executor');
    // kiro-review declared the-forge; spark-runner did not → not declared
    expect(text).toContain('the-forge');
    expect(text).toContain('not declared');
    // differing rows get flagged (role/authority differ on declared values)
    const differ = table!.querySelectorAll('tr[data-differ]');
    expect(differ.length).toBeGreaterThan(0);
  });

  it('a third pick evicts the oldest — the pair never exceeds two', async () => {
    setup({ agents: () => of([...AGENTS, { ...AGENTS[0]!, id: 'third' } as AgentDescriptor]) });
    const fixture = await make();
    const c = fixture.componentInstance;
    c.toggleCompare('kiro-review');
    c.toggleCompare('spark-runner');
    c.toggleCompare('third');
    expect(c.compareIds()).toEqual(['spark-runner', 'third']);
    // removal via the tray chip
    c.toggleCompare('spark-runner');
    expect(c.compareIds()).toEqual(['third']);
  });
});

describe('AgentsPage — graph view', () => {
  async function mountGraph(fixture: Awaited<ReturnType<typeof make>>) {
    const c = fixture.componentInstance;
    c.setMode('graph');
    fixture.detectChanges();
    await vi.waitFor(() => expect(c.canvasRenderer()).toBeTruthy());
    fixture.detectChanges();
    return c.canvasRenderer()!.nativeHandle() as cytoscape.Core;
  }

  it('renders the filtered agent subgraph via the shared renderer', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    // full fed model built from this page's real sources
    expect(c.fed().nodes.map((n) => n.id)).toContain('agent:kiro-review');
    expect(c.fed().nodes.map((n) => n.id)).toContain('forge:the-forge');
    // subgraph = agents + declared-edge endpoints only
    const sub = c.subgraph();
    expect(sub.counts.agent).toBe(2);
    expect(sub.nodes.map((n) => n.id)).toContain('skill:kiro-spec');
    expect(sub.nodes.map((n) => n.id)).toContain('skill:glue-etl');
    // no unrelated kinds leak in
    expect(sub.nodes.every((n) => ['agent', 'skill', 'forge'].includes(n.kind))).toBe(true);

    const cy = await mountGraph(fixture);
    expect(cy.getElementById('agent:kiro-review').length).toBe(1);
    expect(cy.getElementById('skill:kiro-spec').length).toBe(1);
    // canvas tap on an agent opens the same inspector
    cy.getElementById('agent:spark-runner').emit('tap');
    fixture.detectChanges();
    expect(c.selected()?.id).toBe('spark-runner');
    expect(fixture.nativeElement.querySelector('[data-section="agent-detail"]')).toBeTruthy();
  });

  it('the subgraph follows the active filters', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    c.domain.set('data');
    const sub = c.subgraph();
    expect(sub.nodes.map((n) => n.id)).toContain('agent:spark-runner');
    expect(sub.nodes.map((n) => n.id)).toContain('skill:glue-etl');
    expect(sub.nodes.map((n) => n.id)).not.toContain('agent:kiro-review');
    // kiro-spec is only reachable through a filtered-out agent
    expect(sub.nodes.map((n) => n.id)).not.toContain('skill:kiro-spec');
  });

  it('the graph follows the declared agent↔skill edges even when /skills is unavailable', async () => {
    setup({ skills: () => throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND' })) });
    const fixture = await make();
    const c = fixture.componentInstance;
    const sub = c.subgraph();
    // the association a descriptor declared is still drawn — a stub node
    // whose only evidence is the referring endpoint, never dropped
    const stub = sub.nodes.find((n) => n.id === 'skill:kiro-spec');
    expect(stub).toBeTruthy();
    expect(stub!.evidence).toEqual(['agents']);
    expect(sub.sources['skills'].state).toBe('unavailable');
  });
});
