import { AgentDescriptor } from '../../core/api/api.models';
import { buildFederatedGraph } from '../../core/graph/federated';
import {
  NO_FILTERS,
  UNDECLARED,
  agentSubgraph,
  compareAgents,
  declaredForge,
  domainOptions,
  filterAgents,
  forgeOptions,
  hostOptions,
  normText,
  skillOptions,
} from './agents.data';

const A = (
  id: string,
  extra: Partial<AgentDescriptor> & Record<string, unknown> = {},
): AgentDescriptor =>
  ({
    id,
    name: id,
    role: '',
    description: '',
    authority: null,
    domains: [],
    skills: [],
    hosts: [],
    state: 'available',
    ...extra,
  }) as AgentDescriptor;

const ROSTER: AgentDescriptor[] = [
  A('kiro-review', {
    name: 'Kiro Review',
    role: 'adversarial reviewer',
    description: 'Reviews specs adversarially.',
    domains: ['spec', 'review'],
    skills: ['kiro-spec'],
    ...({ forge_id: 'the-forge' } as Record<string, unknown>),
  }),
  A('spark-runner', {
    name: 'Spark Runner',
    role: 'glue executor',
    description: 'Runs PySpark Glue jobs.',
    domains: ['data'],
    skills: ['glue-etl'],
    hosts: ['devin'],
    ...({ origin: 'spark-forge-aws' } as Record<string, unknown>),
  }),
  A('no-origin', { description: 'No declared forge.', hosts: ['claude'] }),
];

describe('agents.data — Agent Studio derivations', () => {
  it('normText folds diacritics and case', () => {
    expect(normText('  Éxecução ')).toBe('execucao');
  });

  it('declaredForge reads real origin keys, never the serving Forja', () => {
    expect(declaredForge(ROSTER[0]!)).toBe('the-forge'); // forge_id key
    expect(declaredForge(ROSTER[1]!)).toBe('spark-forge-aws'); // origin key
    expect(declaredForge(ROSTER[2]!)).toBeNull(); // nothing declared
  });

  it('declaredForge never promotes a provenance `source` label', () => {
    const a = A('x', { ...({ source: 'catalog' } as Record<string, unknown>) });
    expect(declaredForge(a)).toBeNull();
    // …unless it names a Forja we already know
    expect(declaredForge(a, new Set(['the-forge']))).toBeNull();
    const b = A('y', { ...({ source: 'the-forge' } as Record<string, unknown>) });
    expect(declaredForge(b)).toBe('the-forge'); // KNOWN_FORGE_IDS
  });

  it('filterAgents narrows by domain, skill, host and text', () => {
    expect(filterAgents(ROSTER, { ...NO_FILTERS, domain: 'data' }).map((a) => a.id)).toEqual([
      'spark-runner',
    ]);
    expect(filterAgents(ROSTER, { ...NO_FILTERS, skill: 'kiro-spec' }).map((a) => a.id)).toEqual([
      'kiro-review',
    ]);
    expect(filterAgents(ROSTER, { ...NO_FILTERS, host: 'devin' }).map((a) => a.id)).toEqual([
      'spark-runner',
    ]);
    expect(filterAgents(ROSTER, { ...NO_FILTERS, query: 'glue' }).map((a) => a.id)).toEqual([
      'spark-runner',
    ]);
    // text search also hits hosts/authority
    expect(filterAgents(ROSTER, { ...NO_FILTERS, query: 'claude' }).map((a) => a.id)).toEqual([
      'no-origin',
    ]);
  });

  it('filterAgents on forge matches declared origins only — undeclared is its own bucket', () => {
    expect(filterAgents(ROSTER, { ...NO_FILTERS, forge: 'the-forge' }).map((a) => a.id)).toEqual([
      'kiro-review',
    ]);
    expect(filterAgents(ROSTER, { ...NO_FILTERS, forge: UNDECLARED }).map((a) => a.id)).toEqual([
      'no-origin',
    ]);
    // a Forja nobody declared matches nothing — never a silent pass
    expect(filterAgents(ROSTER, { ...NO_FILTERS, forge: 'api-forge' })).toEqual([]);
  });

  it('options are mined from catalog values only', () => {
    expect(domainOptions(ROSTER)).toEqual(['data', 'review', 'spec']);
    expect(skillOptions(ROSTER)).toEqual(['glue-etl', 'kiro-spec']);
    expect(hostOptions(ROSTER)).toEqual(['claude', 'devin']);
    const f = forgeOptions(ROSTER);
    expect(f.declared).toEqual(['spark-forge-aws', 'the-forge']);
    expect(f.hasUndeclared).toBe(true);
    expect(forgeOptions([ROSTER[0]!]).hasUndeclared).toBe(false);
  });

  it('compareAgents pairs real fields; absent renders absent, never a value', () => {
    const rows = compareAgents(ROSTER[0]!, ROSTER[2]!);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey['agents.role']!.a.text).toBe('adversarial reviewer');
    expect(byKey['agents.role']!.b.absent).toBe(true);
    expect(byKey['agents.role']!.b.text).toBeNull();
    // absent-vs-present is not a value difference
    expect(byKey['agents.role']!.differ).toBe(false);
    // real divergence on both declared values
    const rows2 = compareAgents(ROSTER[0]!, ROSTER[1]!);
    const role = rows2.find((r) => r.key === 'agents.role')!;
    expect(role.differ).toBe(true);
    const forge = rows2.find((r) => r.key === 'agents.origin')!;
    expect(forge.a.text).toBe('the-forge');
    expect(forge.b.text).toBe('spark-forge-aws');
    expect(forge.differ).toBe(true);
    // identical values do not differ
    const same = compareAgents(ROSTER[0]!, ROSTER[0]!);
    expect(same.every((r) => !r.differ)).toBe(true);
  });
});

