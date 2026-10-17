import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { KnowledgePage } from './knowledge.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { PortalStore } from '../../core/portal/portal.store';
import {
  AccountEnvironment,
  AgentDescriptor,
  FederationSnapshot,
  GraphBundle,
  HostDetection,
  McpServerDescriptor,
  PortalDescriptor,
  RegistryState,
  SkillDescriptor,
  TaskExecution,
} from '../../core/api/api.models';

const DESCRIPTOR: PortalDescriptor = {
  forge_id: 'the-forge',
  forge_name: 'The Forge',
  forge_version: '1.0.0',
  cli: 'forge',
  theme: 'the-forge',
  portal_version: '1.0.0',
  federated: true,
  capabilities: [{ id: 'graph', state: 'supported' }],
  nav: [],
};

const SKILLS: SkillDescriptor[] = [
  {
    id: 'glue-debug',
    name: 'glue-debug',
    domain: 'spark',
    description: '',
    state: 'available',
    hosts: [],
    ...({ origin: 'spark-forge-aws' } as Record<string, unknown>),
  } as SkillDescriptor,
  {
    id: 'emr-costs',
    name: 'emr-costs',
    domain: 'spark',
    description: '',
    state: 'available',
    hosts: [],
  },
  {
    id: 'api-lint',
    name: 'api-lint',
    domain: 'api',
    description: '',
    state: 'unverified',
    hosts: [],
  },
];

const AGENTS: AgentDescriptor[] = [
  {
    id: 'spark-reviewer',
    name: 'spark-reviewer',
    role: 'review',
    description: '',
    authority: null,
    domains: ['spark'],
    skills: ['glue-debug'],
    hosts: [],
    state: 'available',
  },
  {
    id: 'api-reviewer',
    name: 'api-reviewer',
    role: 'review',
    description: '',
    authority: null,
    domains: ['api'],
    skills: [],
    hosts: [],
    state: 'available',
  },
];

const MCP: McpServerDescriptor[] = [
  { id: 'spark-mcp', state: 'FAILED', host: 'claude', tools_count: 0, last_verify: null },
];

const HOSTS: HostDetection[] = [
  {
    host: 'claude',
    detected: true,
    version: '2.0',
    supported: true,
    logged_in: true,
    integration: 'MCP_REGISTERED',
    launchable: true,
  },
];

const TASKS: TaskExecution[] = [
  {
    id: 't1',
    verb: 'apply',
    label: 'apply',
    stage: 'refused',
    started_at: 'x',
    finished_at: 'x',
    exit_code: 1,
    refusal: 'PORTAL-CONFIRM required',
  },
  {
    id: 't2',
    verb: 'apply',
    label: 'apply',
    stage: 'failed',
    started_at: 'x',
    finished_at: 'x',
    exit_code: 1,
    receipt: { status: 'refused' },
  },
];

const FED: FederationSnapshot = {
  specialists: [
    { provider: 'the-forge', state: 'installed' },
    { provider: 'spark-forge-aws', state: 'installed' },
    { provider: 'platform-forge' },
  ],
  installed_forges: ['the-forge', 'spark-forge-aws'],
  registry: { count: 2, path: '/r' },
  summary: { catalog: 3, installed: 2, with_mcp: 0, with_checkout: 0 },
};

const REGISTRY: RegistryState = {
  schema: 'forge-cli/RegistryState/v1',
  state_path: '/s',
  present: true,
  forges: { 'the-forge': {}, 'spark-forge-aws': {} },
};

const GRAPHS: GraphBundle = { availability: { state: 'no_graph' }, views: [], studio_url: null };

const ENV: AccountEnvironment = {
  schema: 'forge/InstallEnvironment/v1',
  scope: 'user',
  forge_id: 'the-forge',
  prefix: 'FORGE_',
  state: 'READY',
  variables: [],
  windows_aliases: false,
};

type ApiStub = Partial<Record<keyof PortalApi, unknown>>;

