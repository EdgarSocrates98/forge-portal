import {
  FED_GRAPH_SCHEMA,
  FedGraph,
  FederatedInput,
  buildFederatedGraph,
  nodeNeighbors,
} from './federated';
import {
  AgentDescriptor,
  HostDetection,
  McpServerDescriptor,
  PortalCapability,
  SkillDescriptor,
  TaskExecution,
} from '../api/api.models';

const CAPS: PortalCapability[] = [
  { id: 'graph', state: 'supported' },
  { id: 'mcp', state: 'unverified' }, // descriptor self-reports unverified
  { id: 'tasks', state: 'supported' },
];

const SKILLS: SkillDescriptor[] = [
  {
    id: 'kiro-spec',
    name: 'kiro-spec',
    domain: 'spec',
    description: 'Spec workflow.',
    state: 'available',
    hosts: ['claude'],
    source: 'catalog', // provenance label — NOT a forge, must not create one
  },
  {
    id: 'smith',
    name: 'smith',
    domain: null,
    description: 'Forge-authored skill.',
    state: 'available',
    hosts: [],
    source: 'the-forge', // source naming a known forge → origin edge
  },
  {
    // descriptor carries an explicit origin → trusted as-is
    id: 'audit-skill',
    name: 'audit-skill',
    domain: 'ops',
    description: 'Audits.',
    state: 'unverified',
    hosts: [],
    ...({ origin: 'api-forge' } as Record<string, unknown>),
  } as SkillDescriptor,
];

const AGENTS: AgentDescriptor[] = [
  {
    id: 'reviewer',
    name: 'reviewer',
    role: 'review',
    description: 'Reviews changes.',
    authority: null,
    domains: ['code'],
    skills: ['kiro-spec', 'ghost-skill', 'kiro-spec'], // repeat must dedupe
    hosts: [],
    state: 'available',
    ...({ forge_id: 'the-forge' } as Record<string, unknown>),
  } as AgentDescriptor,
];