describe('agents.data — agentSubgraph', () => {
  const fed = buildFederatedGraph({
    skills: [
      {
        id: 'kiro-spec',
        name: 'kiro-spec',
        domain: 'spec',
        description: 'd',
        state: 'available',
        hosts: [],
      },
    ],
    agents: ROSTER,
    servingForge: 'the-forge',
    availability: {
      agents: 'loaded',
      skills: 'loaded',
      bootstrap: 'loaded',
    },
  });

  it('keeps only kept agents, their declared edges and the edge endpoints', () => {
    const sub = agentSubgraph(fed, new Set(['kiro-review']));
    const ids = sub.nodes.map((n) => n.id);
    expect(ids).toContain('agent:kiro-review');
    expect(ids).toContain('skill:kiro-spec'); // associated edge endpoint
    expect(ids).toContain('forge:the-forge'); // origin edge endpoint
    expect(ids).not.toContain('agent:spark-runner');
    expect(ids).not.toContain('agent:no-origin');
    expect(
      sub.edges.every((e) => e.source === 'agent:kiro-review' || e.target === 'agent:kiro-review'),
    ).toBe(true);
    expect(sub.counts.agent).toBe(1);
    expect(sub.counts.skill).toBe(1);
    expect(sub.counts.forge).toBe(1);
    // sources strip preserved verbatim — evidence untouched
    expect(sub.sources).toEqual(fed.sources);
  });

  it('drops nothing when every agent is kept and filters remove the rest', () => {
    const all = agentSubgraph(fed, new Set(ROSTER.map((a) => a.id)));
    expect(all.counts.agent).toBe(3);
    // unrelated kinds stay out of the agent projection
    expect(all.nodes.every((n) => ['agent', 'skill', 'forge'].includes(n.kind))).toBe(true);
    // a filter that keeps no agent yields an empty (but valid) graph
    const none = agentSubgraph(fed, new Set());
    expect(none.nodes).toEqual([]);
    expect(none.edges).toEqual([]);
  });
});
