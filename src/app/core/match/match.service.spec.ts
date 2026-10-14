import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  MATCH_LIMITATION_KEY,
  MatchCandidate,
  MatchService,
  groupHits,
  matchTokens,
  rankHits,
  scoreCandidate,
} from './match.service';
import { PortalApi } from '../api/api.client';
import { ApiError } from '../api/api.error';
import { PortalStore } from '../portal/portal.store';
import {
  AgentDescriptor,
  BootstrapPayload,
  McpServerDescriptor,
  SkillDescriptor,
} from '../api/api.models';

const AGENTS: AgentDescriptor[] = [
  {
    id: 'kiro-review',
    name: 'Kiro Review',
    role: 'adversarial spec reviewer',
    description: 'Reviews specs and designs adversarially before implementation.',
    authority: null,
    domains: ['spec', 'review'],
    skills: ['kiro-spec'],
    hosts: [],
    state: 'available',
  },
  {
    id: 'spark-runner',
    name: 'Spark Runner',
    role: 'glue etl executor',
    description: 'Runs PySpark Glue jobs on EMR clusters.',
    authority: null,
    domains: ['data'],
    skills: ['glue-etl'],
    hosts: ['devin'],
    state: 'available',
  },
];

const SKILLS: SkillDescriptor[] = [
  {
    id: 'glue-etl',
    name: 'glue-etl',
    domain: 'data',
    description: 'PySpark Glue ETL authoring and debugging.',
    state: 'available',
    hosts: [],
    source: 'catalog',
  },
  {
    id: 'kiro-spec',
    name: 'kiro-spec',
    domain: 'spec',
    description: 'Spec-driven workflow phases.',
    state: 'available',
    hosts: [],
    source: 'catalog',
  },
];

const MCP: McpServerDescriptor[] = [
  { id: 'forge-mcp', state: 'TOOLS_DISCOVERED', host: 'claude', tools_count: 4, last_verify: null },
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
    capabilities: [{ id: 'federation', state: 'supported' }],
    nav: [],
  },
  health: { state: 'VERIFIED', checks: [], workspace: null, profile: null, updated_at: null },
};

const FEDERATION = {
  specialists: [
    { provider: 'spark-forge-aws', state: 'INSTALLED', cli: 'sparkforge', checkout: 'E:/sf' },
  ],
  installed_forges: ['the-forge', 'spark-forge-aws'],
  registry: { count: 2, path: 'x' },
  summary: { catalog: 1, installed: 2, with_mcp: 0, with_checkout: 1 },
};

function fakeApi(overrides: Partial<PortalApi> = {}): PortalApi {
  return {
    bootstrap: () => of(BOOTSTRAP),
    installationStatus: () => of(BOOTSTRAP.health),
    agents: () => of(AGENTS),
    skills: () => of(SKILLS),
    mcpServers: () => of(MCP),
    federation: () => of(FEDERATION),
    ...overrides,
  } as unknown as PortalApi;
}

