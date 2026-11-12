import { buildForgeRows, specialistVersion } from './forges.data';
import { FederationSnapshot, PortalDescriptor, PortalHealth } from '../../core/api/api.models';

const DESCRIPTOR: PortalDescriptor = {
  forge_id: 'the-forge',
  forge_name: 'The Forge',
  forge_version: '1.0.0',
  cli: 'theforge',
  theme: 'the-forge',
  portal_version: '0.9.0',
  federated: true,
  capabilities: [],
  nav: [],
};

const HEALTH: PortalHealth = {
  state: 'VERIFIED',
  checks: [],
  workspace: 'E:/ws',
  profile: 'recommended',
  updated_at: '2026-01-01T10:00:00Z',
};

const SNAP: FederationSnapshot = {
  specialists: [{ provider: 'spark-forge-aws', state: 'INSTALLED' }],
  installed_forges: ['the-forge', 'spark-forge-aws', 'platform-forge'],
  registry: { count: 3, path: 'E:/ws/.forge/registry.json' },
  summary: { catalog: 1, installed: 3, with_mcp: 0, with_checkout: 0 },
};

describe('buildForgeRows — forge/context join', () => {
  it('joins the context projection by forge id on every row kind', () => {
    const snap: FederationSnapshot = {
      ...SNAP,
      context: {
        state: 'registered',
        count: 2,
        forges: {
          'the-forge': {
            state: 'available',
            kind: 'orchestrator',
            health: 'healthy',
            health_checks: 3,
            degraded_reasons: [],
            discovery: ['native-runtime'],
            discovery_manifest: null,
            scope: 'project',
            profile: 'recommended',
            updated_at: '2026-01-01T10:00:00Z',
          },
          'spark-forge-aws': {
            state: 'degraded',
            kind: 'specialist',
            health: 'degraded',
            health_checks: 1,
            degraded_reasons: ['partial index'],
            discovery: ['workspace-file'],
            discovery_manifest: 'forge.agentic.json',
            scope: 'workspace',
            profile: 'minimal',
            updated_at: '2026-01-01T10:00:00Z',
          },
          // registry-only rows join too — a context entry is real
          // evidence even when the live snapshot never observed it
          'platform-forge': {
            state: 'unavailable',
            kind: null,
            health: null,
            health_checks: null,
            degraded_reasons: [],
            discovery: [],
            discovery_manifest: null,
            scope: 'project',
            profile: null,
            updated_at: null,
          },
        },
      },
    };
    const rows = buildForgeRows(DESCRIPTOR, HEALTH, snap);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId['the-forge'].context?.kind).toBe('orchestrator');
    expect(byId['the-forge'].context?.health).toBe('healthy');
    expect(byId['spark-forge-aws'].context?.state).toBe('degraded');
    expect(byId['spark-forge-aws'].context?.discovery).toEqual(['workspace-file']);
    expect(byId['platform-forge'].context?.state).toBe('unavailable');
  });

  it('leaves context undefined when the snapshot has no section', () => {
    const rows = buildForgeRows(DESCRIPTOR, HEALTH, SNAP);
    for (const r of rows) expect(r.context).toBeUndefined();
  });

  it('leaves context undefined for forges absent from the registry', () => {
    const snap: FederationSnapshot = {
      ...SNAP,
      context: { state: 'registered', count: 0, forges: {} },
    };
    const rows = buildForgeRows(DESCRIPTOR, HEALTH, snap);
    for (const r of rows) expect(r.context).toBeUndefined();
  });
});

describe('specialistVersion', () => {
  it('reads the first declared version key', () => {
    expect(specialistVersion({ provider: 'x', revision: 'abc' })).toBe('abc');
    expect(specialistVersion({ provider: 'x' })).toBeNull();
  });
});
