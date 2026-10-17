import {
  AccountEnvironment,
  AgentDescriptor,
  FederationSnapshot,
  HostDetection,
  McpServerDescriptor,
  RegistryState,
  SkillDescriptor,
  TaskExecution,
} from '../api/api.models';
import {
  REC_KIND_ORDER,
  agentsForDomain,
  agentsForSkill,
  buildRecommendations,
  skillsInDomain,
} from './recommend.data';

const skill = (id: string, domain: string | null, name = id): SkillDescriptor => ({
  id,
  name,
  domain,
  description: '',
  state: 'available',
  hosts: [],
});

const agent = (id: string, skills: string[] = [], domains: string[] = []): AgentDescriptor => ({
  id,
  name: id,
  role: '',
  description: '',
  authority: null,
  domains,
  skills,
  hosts: [],
  state: 'available',
});

const host = (over: Partial<HostDetection> = {}): HostDetection => ({
  host: 'claude',
  detected: true,
  version: '1.0',
  supported: true,
  logged_in: true,
  integration: 'MCP_REGISTERED',
  launchable: true,
  ...over,
});

const mcp = (id: string, state: McpServerDescriptor['state']): McpServerDescriptor => ({
  id,
  state,
  host: 'claude',
  tools_count: 1,
  last_verify: null,
});

const task = (id: string, verb: string, over: Partial<TaskExecution> = {}): TaskExecution => ({
  id,
  verb,
  label: verb,
  stage: 'completed',
  started_at: 'x',
  finished_at: 'x',
  exit_code: 0,
  receipt: { status: 'ok' },
  ...over,
});

const fed = (specialists: string[], installed: string[]): FederationSnapshot => ({
  specialists: specialists.map((provider) => ({ provider })),
  installed_forges: installed,
  registry: { count: installed.length, path: '/reg' },
  summary: {
    catalog: specialists.length,
    installed: installed.length,
    with_mcp: 0,
    with_checkout: 0,
  },
});

const registry = (forges: string[]): RegistryState => ({
  schema: 'forge-cli/RegistryState/v1',
  state_path: '/state.json',
  present: true,
  forges: Object.fromEntries(forges.map((f) => [f, { forge: f }])),
});

const env = (vars: AccountEnvironment['variables']): AccountEnvironment => ({
  schema: 'forge/InstallEnvironment/v1',
  scope: 'user',
  forge_id: 'the-forge',
  prefix: 'FORGE_',
  state: 'PARTIAL',
  variables: vars,
  windows_aliases: false,
});

describe('recommend.data — missing-component', () => {
  it('flags catalog specialists absent from installed_forges AND registry', () => {
    const recs = buildRecommendations({
      federation: fed(['api-forge', 'platform-forge'], ['api-forge']),
      registry: registry(['api-forge']),
    });
    expect(recs.map((r) => r.id)).toEqual(['missing-component:platform-forge']);
    const r = recs[0];
    expect(r.reasonKey).toBe('recommend.reason.missingComponent');
    expect(r.params['forge']).toBe('platform-forge');
    expect(r.route).toBe('/federation');
    // both grounding sources are named
    expect(r.source.map((s) => s.endpoint)).toContain('GET /api/v1/registry/state');
    expect(r.refs).toEqual([{ kind: 'forge', id: 'platform-forge' }]);
  });

  it('does not flag a catalog entry present only in the registry', () => {
    const recs = buildRecommendations({
      federation: fed(['api-forge'], []),
      registry: registry(['api-forge']),
    });
    expect(recs).toEqual([]);
  });

  it('stays silent when the registry never loaded — source list reflects it', () => {
    const recs = buildRecommendations({
      federation: fed(['api-forge', 'platform-forge'], ['api-forge']),
      registry: null,
    });
    expect(recs.map((r) => r.id)).toEqual(['missing-component:platform-forge']);
    // the registry was not consulted → it cannot appear as a source
    expect(recs[0].source.map((s) => s.endpoint)).not.toContain('GET /api/v1/registry/state');
  });

  it('emits nothing when federation is unavailable', () => {
    expect(buildRecommendations({ federation: null })).toEqual([]);
  });
});

