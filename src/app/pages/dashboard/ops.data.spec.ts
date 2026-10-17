import {
  buildAlerts,
  buildVersionRows,
  isFailedTask,
  registryInstallCount,
  OpsInput,
} from './ops.data';
import {
  FederationSnapshot,
  PortalDescriptor,
  PortalHealth,
  RegistryState,
  TaskExecution,
  VersionInfo,
} from '../../core/api/api.models';

const HEALTH_OK: PortalHealth = {
  state: 'VERIFIED',
  checks: [{ id: 'ledger', state: 'PASS' }],
  workspace: '/ws',
  profile: 'recommended',
  updated_at: '2026-01-01T10:00:00Z',
};

const DESCRIPTOR: PortalDescriptor = {
  forge_id: 'the-forge',
  forge_name: 'The Forge',
  forge_version: '1.2.3',
  cli: 'theforge',
  theme: 'the-forge',
  portal_version: '0.9.0',
  federated: true,
  capabilities: [],
  nav: [],
};

const EMPTY_INPUT: OpsInput = {
  health: null,
  accountEnvironment: null,
  federation: null,
  mcpServers: null,
  hosts: null,
  tasks: null,
  registry: null,
  versions: null,
  graphs: null,
};

const task = (over: Partial<TaskExecution>): TaskExecution => ({
  id: 't',
  verb: 'v',
  label: 'l',
  stage: 'completed',
  started_at: '2026-01-01T00:00:00Z',
  finished_at: null,
  exit_code: 0,
  ...over,
});

describe('isFailedTask', () => {
  it('flags terminal failures and non-zero exits only', () => {
    expect(isFailedTask(task({ stage: 'failed' }))).toBe(true);
    expect(isFailedTask(task({ stage: 'refused' }))).toBe(true);
    expect(isFailedTask(task({ stage: 'completed', exit_code: 2 }))).toBe(true);
    expect(isFailedTask(task({ stage: 'running', exit_code: null }))).toBe(false);
    expect(isFailedTask(task({ stage: 'completed', exit_code: 0 }))).toBe(false);
  });
});

