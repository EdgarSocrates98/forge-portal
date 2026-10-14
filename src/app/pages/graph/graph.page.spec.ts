import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { GraphPage } from './graph.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { PortalStore } from '../../core/portal/portal.store';
import {
  AgentDescriptor,
  GraphBundle,
  HostDetection,
  McpServerDescriptor,
  PortalCapability,
  PortalDescriptor,
  SkillDescriptor,
  TaskExecution,
} from '../../core/api/api.models';

const VIEW: Record<string, unknown> = {
  schema: 'forge/ForgeGraphView/v1',
  descriptor: { provider_id: 'the-forge', graph_id: 'federated', domain: 'federated' },
  nodes: [
    { id: 'the-forge:c1', kind: 'capability', label: 'graph', source_provider: 'the-forge' },
    { id: 'api-forge:a1', kind: 'api', label: 'api', source_provider: 'api-forge' },
  ],
  edges: [],
};

const BUNDLE: GraphBundle = {
  availability: { state: 'available' },
  views: [VIEW],
  studio_url: 'http://127.0.0.1:9999/studio',
};

const CAPS: PortalCapability[] = [
  { id: 'graph', state: 'supported' },
  { id: 'mcp', state: 'supported' },
];

const SKILLS: SkillDescriptor[] = [
  {
    id: 'kiro-spec',
    name: 'kiro-spec',
    domain: 'spec',
    description: 'Spec workflow.',
    state: 'available',
    hosts: [],
    source: 'catalog',
  },
];

const AGENTS: AgentDescriptor[] = [
  {
    id: 'reviewer',
    name: 'reviewer',
    role: 'review',
    description: 'Reviews.',
    authority: null,
    domains: [],
    skills: ['kiro-spec'],
    hosts: [],
    state: 'available',
    ...({ forge_id: 'the-forge' } as Record<string, unknown>),
  } as AgentDescriptor,
];

const MCP: McpServerDescriptor[] = [
  { id: 'forge-mcp', state: 'CONFIGURED', host: 'claude', tools_count: 2, last_verify: null },
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
    id: 'task-1',
    verb: 'doctor',
    label: 'installation doctor',
    stage: 'completed',
    started_at: '2026-10-13T00:00:00Z',
    finished_at: '2026-10-13T00:00:01Z',
    exit_code: 0,
    ...({ origin: 'the-forge' } as Record<string, unknown>),
  } as TaskExecution,
];

const DESCRIPTOR: PortalDescriptor = {
  forge_id: 'the-forge',
  forge_name: 'The Forge',
  forge_version: '1.0.0',
  cli: 'forge',
  theme: 'the-forge',
  portal_version: '1.0.0',
  federated: true,
  capabilities: CAPS,
  nav: [],
};

type ApiStub = Partial<Record<keyof PortalApi, unknown>>;

function setup(apiOverrides: ApiStub = {}, withDescriptor = true) {
  const api = {
    graphs: vi.fn(() => of(BUNDLE)),
    capabilities: vi.fn(() => of(CAPS)),
    skills: vi.fn(() => of(SKILLS)),
    agents: vi.fn(() => of(AGENTS)),
    mcpServers: vi.fn(() => of(MCP)),
    hosts: vi.fn(() => of(HOSTS)),
    tasks: vi.fn(() => of(TASKS)),
    ...apiOverrides,
  };
  TestBed.configureTestingModule({
    imports: [GraphPage],
    providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
  });
  if (withDescriptor) TestBed.inject(PortalStore).descriptor.set(DESCRIPTOR);
  return { api };
}