const MCP: McpServerDescriptor[] = [
  {
    id: 'forge-mcp',
    state: 'CONFIGURED',
    host: 'claude',
    tools_count: 3,
    last_verify: null,
  },
  { id: 'loose', state: 'NOT_CONFIGURED', host: null, tools_count: null, last_verify: null },
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

const VIEWS: Record<string, unknown>[] = [
  {
    schema: 'forge/ForgeGraphView/v1',
    descriptor: { provider_id: 'the-forge', graph_id: 'federated', domain: 'federated' },
    nodes: [
      {
        id: 'the-forge:cap:graph',
        kind: 'capability',
        label: 'graph',
        source_provider: 'the-forge',
      },
      { id: 'api-forge:api:x', kind: 'api', label: 'x', source_provider: 'api-forge' },
    ],
    edges: [],
  },
];

function fullInput(): FederatedInput {
  return {
    capabilities: CAPS,
    skills: SKILLS,
    agents: AGENTS,
    mcp: MCP,
    hosts: HOSTS,
    tasks: TASKS,
    graphViews: VIEWS,
    servingForge: 'the-forge',
    availability: {
      bootstrap: 'loaded',
      graphs: 'loaded',
      capabilities: 'loaded',
      skills: 'loaded',
      agents: 'loaded',
      mcp: 'loaded',
      hosts: 'loaded',
      tasks: 'loaded',
    },
  };
}

const node = (g: FedGraph, id: string) => g.nodes.find((n) => n.id === id);
const edge = (g: FedGraph, id: string) => g.edges.find((e) => e.id === id);

describe('buildFederatedGraph — §5.6 federated model', () => {
  it('builds one node per real entity, kind-namespaced, evidence-tagged', () => {
    const g = buildFederatedGraph(fullInput());
    expect(g.schema).toBe(FED_GRAPH_SCHEMA);
    // kinds present
    expect(node(g, 'forge:the-forge')?.kind).toBe('forge');
    expect(node(g, 'capability:graph')?.kind).toBe('capability');
    expect(node(g, 'skill:kiro-spec')?.kind).toBe('skill');
    expect(node(g, 'agent:reviewer')?.kind).toBe('agent');
    expect(node(g, 'mcp:forge-mcp')?.kind).toBe('mcp');
    expect(node(g, 'host:claude')?.kind).toBe('host');
    expect(node(g, 'operation:task-1')?.kind).toBe('operation');
    // evidence carries every endpoint that supplied OR referenced it —
    // kiro-spec came from /skills and is referenced by /agents
    expect(node(g, 'skill:kiro-spec')?.evidence).toEqual(['agents', 'skills']);
    // serving forge is evidenced by bootstrap, the view provider, and
    // every endpoint that declares a relation to it
    expect(node(g, 'forge:the-forge')?.evidence).toEqual([
      'agents',
      'bootstrap',
      'capabilities',
      'graphs',
      'skills',
      'tasks',
    ]);
    expect(node(g, 'forge:api-forge')?.evidence).toEqual(['graphs', 'skills']);
  });

  it('emits forge→capability declares edges from the serving Forja', () => {
    const g = buildFederatedGraph(fullInput());
    const e = edge(g, 'forge:the-forge|declares|capability:graph');
    expect(e).toBeTruthy();
    expect(e?.evidence).toBe('capabilities');
    expect(edge(g, 'forge:the-forge|declares|capability:tasks')).toBeTruthy();
    // no serving Forja → no declares edges (origin is never guessed)
    const g2 = buildFederatedGraph({ ...fullInput(), servingForge: null });
    expect(g2.edges.some((x) => x.kind === 'declares')).toBe(false);
  });

  it('emits origin edges only when the descriptor carries one', () => {
    const g = buildFederatedGraph(fullInput());
    // explicit origin field trusted as declared
    expect(edge(g, 'skill:audit-skill|origin|forge:api-forge')).toBeTruthy();
    // `source` accepted when it names a known forge…
    expect(edge(g, 'skill:smith|origin|forge:the-forge')).toBeTruthy();
    // …but 'catalog' is provenance, not a forge — no node, no edge
    expect(edge(g, 'skill:kiro-spec|origin|forge:catalog')).toBeFalsy();
    expect(node(g, 'forge:catalog')).toBeFalsy();
    // agent forge_id and task origin are honored
    expect(edge(g, 'agent:reviewer|origin|forge:the-forge')).toBeTruthy();
    expect(edge(g, 'operation:task-1|origin|forge:the-forge')).toBeTruthy();
  });

  it('emits agent→skill associated edges and resolves name references', () => {
    const g = buildFederatedGraph(fullInput());
    const e = edge(g, 'agent:reviewer|associated|skill:kiro-spec');
    expect(e?.evidence).toBe('agents');
    // the repeated 'kiro-spec' ref emitted exactly one edge
    expect(g.edges.filter((x) => x.target === 'skill:kiro-spec').length).toBe(1);
    // a declared-but-absent skill becomes a reference node — never a dangling edge
    expect(edge(g, 'agent:reviewer|associated|skill:ghost-skill')).toBeTruthy();
    expect(node(g, 'skill:ghost-skill')?.evidence).toEqual(['agents']);
  });

  it('emits mcp→host bound_to edges only when the binding is present', () => {
    const g = buildFederatedGraph(fullInput());
    expect(edge(g, 'mcp:forge-mcp|bound_to|host:claude')?.evidence).toBe('mcp');
    expect(g.edges.some((e) => e.source === 'mcp:loose')).toBe(false);
  });

  it('is deterministic — input order never changes the output', () => {
    const a = buildFederatedGraph(fullInput());
    const shuffled = fullInput();
    shuffled.capabilities = [...CAPS].reverse();
    shuffled.skills = [...SKILLS].reverse();
    shuffled.mcp = [...MCP].reverse();
    const b = buildFederatedGraph(shuffled);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // node ids strictly sorted
    const ids = a.nodes.map((n) => n.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('dedupes by id and merges evidence instead of duplicating', () => {
    const g = buildFederatedGraph({
      ...fullInput(),
      capabilities: [...CAPS, { id: 'graph', state: 'supported' }], // same id twice
      skills: [...SKILLS, { ...SKILLS[0] }],
    });
    expect(g.nodes.filter((n) => n.id === 'capability:graph').length).toBe(1);
    expect(g.nodes.filter((n) => n.id === 'skill:kiro-spec').length).toBe(1);
    expect(edge(g, 'forge:the-forge|declares|capability:graph')).toBeTruthy();
    // host node exists once; the mcp binding counts as evidence too
    expect(node(g, 'host:claude')?.evidence).toEqual(['hosts', 'mcp']);
  });

  it('marks nodes unverified when their source was unavailable/unverified', () => {
    const g = buildFederatedGraph({
      ...fullInput(),
      availability: { ...fullInput().availability, skills: 'unavailable', mcp: 'unverified' },
    });
    // evidence-only-skills nodes go unverified…
    expect(node(g, 'skill:smith')?.unverified).toBe(true);
    expect(node(g, 'skill:audit-skill')?.unverified).toBe(true);
    expect(node(g, 'mcp:forge-mcp')?.unverified).toBe(true);
    // …but a node corroborated by a still-loaded endpoint stays verified
    expect(node(g, 'skill:kiro-spec')?.unverified).toBe(false); // /agents also names it
    expect(node(g, 'host:claude')?.unverified).toBe(false); // /hosts loaded
    expect(node(g, 'capability:graph')?.unverified).toBe(false);
    // a referenced-only node keeps the referring endpoint's state
    expect(node(g, 'skill:ghost-skill')?.unverified).toBe(false); // via agents (loaded)
  });

  it('marks self-reported unverified descriptors even on a loaded source', () => {
    const g = buildFederatedGraph(fullInput());
    expect(node(g, 'capability:mcp')?.unverified).toBe(true); // state: 'unverified'
    expect(node(g, 'skill:audit-skill')?.unverified).toBe(true);
    expect(node(g, 'capability:graph')?.unverified).toBe(false);
  });

  it('reports per-kind counts and the source availability map', () => {
    const g = buildFederatedGraph(fullInput());
    expect(g.counts.forge).toBe(2); // the-forge + api-forge
    expect(g.counts.capability).toBe(3);
    expect(g.counts.skill).toBe(4); // 3 loaded + ghost-skill reference
    expect(g.counts.agent).toBe(1);
    expect(g.counts.mcp).toBe(2);
    expect(g.counts.host).toBe(1);
    expect(g.counts.operation).toBe(1);
    expect(g.sources.skills).toEqual({ state: 'loaded', endpoint: 'GET /api/v1/skills' });
    expect(g.sources.graphs.endpoint).toBe('GET /api/v1/graphs');
  });

  it('nodeNeighbors returns the direct-impact set with sorted edges', () => {
    const g = buildFederatedGraph(fullInput());
    const { nodes, edges } = nodeNeighbors(g, 'forge:the-forge');
    expect(nodes.has('forge:the-forge')).toBe(true);
    expect(nodes.has('capability:graph')).toBe(true);
    expect(nodes.has('skill:smith')).toBe(true);
    expect(nodes.has('operation:task-1')).toBe(true);
    expect(nodes.has('mcp:forge-mcp')).toBe(false); // not adjacent
    expect(edges.length).toBeGreaterThanOrEqual(5);
    const ids = edges.map((e) => e.id);
    expect([...ids].sort()).toEqual(ids);
    // isolated node → empty impact
    expect(nodeNeighbors(g, 'host:claude').edges.length).toBe(1); // bound_to only
  });
});