describe('buildAlerts', () => {
  it('returns no alerts when every observed signal is ok', () => {
    expect(buildAlerts({ ...EMPTY_INPUT, health: HEALTH_OK })).toEqual([]);
  });

  it('emits an error alert per failing health check pointing at /install', () => {
    const alerts = buildAlerts({
      ...EMPTY_INPUT,
      health: {
        ...HEALTH_OK,
        checks: [
          { id: 'ledger', state: 'PASS' },
          { id: 'mcp', state: 'FAIL', detail: 'handshake stale' },
        ],
      },
    });
    const a = alerts.find((x) => x.id === 'check-mcp');
    expect(a?.severity).toBe('error');
    expect(a?.route).toBe('/install');
    expect(a?.params?.['id']).toBe('mcp');
    expect(a?.detail).toBe('handshake stale');
  });

  it('routes specialist terminal states to the forge detail and NOT_INSTALLED to federation', () => {
    const federation: FederationSnapshot = {
      specialists: [
        { provider: 'api-forge', state: 'BLOCKED' },
        { provider: 'spark-forge-aws', status: 'NOT_INSTALLED' },
        { provider: 'platform-forge', state: 'INSTALLED' },
      ],
      installed_forges: [],
      registry: { count: 0, path: '/x' },
      summary: { catalog: 3, installed: 0, with_mcp: 0, with_checkout: 0 },
    };
    const alerts = buildAlerts({ ...EMPTY_INPUT, health: HEALTH_OK, federation });
    const blocked = alerts.find((x) => x.id === 'spec-api-forge');
    const notInstalled = alerts.find((x) => x.id === 'spec-spark-forge-aws');
    expect(blocked?.severity).toBe('error');
    expect(blocked?.route).toEqual(['/forges', 'api-forge']);
    expect(notInstalled?.severity).toBe('warn');
    expect(notInstalled?.route).toBe('/federation');
    expect(alerts.some((x) => x.id === 'spec-platform-forge')).toBe(false);
  });

  it('routes MCP terminal/degraded states to /mcp and keeps NOT_CONFIGURED informational', () => {
    const alerts = buildAlerts({
      ...EMPTY_INPUT,
      health: HEALTH_OK,
      mcpServers: [
        { id: 'a', state: 'FAILED', host: null, tools_count: null, last_verify: null },
        { id: 'b', state: 'DEGRADED', host: null, tools_count: null, last_verify: null },
        { id: 'c', state: 'NOT_CONFIGURED', host: null, tools_count: null, last_verify: null },
        { id: 'd', state: 'TOOLS_DISCOVERED', host: null, tools_count: null, last_verify: null },
      ],
    });
    expect(alerts.find((x) => x.id === 'mcp-a')?.severity).toBe('error');
    expect(alerts.find((x) => x.id === 'mcp-b')?.severity).toBe('warn');
    expect(alerts.find((x) => x.id === 'mcp-c')?.severity).toBe('info');
    expect(alerts.every((x) => x.id !== 'mcp-d')).toBe(true);
    expect(alerts.every((x) => x.route === '/mcp')).toBe(true);
  });

  it('aggregates failed tasks into a single /tasks alert', () => {
    const alerts = buildAlerts({
      ...EMPTY_INPUT,
      health: HEALTH_OK,
      tasks: [task({ stage: 'failed' }), task({ exit_code: 1 }), task({})],
    });
    const a = alerts.find((x) => x.id === 'tasks-failed');
    expect(a?.severity).toBe('error');
    expect(a?.route).toBe('/tasks');
    expect(a?.params?.['count']).toBe(2);
  });

  it('reports a malformed registry as warn — never invents an install problem', () => {
    const registry: RegistryState = {
      schema: 'forge-cli/RegistryState/v1',
      state_path: '/x/state.json',
      present: false,
      error: 'malformed',
      forges: {},
    };
    const alerts = buildAlerts({ ...EMPTY_INPUT, health: HEALTH_OK, registry });
    const a = alerts.find((x) => x.id === 'registry-malformed');
    expect(a?.severity).toBe('warn');
    expect(a?.route).toBe('/versions');
    // an absent (not malformed) state file is normal — no alert
    expect(
      buildAlerts({
        ...EMPTY_INPUT,
        health: HEALTH_OK,
        registry: { ...registry, error: undefined },
      }).some((x) => x.id === 'registry-malformed'),
    ).toBe(false);
  });

  it('emits update-available only when the backend reports a concrete newer version', () => {
    const versions: VersionInfo = {
      installed: { version: '1.0.0', origin: 'registry', channel: 'stable' },
      available: { version: null, source: 'offline' },
      compat: 'ok',
      changelog: null,
      history: [],
      rollback: { supported: false },
    };
    expect(
      buildAlerts({ ...EMPTY_INPUT, health: HEALTH_OK, versions }).some(
        (x) => x.id === 'update-available',
      ),
    ).toBe(false);

    const newer = buildAlerts({
      ...EMPTY_INPUT,
      health: HEALTH_OK,
      versions: { ...versions, available: { version: '1.1.0', source: 'offline' } },
    }).find((x) => x.id === 'update-available');
    expect(newer?.severity).toBe('info');
    expect(newer?.route).toBe('/versions');
    expect(newer?.params?.['version']).toBe('1.1.0');

    // same version → not an update
    expect(
      buildAlerts({
        ...EMPTY_INPUT,
        health: HEALTH_OK,
        versions: { ...versions, available: { version: '1.0.0', source: 'offline' } },
      }).some((x) => x.id === 'update-available'),
    ).toBe(false);
  });

  it('sorts alerts error → warn → info', () => {
    const alerts = buildAlerts({
      ...EMPTY_INPUT,
      health: HEALTH_OK,
      mcpServers: [
        { id: 'n', state: 'NOT_CONFIGURED', host: null, tools_count: null, last_verify: null },
        { id: 'f', state: 'FAILED', host: null, tools_count: null, last_verify: null },
      ],
      tasks: [task({ stage: 'failed' })],
      graphs: { availability: { state: 'no_graph' }, views: [], studio_url: null },
    });
    const order = alerts.map((a) => a.severity);
    expect(order).toEqual(
      [...order].sort((a, b) => {
        const rank = { error: 0, warn: 1, info: 2 } as const;
        return rank[a] - rank[b];
      }),
    );
    expect(alerts[0].severity).toBe('error');
    expect(alerts[alerts.length - 1].severity).toBe('info');
  });
});