describe('recommend.data — incomplete-config', () => {
  it('flags required env vars missing or invalid, naming the field', () => {
    const recs = buildRecommendations({
      environment: env([
        { name: 'A', required: true, present: false, valid: null, kind: 'directory', path: null },
        { name: 'B', required: true, present: true, valid: false, kind: 'file', path: '/b' },
        { name: 'C', required: false, present: false, valid: null, kind: 'file', path: null },
      ]),
    });
    expect(recs.map((r) => r.id).sort()).toEqual([
      'incomplete-config:env:A',
      'incomplete-config:env:B:invalid',
    ]);
    expect(recs.find((r) => r.id.endsWith(':A'))?.reasonKey).toBe('recommend.reason.envMissing');
    expect(recs.find((r) => r.id.endsWith(':invalid'))?.reasonKey).toBe(
      'recommend.reason.envInvalid',
    );
    expect(recs[0].source[0].field).toContain('account_environment.variables');
  });

  it('flags a detected host still at NOT_DETECTED integration', () => {
    const recs = buildRecommendations({
      hosts: [host({ integration: 'NOT_DETECTED' })],
    });
    expect(recs.map((r) => r.id)).toEqual(['incomplete-config:host:claude']);
    expect(recs[0].source).toEqual([{ endpoint: 'GET /api/v1/hosts', field: 'integration' }]);
  });
});

describe('recommend.data — incompatible-dependency / mcp / failures', () => {
  it('flags a detected host self-reported unsupported', () => {
    const recs = buildRecommendations({ hosts: [host({ supported: false })] });
    expect(recs.map((r) => r.id)).toEqual(['incompatible-dependency:claude']);
    expect(recs[0].severity).toBe('warning');
  });

  it('flags MCP servers in a non-operational reported state only', () => {
    const recs = buildRecommendations({
      mcp: [
        mcp('a', 'NOT_CONFIGURED'),
        mcp('b', 'FAILED'),
        mcp('c', 'DEGRADED'),
        mcp('d', 'CONFIGURED'),
      ],
    });
    expect(recs.map((r) => r.id)).toEqual([
      'mcp-unavailable:a',
      'mcp-unavailable:b',
      'mcp-unavailable:c',
    ]);
    expect(recs[0].params['state']).toBe('NOT_CONFIGURED');
  });

  it('flags a verb with ≥2 refused/non-ok executions — never a single one', () => {
    const recs = buildRecommendations({
      tasks: [
        task('t1', 'apply', { refusal: 'PORTAL-CONFIRM required', exit_code: 1 }),
        task('t2', 'apply', { receipt: { status: 'refused' }, exit_code: 1 }),
        task('t3', 'verify', { receipt: { status: 'refused' }, exit_code: 1 }),
        task('t4', 'verify'),
      ],
    });
    expect(recs.map((r) => r.id)).toEqual(['recurring-failure:apply']);
    expect(recs[0].params['count']).toBe(2);
    expect(recs[0].refs.map((x) => x.id)).toEqual(['t1', 't2']);
  });
});

describe('recommend.data — related-skill', () => {
  it('groups skills by declared domain — "same domain", never "similar"', () => {
    const recs = buildRecommendations({
      skills: [skill('s1', 'spark'), skill('s2', 'spark'), skill('s3', 'api'), skill('s4', null)],
    });
    expect(recs.map((r) => r.id)).toEqual(['related-skill:spark']);
    expect(recs[0].reasonKey).toBe('recommend.reason.sameDomain');
    expect(recs[0].params).toEqual({ domain: 'spark', count: 2 });
    expect(recs[0].refs.map((x) => x.id)).toEqual(['s1', 's2']);
  });
});

describe('recommend.data — ordering + helpers', () => {
  it('emits kinds in REC_KIND_ORDER regardless of input order', () => {
    const recs = buildRecommendations({
      skills: [skill('s1', 'd'), skill('s2', 'd')],
      mcp: [mcp('x', 'FAILED')],
      federation: fed(['a', 'b'], ['a']),
      registry: registry(['a']),
      hosts: [host({ supported: false })],
    });
    const kinds = recs.map((r) => r.kind);
    const order = kinds.map((k) => REC_KIND_ORDER.indexOf(k));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(kinds).toEqual([
      'missing-component',
      'incompatible-dependency',
      'mcp-unavailable',
      'related-skill',
    ]);
  });

  it('agentsForSkill matches declared refs only, sorted', () => {
    const agents = [agent('b', ['x']), agent('a', ['s1', 's2']), agent('c', [])];
    expect(agentsForSkill(agents, 's1').map((a) => a.id)).toEqual(['a']);
    expect(agentsForSkill(agents, ['s2', 'other']).map((a) => a.id)).toEqual(['a']);
    expect(agentsForSkill(agents, 'zzz')).toEqual([]);
    expect(agentsForSkill(null, 's1')).toEqual([]);
  });

  it('agentsForDomain matches declared domains only', () => {
    const agents = [agent('b', [], ['spark']), agent('a', [], ['api'])];
    expect(agentsForDomain(agents, 'spark').map((a) => a.id)).toEqual(['b']);
    expect(agentsForDomain(agents, '')).toEqual([]);
  });

  it('skillsInDomain excludes the queried skill itself', () => {
    const skills = [skill('s1', 'd'), skill('s2', 'd'), skill('s3', 'other')];
    expect(skillsInDomain(skills, 'd', 's1').map((s) => s.id)).toEqual(['s2']);
  });
});
