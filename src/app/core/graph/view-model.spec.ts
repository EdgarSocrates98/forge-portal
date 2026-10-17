import { EDGE_STYLE, KIND_STYLE, isAbsent, toViewModel } from './view-model';
import { FED_NODE_KINDS, FedGraph, buildFederatedGraph } from './federated';
import { GRAPH_LAYOUTS } from './renderer';
import {
  AgentDescriptor,
  HostDetection,
  McpServerDescriptor,
  PortalCapability,
  SkillDescriptor,
  TaskExecution,
} from '../api/api.models';

const CAPS: PortalCapability[] = [{ id: 'graph', state: 'supported' }];

const SKILLS: SkillDescriptor[] = [
  {
    id: 's1',
    name: 's1',
    domain: null,
    description: 'Skill.',
    state: 'available',
    hosts: [],
    ...({ forge_id: 'the-forge' } as Record<string, unknown>),
  } as SkillDescriptor,
];

const AGENTS: AgentDescriptor[] = [
  {
    id: 'a1',
    name: 'a1',
    role: 'r',
    description: 'Agent.',
    authority: null,
    domains: [],
    skills: ['s1'],
    hosts: [],
    state: 'available',
    ...({ forge_id: 'the-forge' } as Record<string, unknown>),
  } as AgentDescriptor,
];

const MCP: McpServerDescriptor[] = [
  { id: 'm1', state: 'CONFIGURED', host: 'claude', tools_count: 1, last_verify: null },
];

const HOSTS: HostDetection[] = [
  {
    host: 'claude',
    detected: true,
    version: null,
    supported: true,
    logged_in: true,
    integration: 'MCP_REGISTERED',
    launchable: true,
  },
];

const TASKS: TaskExecution[] = [
  {
    id: 't1',
    verb: 'doctor',
    label: 'doctor',
    stage: 'completed',
    started_at: '2026-10-13T00:00:00Z',
    finished_at: '2026-10-13T00:00:01Z',
    exit_code: 0,
    ...({ origin: 'the-forge' } as Record<string, unknown>),
  } as TaskExecution,
];

const BASE: FedGraph = buildFederatedGraph({
  capabilities: CAPS,
  skills: SKILLS,
  agents: AGENTS,
  mcp: MCP,
  hosts: HOSTS,
  tasks: TASKS,
  graphViews: [
    {
      descriptor: { provider_id: 'api-forge' },
      nodes: [{ id: 'x', source_provider: 'platform-forge' }],
    },
  ],
  servingForge: 'the-forge',
});

describe('graph view-model — FedGraph → GraphViewModel', () => {
  it('maps every node/edge keeping ids, labels, kinds and evidence', () => {
    const vm = toViewModel(BASE);
    expect(vm.nodes.length).toBe(BASE.nodes.length);
    expect(vm.edges.length).toBe(BASE.edges.length);
    const skill = vm.nodes.find((n) => n.id === 'skill:s1')!;
    expect(skill.label).toBe('s1');
    expect(skill.kind).toBe('skill');
    const declares = vm.edges.find((e) => e.kind === 'declares')!;
    expect(declares.source).toBe('forge:the-forge');
    expect(declares.target).toBe('capability:graph');
    expect(declares.evidence).toBe('capabilities');
  });

  it('carries the honesty flags — unverified on, absent only when every referrer failed', () => {
    const vm = toViewModel(BASE);
    // api-forge only appears via /graphs, which loaded → verified
    const apiForge = vm.nodes.find((n) => n.id === 'forge:api-forge')!;
    expect(apiForge.unverified).toBe(false);
    expect(apiForge.absent).toBe(false);

    // Reference-only node whose referrer stayed loaded → verified.
    const dangling = buildFederatedGraph({
      mcp: [
        { id: 'm1', state: 'CONFIGURED', host: 'gone-host', tools_count: 1, last_verify: null },
      ],
      availability: { hosts: 'unavailable' },
    });
    const gone = toViewModel(dangling).nodes.find((n) => n.id === 'host:gone-host')!;
    expect(gone.unverified).toBe(false);
    expect(gone.absent).toBe(false);

    // Same node when every endpoint that names it failed → absent.
    const trulyAbsent = buildFederatedGraph({
      mcp: [
        { id: 'm1', state: 'CONFIGURED', host: 'gone-host', tools_count: 1, last_verify: null },
      ],
      availability: { hosts: 'unavailable', mcp: 'unavailable', bootstrap: 'unavailable' },
    });
    const node = trulyAbsent.nodes.find((n) => n.id === 'host:gone-host')!;
    expect(node.unverified).toBe(true);
    expect(isAbsent(node, trulyAbsent)).toBe(true);
    const gone2 = toViewModel(trulyAbsent).nodes.find((n) => n.id === 'host:gone-host')!;
    expect(gone2.absent).toBe(true);
  });

  it('gives every kind a distinct shape AND color — never color alone', () => {
    for (const k of FED_NODE_KINDS) {
      expect(KIND_STYLE[k].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(KIND_STYLE[k].shape).toBeTruthy();
    }
    const shapes = new Set(Object.values(KIND_STYLE).map((s) => s.shape));
    const colors = new Set(Object.values(KIND_STYLE).map((s) => s.color));
    expect(shapes.size).toBe(FED_NODE_KINDS.length);
    expect(colors.size).toBe(FED_NODE_KINDS.length);
  });

  it('covers every edge kind and ships at least three layouts', () => {
    for (const k of ['declares', 'origin', 'associated', 'bound_to'] as const) {
      expect(EDGE_STYLE[k].color).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(GRAPH_LAYOUTS.length).toBeGreaterThanOrEqual(3);
  });
});