describe('buildVersionRows', () => {
  const REGISTRY: RegistryState = {
    schema: 'forge-cli/RegistryState/v1',
    state_path: '/home/u/.forge-cli/forges/state.json',
    present: true,
    forges: {
      'api-forge': {
        forge: 'api-forge',
        method: 'registry',
        dist: 'apiforge-af',
        version: '0.1.0',
        pinned: '0.1.0',
        verifiedHash: 'abc',
      },
      'platform-forge': { forge: 'platform-forge', version: '3.0.0', method: 'registry' },
    },
  };

  it('merges registry receipts, the serving Forja and specialist versions', () => {
    const federation: FederationSnapshot = {
      specialists: [
        { provider: 'spark-forge-aws', state: 'INSTALLED', version: '2.0.0' },
        { provider: 'api-forge', state: 'INSTALLED', version: '9.9.9' }, // registry wins
      ],
      installed_forges: [],
      registry: { count: 2, path: '/x' },
      summary: { catalog: 2, installed: 2, with_mcp: 0, with_checkout: 0 },
    };
    const rows = buildVersionRows({
      registry: REGISTRY,
      federation,
      descriptor: DESCRIPTOR,
      versions: null,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get('the-forge')?.serving).toBe(true);
    expect(byId.get('the-forge')?.version).toBe('1.2.3');
    expect(byId.get('the-forge')?.source).toBe('bootstrap');
    expect(byId.get('api-forge')?.version).toBe('0.1.0');
    expect(byId.get('api-forge')?.pinned).toBe('0.1.0');
    expect(byId.get('api-forge')?.source).toBe('GET /api/v1/registry/state');
    expect(byId.get('platform-forge')?.version).toBe('3.0.0');
    expect(byId.get('spark-forge-aws')?.version).toBe('2.0.0');
    expect(byId.get('spark-forge-aws')?.source).toBe('GET /api/v1/federation');
    // serving Forja first
    expect(rows[0].id).toBe('the-forge');
  });

  it('sets updateTo only when /versions reports a verifiably newer version', () => {
    const base = { registry: null, federation: null, descriptor: DESCRIPTOR };
    const offline: VersionInfo = {
      installed: { version: '1.2.3', origin: null, channel: null },
      available: { version: null, source: 'offline' },
      compat: 'ok',
      changelog: null,
      history: [],
      rollback: { supported: false },
    };
    expect(buildVersionRows({ ...base, versions: offline })[0].updateTo).toBeNull();

    const newer = buildVersionRows({
      ...base,
      versions: { ...offline, available: { version: '2.0.0', source: 'offline' } },
    });
    expect(newer.find((r) => r.id === 'the-forge')?.updateTo).toBe('2.0.0');

    // available == installed → not an update
    const same = buildVersionRows({
      ...base,
      versions: { ...offline, available: { version: '1.2.3', source: 'offline' } },
    });
    expect(same[0].updateTo).toBeNull();
  });

  it('produces no rows when no source reports anything — never fabricates', () => {
    expect(
      buildVersionRows({ registry: null, federation: null, descriptor: null, versions: null }),
    ).toEqual([]);
    const absent: RegistryState = {
      schema: 'forge-cli/RegistryState/v1',
      state_path: '/x',
      present: false,
      forges: {},
    };
    expect(
      buildVersionRows({ registry: absent, federation: null, descriptor: null, versions: null }),
    ).toEqual([]);
  });
});

describe('registryInstallCount', () => {
  it('is null when the state file was never read — UNVERIFIED, not zero', () => {
    expect(registryInstallCount(null)).toBeNull();
    expect(
      registryInstallCount({
        schema: 'forge-cli/RegistryState/v1',
        state_path: '/x',
        present: false,
        forges: {},
      }),
    ).toBeNull();
  });
  it('counts only really-present receipts', () => {
    expect(
      registryInstallCount({
        schema: 'forge-cli/RegistryState/v1',
        state_path: '/x',
        present: true,
        forges: { a: { version: '1' }, b: {} },
      }),
    ).toBe(2);
  });
});