function setup(apiOverrides: ApiStub = {}, env: AccountEnvironment | null = ENV) {
  const api = {
    federation: vi.fn(() => of(FED)),
    registryState: vi.fn(() => of(REGISTRY)),
    skills: vi.fn(() => of(SKILLS)),
    agents: vi.fn(() => of(AGENTS)),
    mcpServers: vi.fn(() => of(MCP)),
    hosts: vi.fn(() => of(HOSTS)),
    tasks: vi.fn(() => of(TASKS)),
    graphs: vi.fn(() => of(GRAPHS)),
    docsSearch: vi.fn((q: string) =>
      of([{ path: `docs/${q}.md`, title: `${q} guide`, excerpt: '…', category: 'guides' }]),
    ),
    ...apiOverrides,
  };
  TestBed.configureTestingModule({
    imports: [KnowledgePage],
    providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
  });
  const store = TestBed.inject(PortalStore);
  store.descriptor.set(DESCRIPTOR);
  store.accountEnvironment.set(env);
  return { api, store };
}

async function make() {
  const fixture = TestBed.createComponent(KnowledgePage);
  fixture.detectChanges();
  await fixture.componentInstance.load();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const entityIds = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-list="entities"] .node__id')].map((n) => n.textContent?.trim());

describe('KnowledgePage — §8 knowledge view', () => {
  it('lists only entities observed on real endpoints, with the source strip', async () => {
    setup();
    const el = (await make()).nativeElement as HTMLElement;
    const ids = entityIds(el);
    expect(ids).toContain('forge:the-forge');
    // origin edge declared by the skill descriptor
    expect(ids).toContain('forge:spark-forge-aws');
    // catalog-only forja is NOT a graph entity — it surfaces as a
    // missing-component recommendation ref instead
    expect(ids).not.toContain('forge:platform-forge');
    expect(ids).toContain('skill:glue-debug');
    expect(ids).toContain('agent:spark-reviewer');
    expect(ids).toContain('mcp:spark-mcp');
    expect(ids).toContain('operation:t1');
    const strip = el.querySelector('[data-strip="sources"]');
    expect(strip?.querySelectorAll('[data-state="loaded"]').length).toBe(
      9, // 8 sources + environment
    );
  });

  it('filters entities by the unified query and by kind chips', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const total = c.filtered().length;
    c.onQuery('spark');
    expect(c.filtered().every((n) => /spark/i.test(n.id + n.label))).toBe(true);
    c.onQuery('');
    c.toggleKind('skill');
    expect(c.filtered().map((n) => n.id)).toEqual([
      'skill:api-lint',
      'skill:emr-costs',
      'skill:glue-debug',
    ]);
    c.toggleKind('skill');
    expect(c.filtered().length).toBe(total);
  });

  it('inspector lists declared relations with their evidence endpoints', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const skill = c.fed()!.nodes.find((n) => n.id === 'skill:glue-debug')!;
    c.select(skill);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const panel = el.querySelector('[data-section="inspector"]');
    expect(panel).toBeTruthy();
    const rels = [...panel!.querySelectorAll('[data-list="relations"] li')].map((li) =>
      li.textContent?.trim(),
    );
    // origin edge to spark-forge-aws declared by /skills
    expect(rels.some((r) => r!.includes('origin') && r!.includes('spark-forge-aws'))).toBe(true);
    expect(rels.some((r) => r!.includes('GET /api/v1/skills'))).toBe(true);
    // associated edge from the declaring agent
    expect(rels.some((r) => r!.includes('associated') && r!.includes('spark-reviewer'))).toBe(true);
    // same declared domain → sibling skill listed, labeled via its own section
    expect(
      [...panel!.querySelectorAll('[data-list="same-domain"] li')].some((li) =>
        li.textContent!.includes('emr-costs'),
      ),
    ).toBe(true);
    // agents declaring the skill
    expect(
      [...panel!.querySelectorAll('[data-list="declared-by"] li')].some((li) =>
        li.textContent!.includes('spark-reviewer'),
      ),
    ).toBe(true);
    // entity docs searched by the node's own label
    await fixture.whenStable();
    expect(c.entityDocs()?.[0]?.title).toBe('glue-debug guide');
    // contextual "open in" — skill nodes deep-link into the skills catalog
    const open = panel!.querySelector<HTMLAnchorElement>('.detail__actions a.btn--mini');
    expect(open?.getAttribute('href')).toBe('/skills?q=glue-debug');
  });

  it('renders self-reported unverified nodes dashed and keeps referenced entities when a source fails', async () => {
    setup();
    let fixture = await make();
    let el = fixture.nativeElement as HTMLElement;
    // api-lint self-reports state 'unverified' → dashed, never hidden
    const dashed = [...el.querySelectorAll('.node[data-unverified] .node__id')].map((n) =>
      n.textContent?.trim(),
    );
    expect(dashed).toContain('skill:api-lint');

    // /skills down (non-404): source unverified; glue-debug survives on
    // the loaded /agents evidence (the reference itself is real data)
    TestBed.resetTestingModule();
    setup({ skills: () => throwError(() => new ApiError(0)) });
    fixture = await make();
    el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-source="skills"]')?.getAttribute('data-state')).toBe(
      'unverified',
    );
    const node = fixture.componentInstance.fed()!.nodes.find((n) => n.id === 'skill:glue-debug');
    expect(node).toBeTruthy();
    expect(node!.unverified).toBe(false); // corroborated by loaded /agents
    // never-referenced skills are simply absent — not fabricated
    expect(fixture.componentInstance.fed()!.nodes.some((n) => n.id === 'skill:emr-costs')).toBe(
      false,
    );
  });

  it('docs: hits render; 404 → honest unavailable; error → retryable panel', async () => {
    // hits path
    setup();
    let fixture = await make();
    let c = fixture.componentInstance;
    c.query.set('glue');
    await c.searchDocs();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('glue guide');

    // 404 → not exposed
    TestBed.resetTestingModule();
    setup({ docsSearch: () => throwError(() => new ApiError(404)) });
    fixture = await make();
    c = fixture.componentInstance;
    c.query.set('glue');
    await c.searchDocs();
    fixture.detectChanges();
    expect(c.docsUnavailable()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-section="docs"] ui-empty')).toBeTruthy();

    // transport error → retryable ui-error
    TestBed.resetTestingModule();
    setup({ docsSearch: () => throwError(() => new ApiError(503)) });
    fixture = await make();
    c = fixture.componentInstance;
    c.query.set('glue');
    await c.searchDocs();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-section="docs"] ui-error')).toBeTruthy();
  });

  it('renders recommendations with reason + endpoint/field sources', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const recs = el.querySelectorAll('[data-list="recommendations"] .rec');
    const kinds = [...recs].map((r) => r.getAttribute('data-kind'));
    // platform-forge: catalog only; spark-mcp FAILED; apply failed twice; spark domain ×2
    expect(kinds).toContain('missing-component');
    expect(kinds).toContain('mcp-unavailable');
    expect(kinds).toContain('recurring-failure');
    expect(kinds).toContain('related-skill');
    const text = el.textContent ?? '';
    expect(text).toContain('GET /api/v1/federation');
    expect(text).toContain('GET /api/v1/mcp/servers');
    // a rec links to its owning surface
    const missing = [...recs].find((r) => r.getAttribute('data-kind') === 'missing-component')!;
    expect(missing.querySelector('a')?.getAttribute('href')).toContain('/federation');
  });

  it('flags the recommendations panel partial when a source is unverified', async () => {
    setup({ registryState: () => throwError(() => new ApiError(0)) });
    const fixture = await make();
    expect(fixture.componentInstance.recPartial()).toBe(true);
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-note="partial"]')).toBeTruthy();
    // missing-component still derived — but without the registry in sources
    const rec = fixture.componentInstance
      .recommendations()
      .find((r) => r.kind === 'missing-component')!;
    expect(rec.refs[0].id).toBe('platform-forge');
    expect(rec.source.map((s) => s.endpoint)).not.toContain('GET /api/v1/registry/state');
  });
});