describe('matchTokens / scoreCandidate / rankHits / groupHits (pure)', () => {
  it('tokenizes normalized, deduped query terms', () => {
    expect(matchTokens('Glue  GLUE-etl!')).toEqual(['glue', 'etl']);
  });

  it('scores token overlap per field with fractional weight', () => {
    const c: MatchCandidate = {
      kind: 'agent',
      id: 'a',
      label: 'A',
      route: '/agents',
      icon: 'agents',
      fields: [
        { name: 'role', value: 'glue etl executor', weight: 3 },
        { name: 'description', value: 'glue jobs', weight: 2 },
      ],
    };
    const hit = scoreCandidate(['glue', 'etl'], c);
    // role matched 2/2 tokens (w3) + description 1/2 (w2)
    expect(hit).not.toBeNull();
    expect(hit!.score).toBeCloseTo(3 * 1 + 2 * 0.5);
    expect(hit!.hits.map((h) => h.field)).toEqual(['role', 'description']);
    expect(hit!.hits[0].tokens).toEqual(['glue', 'etl']);
    expect(hit!.hits[1].tokens).toEqual(['glue']);
    expect(hit!.limitationKey).toBe(MATCH_LIMITATION_KEY);
  });

  it('returns null when no field matches — never an empty-evidence hit', () => {
    const c: MatchCandidate = {
      kind: 'skill',
      id: 's',
      label: 'S',
      route: '/skills',
      icon: 'skills',
      fields: [{ name: 'name', value: 'glue', weight: 4 }],
    };
    expect(scoreCandidate(['terraform'], c)).toBeNull();
    expect(scoreCandidate([], c)).toBeNull();
  });

  it('ranks by score desc then deterministic label/id tie-break', () => {
    const mk = (id: string, score: number): MatchCandidate => ({
      kind: 'skill',
      id,
      label: id,
      route: '/skills',
      icon: 'skills',
      fields: [{ name: 'name', value: `x${score === 2 ? ' glue glue2' : ' glue'}`, weight: score }],
    });
    const hits = rankHits(
      [mk('b', 4), mk('a', 4), mk('z', 1)].map((c) => scoreCandidate(['glue'], c)!).filter(Boolean),
    );
    expect(hits.map((h) => h.id)).toEqual(['a', 'b', 'z']);
  });

  it('groups hits in kind order, dropping empty kinds', () => {
    const groups = groupHits([
      {
        kind: 'mcp',
        id: 'm',
        label: 'm',
        icon: 'mcp',
        route: '/mcp',
        score: 1,
        hits: [],
        limitationKey: 'x',
      },
      {
        kind: 'agent',
        id: 'a',
        label: 'a',
        icon: 'agents',
        route: '/agents',
        score: 1,
        hits: [],
        limitationKey: 'x',
      },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['agent', 'mcp']);
  });
});

describe('MatchService', () => {
  async function setup(overrides: Partial<PortalApi> = {}) {
    TestBed.configureTestingModule({
      providers: [{ provide: PortalApi, useValue: fakeApi(overrides) }],
    });
    const store = TestBed.inject(PortalStore);
    await store.bootstrap();
    return TestBed.inject(MatchService);
  }

  it('answers "which agent works with glue" with evidence on the agent hit', async () => {
    const svc = await setup();
    await svc.searchNow('glue');
    const report = svc.report();
    expect(report.total).toBeGreaterThan(0);
    const agents = report.groups.find((g) => g.kind === 'agent');
    expect(agents).toBeTruthy();
    const runner = agents!.hits.find((h) => h.id === 'spark-runner');
    expect(runner).toBeTruthy();
    // evidence: real field names + values + matched tokens
    expect(runner!.hits.length).toBeGreaterThan(0);
    expect(runner!.hits.every((h) => h.value && h.tokens.includes('glue'))).toBe(true);
    expect(runner!.limitationKey).toBe('match.limitation');
    expect(runner!.route).toBe('/agents');
  });

  it('matches skills and forjas too, grouped by kind', async () => {
    const svc = await setup();
    await svc.searchNow('spark');
    const kinds = svc.report().groups.map((g) => g.kind);
    expect(kinds).toContain('skill');
    expect(kinds).toContain('forge');
    const forge = svc
      .report()
      .groups.find((g) => g.kind === 'forge')!
      .hits.find((h) => h.id === 'spark-forge-aws');
    expect(forge).toBeTruthy();
    expect(forge!.route).toBe('/forges/spark-forge-aws');
  });

  it('includes the serving Forja from bootstrap without extra calls', async () => {
    const svc = await setup();
    await svc.searchNow('the-forge');
    const hits = svc.report().groups.find((g) => g.kind === 'forge')!.hits;
    expect(hits.some((h) => h.id === 'the-forge')).toBe(true);
  });

  it('reports an empty result honestly for unmatched queries', async () => {
    const svc = await setup();
    await svc.searchNow('nonexistent-capability-zzz');
    expect(svc.report().total).toBe(0);
    expect(svc.report().groups).toEqual([]);
    expect(svc.searched()).toBe(true);
  });

  it('flags the kind unverified on non-404 failure but keeps other results', async () => {
    const svc = await setup({
      agents: () => throwError(() => new ApiError(0)),
    });
    await svc.searchNow('glue');
    const report = svc.report();
    expect(report.unverified).toContain('agent');
    expect(report.groups.map((g) => g.kind)).not.toContain('agent');
    // skills/forges/mcp still answered
    expect(report.groups.map((g) => g.kind)).toContain('skill');
  });

  it('treats 404 as absent — skipped, not flagged unverified', async () => {
    const svc = await setup({
      mcpServers: () =>
        throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
    });
    await svc.searchNow('forge');
    const report = svc.report();
    expect(report.absent).toContain('mcp');
    expect(report.unverified).not.toContain('mcp');
  });
});
