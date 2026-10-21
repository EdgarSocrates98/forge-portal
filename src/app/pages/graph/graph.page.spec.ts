import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import cytoscape from 'cytoscape';
import { GraphPage } from './graph.page';
import { FED_GRAPH_SCHEMA, FedGraph } from '../../core/graph/federated';
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
    expect(strip?.querySelectorAll('li').length).toBe(9);
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
    // contextual "open in" — forge nodes own a real detail route
    const open = panel!.querySelector<HTMLAnchorElement>('a.fed__open');
    expect(open?.getAttribute('href')).toBe('/forges/the-forge');
  });

  it('shows no "open in" link for capability nodes — no owning page exists', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const cap = c.fed()!.nodes.find((n) => n.id === 'capability:graph')!;
    c.select(cap);
    fixture.detectChanges();
    const panel = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-section="inspector"]',
    );
    expect(panel).toBeTruthy();
    expect(panel!.querySelector('a.fed__open')).toBeNull();
    // the id is still shown honestly — just without pretend navigation
    expect(panel!.textContent).toContain('capability:graph');
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
    let downloaded = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded = this.href;
    });
    (
      fixture.nativeElement.querySelector(
        '.fed__head button[data-action="export"]',
      ) as HTMLButtonElement
    ).click();
    expect(click).toHaveBeenCalledOnce();
    expect(downloaded).toContain('data:application/json');
    const payload = JSON.parse(decodeURIComponent(downloaded.split(',', 2)[1]));
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

/** Mount the canvas on a made fixture — shared by the canvas-surface
 *  and cycle-3 guard suites below. */
async function mountCanvas(fixture: Awaited<ReturnType<typeof make>>) {
  const c = fixture.componentInstance;
  c.setMode('canvas');
  fixture.detectChanges();
  await vi.waitFor(() => expect(c.canvasRenderer()).toBeTruthy());
  fixture.detectChanges();
  return c.canvasRenderer()!.nativeHandle() as cytoscape.Core;
}

describe('GraphPage — §5.6 canvas surface', () => {
  it('toggles list↔canvas preserving selection and mounts the renderer', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-list="nodes"]')).toBeTruthy();
    expect(el.querySelector('[data-canvas="graph"]')).toBeNull();

    const forge = c.fed()!.nodes.find((n) => n.id === 'forge:the-forge')!;
    c.select(forge);
    const cy = await mountCanvas(fixture);

    expect(el.querySelector('[data-list="nodes"]')).toBeNull();
    expect(el.querySelector('[data-canvas="graph"]')).toBeTruthy();
    // selection preserved and mirrored on the canvas with its neighbors lit
    expect(c.selected()?.id).toBe('forge:the-forge');
    expect(cy.getElementById('forge:the-forge').selected()).toBe(true);
    expect(cy.getElementById('capability:graph').hasClass('nh')).toBe(true);
    // kind legend present
    expect(el.querySelectorAll('.fed__legend li:not(.fed__legend-line)').length).toBe(7);
    expect(el.querySelectorAll('.fed__legend li.fed__legend-line').length).toBe(3);
    // back to the list: canvas torn down, state intact
    c.setMode('list');
    fixture.detectChanges();
    await vi.waitFor(() => expect(c.canvasRenderer()).toBeNull());
    fixture.detectChanges();
    expect(el.querySelector('[data-list="nodes"]')).toBeTruthy();
    expect(c.selected()?.id).toBe('forge:the-forge');
    expect(el.querySelector('[data-section="inspector"]')).toBeTruthy();
  });

  it('canvas taps drive the node and edge inspectors', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    const cy = await mountCanvas(fixture);

    cy.getElementById('agent:reviewer').emit('tap');
    fixture.detectChanges();
    expect(c.selected()?.id).toBe('agent:reviewer');
    expect(c.selectedEdge()).toBeNull();
    expect(el.querySelector('[data-section="inspector"]')).toBeTruthy();

    const edge = c.fed()!.edges.find((e) => e.kind === 'associated')!;
    cy.getElementById(edge.id).emit('tap');
    fixture.detectChanges();
    expect(c.selected()).toBeNull();
    expect(c.selectedEdge()?.id).toBe(edge.id);
    const panel = el.querySelector('[data-section="edge-inspector"]');
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain('associated');
    expect(panel!.textContent).toContain('agent:reviewer');
    expect(panel!.textContent).toContain('skill:kiro-spec');
    expect(panel!.textContent).toContain('GET /api/v1/agents');

    cy.emit('tap'); // background tap clears both inspectors
    fixture.detectChanges();
    expect(c.selected()).toBeNull();
    expect(c.selectedEdge()).toBeNull();
  });

  it('layout pills re-run the layout without dropping selection', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    const cy = await mountCanvas(fixture);
    cy.getElementById('agent:reviewer').emit('tap');
    fixture.detectChanges();

    (el.querySelector('[data-layout="grid"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(c.layoutName()).toBe('grid');
    expect(c.selected()?.id).toBe('agent:reviewer');
    expect(cy.getElementById('agent:reviewer').selected()).toBe(true);
    // reset returns to the active layout name
    (el.querySelector('[data-action="reset"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(c.layoutName()).toBe('grid');
  });

  it('search dims canvas nodes but never drops the selection', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const cy = await mountCanvas(fixture);
    cy.getElementById('skill:kiro-spec').emit('tap');
    fixture.detectChanges();
    c.query.set('kiro');
    fixture.detectChanges();
    expect(c.selected()?.id).toBe('skill:kiro-spec');
    expect(cy.getElementById('skill:kiro-spec').hasClass('dimmed')).toBe(false);
    expect(cy.getElementById('forge:the-forge').hasClass('dimmed')).toBe(true);
    c.query.set('');
    fixture.detectChanges();
    expect(cy.getElementById('forge:the-forge').hasClass('dimmed')).toBe(false);
  });

  it('exports SVG markup and honestly skips PNG when headless', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await mountCanvas(fixture);
    const downloads: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.href);
    });
    (el.querySelector('[data-action="svg"]') as HTMLButtonElement).click();
    expect(downloads.length).toBe(1);
    expect(downloads[0]).toContain('data:image/svg+xml');
    const svg = decodeURIComponent(downloads[0].split(',', 2)[1]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('kiro-spec');
    // jsdom has no rasterizer — the PNG button stays silent
    (el.querySelector('[data-action="png"]') as HTMLButtonElement).click();
    expect(downloads.length).toBe(1);
    click.mockRestore();
  });
});