async function make() {
  const fixture = TestBed.createComponent(GraphPage);
  fixture.detectChanges();
  await fixture.componentInstance.load();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const nodeIds = (el: HTMLElement) =>
  [...el.querySelectorAll('[data-list="nodes"] .fed__id')].map((n) => n.textContent?.trim());

describe('GraphPage — §5.6 Federated Graph Studio', () => {
  it('keeps the per-Forja views + studio_url and composes the federated overlay', async () => {
    setup();
    const el = (await make()).nativeElement as HTMLElement;
    // kept layer: views list + external studio link
    expect(el.querySelector('a[href="http://127.0.0.1:9999/studio"]')).toBeTruthy();
    expect(el.querySelectorAll('.views li').length).toBe(1);
    // federated layer: one chip per source endpoint
    const strip = el.querySelector('[data-strip="sources"]');
    expect(strip?.querySelectorAll('li').length).toBe(8);
    // real nodes from every loaded op (+ api-forge provider + ghost refs)
    const ids = nodeIds(el);
    expect(ids).toContain('capability:graph');
    expect(ids).toContain('skill:kiro-spec');
    expect(ids).toContain('agent:reviewer');
    expect(ids).toContain('mcp:forge-mcp');
    expect(ids).toContain('host:claude');
    expect(ids).toContain('operation:task-1');
    expect(ids).toContain('forge:the-forge');
    expect(ids).toContain('forge:api-forge');
  });

  it('filters nodes by text and by kind chip, deterministically', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const total = c.fed()!.nodes.length;
    expect(c.filtered().length).toBe(total);
    // substring search hits label + id
    c.query.set('kiro');
    expect(c.filtered().map((n) => n.id)).toEqual(['skill:kiro-spec']);
    c.query.set('');
    // kind chip narrows to one kind; toggling again restores
    c.toggleKind('skill');
    expect(c.filtered().map((n) => n.kind)).toEqual(['skill']);
    c.toggleKind('skill');
    expect(c.filtered().length).toBe(total);
    fixture.detectChanges();
    const chips = fixture.nativeElement.querySelectorAll('[data-kind-chip]');
    expect(chips.length).toBe(7); // all kinds present in this fixture
  });

  it('inspector shows id/kind/evidence endpoints and the impact edge list', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const forge = c.fed()!.nodes.find((n) => n.id === 'forge:the-forge')!;
    c.select(forge);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const panel = el.querySelector('[data-section="inspector"]');
    expect(panel).toBeTruthy();
    const text = panel!.textContent ?? '';
    expect(text).toContain('forge:the-forge');
    expect(text).toContain('GET /api/v1/bootstrap');
    expect(text).toContain('GET /api/v1/graphs');
    // impact: declares×2 + agent origin + task origin land on the forge
    const items = panel!.querySelectorAll('.fed__edges li');
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(text).toContain('reviewer'); // agent neighbor listed
    // neighbors highlighted in the list
    expect(el.querySelectorAll('.fed__node[data-neighbor]').length).toBeGreaterThanOrEqual(4);
    expect(el.querySelectorAll('.fed__node[data-selected]').length).toBe(1);
  });

  it('export downloads the FedGraph JSON document', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const doc = JSON.parse(c.exportJson());
    expect(doc.schema).toBe('forge/FederatedGraph/v1');
    expect(doc.nodes.length).toBe(c.fed()!.nodes.length);
    expect(doc.edges.length).toBe(c.fed()!.edges.length);
    // click path — the export anchor is created detached; capture its href
    let downloaded: string | null = null;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded = this.href;
    });
    (fixture.nativeElement.querySelector('.fed__head .btn') as HTMLButtonElement).click();
    expect(click).toHaveBeenCalledOnce();
    expect(downloaded).toContain('data:application/json');
    const payload = JSON.parse(decodeURIComponent((downloaded as string).split(',', 2)[1]));
    expect(payload.schema).toBe('forge/FederatedGraph/v1');
    expect(payload.nodes.length).toBe(doc.nodes.length);
    click.mockRestore();
  });

  it('marks unavailable/unverified sources in the strip and dashes their nodes', async () => {
    setup({
      // endpoint absent on this Forja → 'unavailable'
      skills: () => throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND' })),
      // transport error → 'unverified'
      hosts: () => throwError(() => new ApiError(0)),
      // graphs answered but self-reports unverified → 'unverified'
      graphs: () => of({ availability: { state: 'unverified' }, views: [VIEW], studio_url: null }),
    });
    const el = (await make()).nativeElement as HTMLElement;
    expect(el.querySelector('[data-source="skills"]')?.getAttribute('data-state')).toBe(
      'unavailable',
    );
    expect(el.querySelector('[data-source="hosts"]')?.getAttribute('data-state')).toBe(
      'unverified',
    );
    expect(el.querySelector('[data-source="graphs"]')?.getAttribute('data-state')).toBe(
      'unverified',
    );
    expect(el.querySelector('[data-source="mcp"]')?.getAttribute('data-state')).toBe('loaded');
    const dashed = [...el.querySelectorAll('.fed__node[data-unverified]')].map((n) =>
      n.querySelector('.fed__id')?.textContent?.trim(),
    );
    // only /graphs names api-forge and it stayed unverified → dashed
    expect(dashed).toContain('forge:api-forge');
    // the serving forge is corroborated by loaded endpoints → solid
    expect(dashed).not.toContain('forge:the-forge');
    // the mcp-named host survives on the loaded mcp evidence
    expect(dashed).not.toContain('host:claude');
    expect(nodeIds(el)).toContain('host:claude');
    // skill node still exists — the loaded agent catalog references it
    expect(nodeIds(el)).toContain('skill:kiro-spec');
  });

  it('keeps the no_graph empty state while the studio still renders', async () => {
    setup({
      graphs: () =>
        of({
          availability: { state: 'no_graph', unlock: 'run theforge graph' },
          views: [],
          studio_url: null,
        }),
    });
    const el = (await make()).nativeElement as HTMLElement;
    expect(el.querySelector('ui-empty')).toBeTruthy();
    expect(el.textContent).toContain('run theforge graph');
    // studio survives on the other sources
    expect(el.querySelector('[data-section="federated"]')).toBeTruthy();
    expect(el.querySelector('[data-source="graphs"]')?.getAttribute('data-state')).toBe('loaded');
    expect(nodeIds(el)).toContain('skill:kiro-spec');
  });

  it('surfaces the graphs error panel and marks graphs unverified in the strip', async () => {
    setup({ graphs: () => throwError(() => new ApiError(0)) }, false);
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ui-error')).toBeTruthy();
    expect(el.querySelector('[data-source="graphs"]')?.getAttribute('data-state')).toBe(
      'unverified',
    );
    expect(el.querySelector('[data-source="bootstrap"]')?.getAttribute('data-state')).toBe(
      'unverified',
    );
    // agent-declared forge_id still names its forge honestly…
    expect(nodeIds(el)).toContain('forge:the-forge');
    // …but no serving Forja → zero declares edges are invented
    expect(fixture.componentInstance.fed()!.edges.some((e) => e.kind === 'declares')).toBe(false);
    expect(el.textContent).toContain('capability:graph');
  });
});
