import { entityLink, entityLinkForId } from './entity-link';

describe('entityLink', () => {
  it('maps a forge node to its detail route', () => {
    expect(entityLinkForId('forge:api-forge')).toEqual({
      commands: ['/forges', 'api-forge'],
      navKey: 'nav.forges',
    });
  });

  it('maps skill/agent nodes to ?q= search deep links', () => {
    expect(entityLinkForId('skill:glue-etl')).toEqual({
      commands: ['/skills'],
      queryParams: { q: 'glue-etl' },
      navKey: 'nav.skills',
    });
    expect(entityLinkForId('agent:builder')).toEqual({
      commands: ['/agents'],
      queryParams: { q: 'builder' },
      navKey: 'nav.agents',
    });
  });

  it('maps mcp nodes to the ?server= inspector deep link', () => {
    expect(entityLinkForId('mcp:e2e-forge-mcp')).toEqual({
      commands: ['/mcp'],
      queryParams: { server: 'e2e-forge-mcp' },
      navKey: 'nav.mcp',
    });
  });

  it('maps host nodes to the hosts page #host-<id> anchor', () => {
    expect(entityLinkForId('host:claude-code')).toEqual({
      commands: ['/hosts'],
      fragment: 'host-claude-code',
      navKey: 'nav.hosts',
    });
  });

  it('maps operation nodes to the ?task= detail deep link', () => {
    expect(entityLinkForId('operation:t-42')).toEqual({
      commands: ['/tasks'],
      queryParams: { task: 't-42' },
      navKey: 'nav.tasks',
    });
  });

  it('returns null for capability nodes — no dedicated surface exists', () => {
    expect(entityLinkForId('capability:agents')).toBeNull();
  });

  it('returns null for ids without a kind namespace or unknown kinds', () => {
    expect(entityLinkForId('no-namespace')).toBeNull();
    expect(entityLinkForId('weird:x')).toBeNull();
  });

  it('splits on the first colon only — entity ids may contain colons', () => {
    expect(entityLinkForId('skill:ns:a')).toEqual({
      commands: ['/skills'],
      queryParams: { q: 'ns:a' },
      navKey: 'nav.skills',
    });
  });

  it('entityLink(node) delegates on the node id', () => {
    expect(entityLink({ kind: 'host', id: 'host:x' })).toEqual({
      commands: ['/hosts'],
      fragment: 'host-x',
      navKey: 'nav.hosts',
    });
    expect(entityLink({ kind: 'capability', id: 'capability:c' })).toBeNull();
  });
});