describe('GraphPage — 2.1 advanced inspector, impact, snapshot, saved view', () => {
  it('shows real state/origin/version/degree and in/out relation columns', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    c.select(c.fed()!.nodes.find((n) => n.id === 'agent:reviewer')!);
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('[data-section="inspector"]')!;
    const text = panel.textContent ?? '';
    expect(text).toContain('available'); // real descriptor state
    expect(text).toContain('the-forge'); // declared forge origin
    expect(panel.querySelector('[data-rel="out"]')).toBeTruthy();
    expect(panel.querySelector('[data-rel="in"]')).toBeTruthy();
    // origin chip navigates to the forge node
    const relOut = panel.querySelectorAll('[data-rel="out"] li');
    const kinds = [...panel.querySelectorAll('[data-rel="out"] code')].map((x) =>
      x.textContent?.trim(),
    );
    expect(kinds).toContain('associated');
    expect(relOut.length).toBeGreaterThanOrEqual(1);
  });

  it('impact panel lists uses/usedBy at the chosen depth with topo honesty', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    c.select(c.fed()!.nodes.find((n) => n.id === 'forge:the-forge')!);
    fixture.detectChanges();
    const sec = el.querySelector('[data-section="impact"]')!;
    expect(sec).toBeTruthy();
    expect(sec.textContent).toContain('reviewer'); // declared origin lands here
    const usedBy = sec.querySelectorAll('[data-impact="usedBy"] li');
    const uses = sec.querySelectorAll('[data-impact="uses"] li');
    expect(usedBy.length).toBeGreaterThanOrEqual(2); // agent + task point at the forge
    expect(uses.length).toBeGreaterThanOrEqual(2); // forge declares both capabilities
    // depth switch recomputes honestly
    (sec.querySelector('[data-depth="1"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(c.impactDepth()).toBe(1);
    // coverage line states real loaded/total
    expect(el.querySelector('.fed__honest')?.textContent).toContain('8/9');
    // topological disclaimer is present, not implied
    expect(sec.textContent).toMatch(/topol|Topological/i);
  });

  it('shortest-path finder highlights the hops or reports none', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    // capability leaves have no outgoing path to the agent; undirected
    // the declared chain cap ← forge ← agent connects them
    c.select(c.fed()!.nodes.find((n) => n.id === 'capability:graph')!);
    c.pathTarget.set('agent:reviewer');
    fixture.detectChanges();
    expect(c.pathResult()?.nodes).toBeNull();
    c.pathDir.set('both');
    fixture.detectChanges();
    const p = c.pathResult();
    expect(p?.nodes).not.toBeNull();
    expect(p!.nodes![0]).toBe('capability:graph');
    expect(p!.nodes![p!.nodes!.length - 1]).toBe('agent:reviewer');
    const hops = el.querySelectorAll('[data-path="found"] li');
    expect(hops.length).toBe(p!.nodes!.length);
  });

  it('captures a snapshot, diffs honestly, and clears it', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-section="snapshot-bar"]')).toBeNull();
    c.takeSnapshot();
    fixture.detectChanges();
    expect(c.snap()?.schema).toBe('forge-portal/GraphSnapshot/v1');
    // self-diff → honest unchanged line, three empty columns
    const bar = el.querySelector('[data-section="snapshot-bar"]')!;
    expect(bar).toBeTruthy();
    const diff = el.querySelector('[data-section="diff"]')!;
    // unchanged self-diff → the honest 'no changes' line, no columns yet
    expect(diff.querySelector('[data-diff]')).toBeNull();
    expect(diff.textContent?.trim().length).toBeGreaterThan(0);
    // simulate change: drop the agent edge and re-diff → removed edge appears
    const g = c.fed()!;
    const shrunk = { ...g, edges: g.edges.filter((e) => e.kind !== 'associated') };
    c.fed.set(shrunk);
    c.diff.set(null); // clear the self-diff, then compare fresh
    c.toggleDiff(shrunk);
    fixture.detectChanges();
    const removed = el.querySelector('[data-diff="removed"]')!;
    expect(removed.textContent).toContain('associated');
    c.dropSnapshot();
    fixture.detectChanges();
    expect(c.snap()).toBeNull();
    expect(c.diff()).toBeNull();
    expect(localStorage.getItem('forge-portal/graph-snapshot/v1')).toBeNull();
  });

  it('restores a saved view once and reset-view clears it', async () => {
    localStorage.setItem(
      'forge-portal/graph-view/v1',
      JSON.stringify({
        schema: 'forge-portal/GraphView/v1',
        mode: 'canvas',
        layout: 'concentric',
        query: 'reviewer',
        kind: 'agent',
        selectedNode: 'agent:reviewer',
        selectedEdge: null,
        viewport: { zoom: 1.5, panX: 10, panY: -5 },
        groupBy: 'kind',
        collapsedGroups: [],
      }),
    );
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(c.mode()).toBe('canvas');
    expect(c.layoutName()).toBe('concentric');
    expect(c.query()).toBe('reviewer');
    expect(c.kind()).toBe('agent');
    expect(c.selected()?.id).toBe('agent:reviewer');
    expect(c.groupBy()).toBe('kind');
    c.resetView();
    expect(c.mode()).toBe('list');
    expect(c.query()).toBe('');
    expect(c.kind()).toBeNull();
    expect(c.selected()).toBeNull();
    expect(c.layoutName()).toBe('cose');
    expect(c.groupBy()).toBeNull();
    expect(localStorage.getItem('forge-portal/graph-view/v1')).toBeNull();
  });

  it('grouping select creates compound parents and collapse chips work', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    c.setMode('canvas');
    fixture.detectChanges();
    await vi.waitFor(() => expect(c.canvasRenderer()).toBeTruthy());
    fixture.detectChanges();
    const cy = c.canvasRenderer()!.nativeHandle() as cytoscape.Core;
    const sel = el.querySelector('[data-action="group"]') as HTMLSelectElement;
    sel.value = 'kind';
    sel.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const chips = el.querySelectorAll('[data-strip="groups"] [data-group]');
    expect(chips.length).toBeGreaterThanOrEqual(7); // one group per present kind
    expect(cy.$('.grp').length).toBeGreaterThanOrEqual(7);
    // collapse one group → its members hide on the canvas
    (chips[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(c.collapsed().size).toBe(1);
    expect(cy.$('.g-hidden').length).toBeGreaterThanOrEqual(1);
  });

  it('persists view state to localStorage on change', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    vi.useFakeTimers();
    try {
      c.query.set('kiro');
      vi.advanceTimersByTime(400);
      const raw = localStorage.getItem('forge-portal/graph-view/v1');
      expect(raw).toBeTruthy();
      const state = JSON.parse(raw!);
      expect(state.schema).toBe('forge-portal/GraphView/v1');
      expect(state.query).toBe('kiro');
      expect(state.mode).toBe('list');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GraphPage — 2.2 cycle 3 adaptive layout + safety guard', () => {
  it('auto mode is the default and names the resolved layout', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await mountCanvas(fixture);
    fixture.detectChanges();
    const auto = el.querySelector('[data-layout="auto"]') as HTMLButtonElement;
    expect(auto).toBeTruthy();
    // the small fixture graph resolves to the small-class auto pick
    expect(c.effectiveLayout()).toBe('cose');
    expect(c.layoutAuto()).toBe(true);
    expect(auto.textContent).toContain('cose');
    // explicit pick turns auto off; auto pill turns it back on
    c.setLayout('grid');
    fixture.detectChanges();
    expect(c.layoutAuto()).toBe(false);
    expect(auto.getAttribute('aria-pressed')).toBe('false');
    c.setAutoLayout();
    fixture.detectChanges();
    expect(c.layoutAuto()).toBe(true);
    expect(auto.getAttribute('aria-pressed')).toBe('true');
  });

  it('a pending expensive pick shows the warn strip and confirm runs it', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await mountCanvas(fixture);
    // simulate the guard's pending state (a measured-expensive pick at
    // scale — the fixture graph itself is small)
    c.pendingLayout.set('cose');
    fixture.detectChanges();
    const warn = el.querySelector('[data-section="layout-warn"]');
    expect(warn).toBeTruthy();
    expect(warn!.textContent).toContain(c.layoutChoice().recommended);
    // "run anyway" applies the pick and leaves auto mode
    (el.querySelector('[data-action="layout-confirm"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(c.pendingLayout()).toBeNull();
    expect(c.layoutAuto()).toBe(false);
    expect(c.layoutName()).toBe('cose');
    expect(el.querySelector('[data-section="layout-warn"]')).toBeNull();
  });

  it('useRecommended returns to auto instead of running the expensive pick', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await mountCanvas(fixture);
    c.pendingLayout.set('breadthfirst');
    fixture.detectChanges();
    (el.querySelector('[data-action="layout-use-rec"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(c.pendingLayout()).toBeNull();
    expect(c.layoutAuto()).toBe(true);
  });

  it('layout events drive the status strip; cancel reaches the adapter', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await mountCanvas(fixture);
    // run cose (async) then cancel through the page handler
    c.setLayout('cose');
    c.cancelLayout();
    await vi.waitFor(() => expect(c.layoutStatus()?.type).toBe('cancelled'));
    expect(c.layoutBusy()).toBe(false);
    fixture.detectChanges();
    const strip = el.querySelector('[data-status="layout"]');
    expect(strip).toBeTruthy();
    expect(strip!.textContent).toContain('cancelled');
  });
});

/** A synthetic federated graph of `n` nodes — enough for the layout
 *  policy's measured scale classes (medium ≤ 1200, large ≤ 6000). */
const fedOf = (n: number): FedGraph => ({
  schema: FED_GRAPH_SCHEMA,
  nodes: Array.from({ length: n }, (_, i) => ({
    id: `tool:n${i}`,
    kind: 'tool' as const,
    label: `n${i}`,
    evidence: ['graphs' as const],
    unverified: false,
  })),
  edges: [],
  counts: { tool: n } as FedGraph['counts'],
  sources: {} as FedGraph['sources'],
});

describe('GraphPage — 2.2.1 cycle 7 manual layout hard guard', () => {
  it('a blocked pick never reaches the engine — strip explains + offers the adaptive layout', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await mountCanvas(fixture);
    // grow into the `large` class where cose is measured non-viable
    c.fed.set(fedOf(2000));
    fixture.detectChanges();
    const layoutSpy = vi.spyOn(c.canvasRenderer()!, 'layout');
    c.setLayout('cose');
    fixture.detectChanges();
    // the pick is recorded honestly, but NOTHING ran — direct
    // execution above the measured safe limit is refused
    expect(layoutSpy).not.toHaveBeenCalled();
    expect(c.layoutAuto()).toBe(false);
    expect(c.layoutName()).toBe('cose');
    expect(c.pendingLayout()).toBeNull();
    expect(c.blockedLayout()).toBe('cose');
    expect(c.effectiveLayout()).toBe('grid'); // recommended substituted
    const strip = el.querySelector('[data-section="layout-block"]');
    expect(strip).toBeTruthy();
    expect(strip!.textContent).toContain('cose');
    expect(strip!.textContent).toContain('grid');
    // hard tier offers the adaptive alternative — no "run anyway"
    expect(strip!.querySelector('[data-action="layout-confirm"]')).toBeNull();
    const use = strip!.querySelector<HTMLButtonElement>('[data-action="layout-use-rec"]')!;
    use.click();
    fixture.detectChanges();
    expect(c.layoutAuto()).toBe(true);
    expect(c.blockedLayout()).toBeNull();
    expect(layoutSpy).toHaveBeenCalledWith('grid');
    expect(el.querySelector('[data-section="layout-block"]')).toBeNull();
  });

  it('a warned pick at medium scale still asks for confirmation and runs it', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await mountCanvas(fixture);
    c.fed.set(fedOf(900)); // medium class — cose viable but expensive
    fixture.detectChanges();
    const layoutSpy = vi.spyOn(c.canvasRenderer()!, 'layout');
    c.setLayout('cose');
    fixture.detectChanges();
    expect(c.pendingLayout()).toBe('cose');
    expect(c.blockedLayout()).toBeNull();
    expect(el.querySelector('[data-section="layout-warn"]')).toBeTruthy();
    expect(el.querySelector('[data-section="layout-block"]')).toBeNull();
    expect(layoutSpy).not.toHaveBeenCalled();
    (el.querySelector('[data-action="layout-confirm"]') as HTMLButtonElement).click();
    expect(layoutSpy).toHaveBeenCalledWith('cose');
    expect(c.layoutName()).toBe('cose');
    expect(c.layoutAuto()).toBe(false);
  });

  it('a recorded/ restored pick that is blocked at the current scale degrades honestly', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await mountCanvas(fixture);
    // simulate the saved-view/restore or graph-growth case: a user pick
    // whose measured cost is 'blocked' at the CURRENT scale
    c.fed.set(fedOf(2000));
    c.layoutAuto.set(false);
    c.layoutName.set('cose');
    fixture.detectChanges();
    expect(c.blockedLayout()).toBe('cose');
    expect(c.effectiveLayout()).toBe('grid');
    expect(el.querySelector('[data-section="layout-block"]')).toBeTruthy();
    // a data refresh pushes the SAFE pick to the engine — the blocked
    // name never crosses the adapter boundary
    const setDataSpy = vi.spyOn(c.canvasRenderer()!, 'setData');
    c.fed.set(fedOf(2001));
    fixture.detectChanges();
    expect(setDataSpy).toHaveBeenCalled();
    const lastCall = setDataSpy.mock.calls.at(-1);
    expect(lastCall?.[1]?.layout).toBe('grid');
  });

  it('small graphs are unaffected — picks still run directly', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    await mountCanvas(fixture);
    const layoutSpy = vi.spyOn(c.canvasRenderer()!, 'layout');
    c.setLayout('cose');
    fixture.detectChanges();
    expect(layoutSpy).toHaveBeenCalledWith('cose');
    expect(c.pendingLayout()).toBeNull();
    expect(c.blockedLayout()).toBeNull();
    expect(el.querySelector('[data-section="layout-block"]')).toBeNull();
    expect(el.querySelector('[data-section="layout-warn"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lf-0023/lf-0024 — the views explorer scope: the served ForgeGraphView/v1
// document(s) rendered as the model itself (portal parity with `graph ui`).
// ---------------------------------------------------------------------------

const VIEW2: Record<string, unknown> = {
  schema: 'forge/ForgeGraphView/v1',
  descriptor: { provider_id: 'api-forge', graph_id: 'api-graph', domain: 'api' },
  nodes: [
    { id: 'api-forge:svc', kind: 'service', label: 'svc', source_provider: 'api-forge' },
    { id: 'api-forge:db', kind: 'datastore', label: 'db', source_provider: 'api-forge' },
  ],
  edges: [
    {
      id: 'e-1',
      source: 'api-forge:svc',
      target: 'api-forge:db',
      kind: 'reads',
      provenance: 'extract',
      epistemic_state: 'observed',
    },
  ],
};

const BUNDLE_MULTI: GraphBundle = {
  availability: { state: 'available' },
  // third entry is NOT a view — the explorer must drop it, never guess it
  views: [VIEW, VIEW2, { bogus: true }],
  studio_url: 'http://127.0.0.1:9999/studio',
};

// jsdom localStorage survives across specs in this file and earlier tests
// persist view state (kind/provider/query); the explorer assertions need a
// clean browser, not a restored filter from an unrelated suite.
const setupMulti = () => {
  localStorage.clear();
  return setup({ graphs: vi.fn(() => of(BUNDLE_MULTI)) });
};

describe('GraphPage — lf-0023 views explorer scope', () => {
  it('the scope pill exists only with contract-valid views and switches models', async () => {
    setupMulti();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    expect(c.hasViews()).toBe(true);
    expect(c.viewInfos().filter((i) => i !== null).length).toBe(2); // bogus dropped
    expect(el.querySelector('[data-toggle="scope"]')).toBeTruthy();

    // default scope is the descriptor overlay (federation overlay nodes)
    const overlayIds = c.fed()!.nodes.map((n) => n.id);
    expect(overlayIds).toContain('capability:graph');

    (el.querySelector('[data-scope="views"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // explorer model = merged views — ids already carrying their provider
    // prefix pass through verbatim (merge is idempotent); NOT the overlay
    const ids = c.fed()!.nodes.map((n) => n.id);
    expect(ids).toContain('the-forge:c1');
    expect(ids).toContain('api-forge:svc');
    expect(ids).not.toContain('capability:graph');
    expect(el.querySelector('[data-section="explorer"]')).toBeTruthy();
  });

  it('openView jumps straight into the explorer on that single view', async () => {
    setupMulti();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    const buttons = el.querySelectorAll('[data-action="open-view"]');
    expect(buttons.length).toBe(3); // one per bundle entry
    (buttons[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(c.scope()).toBe('views');
    expect(c.viewIdx()).toBe(1);
    // single-view model — verbatim ids, no namespacing
    const ids = c.fed()!.nodes.map((n) => n.id);
    expect(ids).toEqual(['api-forge:svc', 'api-forge:db']);
    expect(c.fed()!.edges.map((e) => e.kind)).toEqual(['reads']);
  });

  it('view select swaps the model and provider pills filter it', async () => {
    setupMulti();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-scope="views"]') as HTMLButtonElement).click();
    fixture.detectChanges();

    // merged model: two providers → a pill each, with real counts
    const pills = [...el.querySelectorAll('[data-provider]')] as HTMLButtonElement[];
    expect(pills.map((p) => p.dataset['provider']).sort()).toEqual([
      'api-forge',
      'the-forge',
    ]);
    const merged = c.fed()!.nodes.length;
    expect(c.providerCount()).toBe(2);

    // filter to one provider — only its nodes pass the filter
    c.toggleProvider('api-forge');
    fixture.detectChanges();
    expect(c.filtered().every((n) => n.origin === 'api-forge')).toBe(true);
    expect(c.filtered().length).toBeLessThan(merged);
    c.toggleProvider('api-forge'); // toggle off restores
    expect(c.filtered().length).toBe(merged);

    // pick view 0 in the selector → single-view model replaces the merged one
    const sel = el.querySelector('[data-action="view-select"]') as HTMLSelectElement;
    sel.value = '0';
    sel.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    const ids = c.fed()!.nodes.map((n) => n.id);
    expect(ids).toEqual(['the-forge:c1', 'api-forge:a1']);
  });

  it('stats line and scope back to federation restore the overlay model', async () => {
    setupMulti();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-scope="views"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const stats = el.querySelector('[data-section="stats"]')!.textContent!;
    // merged model: 4 real nodes (2+2), 1 real edge, 3 components
    // (c1 and a1 are isolated; svc→db is the only connected subgraph)
    expect(c.fed()!.nodes.length).toBe(4);
    expect(c.fed()!.edges.length).toBe(1);
    expect(c.componentCount()).toBe(3);
    expect(c.providerCount()).toBe(2);
    expect(stats).toBeTruthy();

    (el.querySelector('[data-scope="federation"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(c.fed()!.nodes.map((n) => n.id)).toContain('capability:graph');
  });

  it('no contract-valid views → no scope pill (never a dead toggle)', async () => {
    localStorage.clear();
    setup({
      graphs: vi.fn(() =>
        of({
          availability: { state: 'available' },
          views: [{ bogus: true }],
          studio_url: null,
        } as unknown as GraphBundle),
      ),
    });
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    expect(c.hasViews()).toBe(false);
    expect(el.querySelector('[data-toggle="scope"]')).toBeNull();
  });
});
