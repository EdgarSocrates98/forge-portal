import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { PortalApi } from '../api/api.client';
import { ApiError } from '../api/api.error';
import { PortalCapability, PortalNavItem } from '../api/api.models';
import { I18nService } from '../i18n/i18n.service';
import { PortalStore } from '../portal/portal.store';
import { SEARCH_DEBOUNCE_MS, SearchService } from './search.service';

/** Flush pending microtasks — safe under vitest fake timers (promises
 *  are not patched). Covers the firstValueFrom/Promise.all chain depth. */
const flush = async (rounds = 10): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

function fakeApi(over: Record<string, unknown> = {}) {
  return {
    federation: vi.fn(() =>
      of({
        specialists: [{ provider: 'api-forge', state: 'installed' }],
        installed_forges: ['api-forge'],
        registry: { count: 1, path: '/reg' },
        summary: { catalog: 1, installed: 1, with_mcp: 0, with_checkout: 0 },
      }),
    ),
    skills: vi.fn(() =>
      of([
        {
          id: 's1',
          name: 'spark-debug',
          domain: 'spark',
          description: '',
          state: 'installed',
          hosts: [],
        },
      ]),
    ),
    agents: vi.fn(() =>
      of([
        {
          id: 'a1',
          name: 'reviewer',
          role: 'review',
          description: '',
          authority: null,
          domains: [],
          skills: [],
          hosts: [],
          state: 'active',
        },
      ]),
    ),
    mcpServers: vi.fn(() =>
      of([{ id: 'mcp-1', state: 'CONFIGURED', host: 'claude', tools_count: 3, last_verify: null }]),
    ),
    hosts: vi.fn(() =>
      of([
        {
          host: 'claude',
          detected: true,
          version: '1.2',
          supported: true,
          logged_in: true,
          integration: 'DETECTED',
          launchable: true,
        },
      ]),
    ),
    tasks: vi.fn(() =>
      of([
        {
          id: 't1',
          verb: 'apply',
          label: 'Apply plan',
          stage: 'refused',
          started_at: 'x',
          finished_at: null,
          exit_code: 1,
          refusal: 'PORTAL-CONFIRM required',
        },
        {
          id: 't2',
          verb: 'verify',
          label: 'Verify',
          stage: 'completed',
          started_at: 'x',
          finished_at: 'x',
          exit_code: 0,
          receipt: { status: 'ok' },
        },
        {
          id: 't3',
          verb: 'plan',
          label: 'Plan',
          stage: 'failed',
          started_at: 'x',
          finished_at: 'x',
          exit_code: 1,
          receipt: { status: 'refused' },
        },
      ]),
    ),
    docsSearch: vi.fn((q: string) =>
      of([
        { path: 'docs/a.md', title: 'Install guide', excerpt: '…', category: 'guides' },
        {
          path: 'docs/b.md',
          title: 'External doc',
          excerpt: '…',
          category: 'ext',
          url: 'https://example.com/b',
        },
      ]),
    ),
    ...over,
  };
}

function fakeStore(over: Record<string, unknown> = {}) {
  return {
    nav: signal<PortalNavItem[]>([]),
    capabilities: signal<PortalCapability[]>([]),
    refreshedAt: signal<string | null>('2026-10-14T00:00:00Z'),
    refreshHealth: vi.fn(async () => {}),
    ...over,
  };
}

async function setup(
  apiOver: Record<string, unknown> = {},
  storeOver: Record<string, unknown> = {},
) {
  const api = fakeApi(apiOver);
  const store = fakeStore(storeOver);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PortalApi, useValue: api },
      { provide: PortalStore, useValue: store },
    ],
  });
  const i18n = TestBed.inject(I18nService);
  await i18n.applyPreference('en');
  const service = TestBed.inject(SearchService);
  return { api, store, i18n, service };
}

describe('SearchService', () => {
  it('builds the index lazily — no API call before the first query', async () => {
    const { api, service } = await setup();
    expect(api.federation).not.toHaveBeenCalled();
    expect(api.skills).not.toHaveBeenCalled();
    await service.searchNow('');
    expect(api.federation).toHaveBeenCalledTimes(1);
    expect(api.skills).toHaveBeenCalledTimes(1);
    expect(api.agents).toHaveBeenCalledTimes(1);
    expect(api.mcpServers).toHaveBeenCalledTimes(1);
    expect(api.hosts).toHaveBeenCalledTimes(1);
    expect(api.tasks).toHaveBeenCalledTimes(1);
  });

  it('caches by data version — second query reuses the index', async () => {
    const { api, service } = await setup();
    await service.searchNow('a');
    await service.searchNow('b');
    expect(api.skills).toHaveBeenCalledTimes(1);
    expect(api.docsSearch).toHaveBeenCalledTimes(2); // docs are per-query
  });

  it('refresh() invalidates the index and re-fetches', async () => {
    const { api, service } = await setup();
    await service.searchNow('');
    service.refresh();
    await flush();
    expect(api.skills).toHaveBeenCalledTimes(2);
  });

  it('lists pages and shell actions first on an empty query', async () => {
    const { service } = await setup();
    await service.searchNow('');
    const results = service.results();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.kind).toBe('page');
    // nav + static pages + 3 actions all present before any other kind
    const firstNonPage = results.findIndex((r) => r.kind !== 'page');
    expect(results.slice(0, firstNonPage).some((r) => r.id === 'act:refresh')).toBe(true);
    expect(results.some((r) => r.id === 'page:/skills')).toBe(true);
    expect(results.some((r) => r.id === 'page:/forges')).toBe(true);
    expect(results.some((r) => r.id === 'page:/config')).toBe(true);
  });

  it('ranks exact > prefix > substring', async () => {
    const { service } = await setup({
      skills: vi.fn(() =>
        of([
          { id: 's1', name: 'abc', domain: null, description: '', state: 'installed', hosts: [] },
          { id: 's2', name: 'abc-x', domain: null, description: '', state: 'installed', hosts: [] },
          { id: 's3', name: 'zabc', domain: null, description: '', state: 'installed', hosts: [] },
        ]),
      ),
    });
    await service.searchNow('abc');
    const ids = service.results().map((r) => r.id);
    expect(ids.indexOf('skill:s1')).toBeLessThan(ids.indexOf('skill:s2'));
    expect(ids.indexOf('skill:s2')).toBeLessThan(ids.indexOf('skill:s3'));
  });

  it('boosts pages over forjas over other kinds at equal score', async () => {
    const { service } = await setup({
      federation: vi.fn(() =>
        of({
          // 'fam-host' scores substring(2) — same tier as 'AI hosts' and 'myhost'
          specialists: [{ provider: 'fam-host', state: 'installed' }],
          installed_forges: [],
          registry: { count: 0, path: '' },
          summary: { catalog: 1, installed: 0, with_mcp: 0, with_checkout: 0 },
        }),
      ),
      hosts: vi.fn(() =>
        of([
          {
            host: 'myhost',
            detected: true,
            version: '1',
            supported: true,
            logged_in: null,
            integration: 'DETECTED',
            launchable: false,
          },
        ]),
      ),
    });
    await service.searchNow('host');
    const results = service.results();
    const kinds = results.map((r) => r.kind);
    const pageIdx = kinds.indexOf('page');
    const forgeIdx = kinds.indexOf('forge');
    const hostIdx = kinds.indexOf('host');
    expect(pageIdx).toBeGreaterThanOrEqual(0);
    expect(forgeIdx).toBeGreaterThan(pageIdx);
    expect(hostIdx).toBeGreaterThan(forgeIdx);
  });

  it('folds diacritics — "instalacao" matches "Instalação"', async () => {
    const { service, i18n } = await setup();
    await i18n.applyPreference('pt-BR');
    await service.searchNow('instalacao');
    expect(service.results().some((r) => r.id === 'page:/install')).toBe(true);
  });

  it('isolates per-source failure — other kinds still render, kind flagged', async () => {
    const { service } = await setup({
      skills: vi.fn(() => throwError(() => new ApiError(500))),
    });
    await service.searchNow('');
    const results = service.results();
    expect(service.unverified()).toContain('skill');
    expect(service.unverified()).not.toContain('agent');
    expect(results.some((r) => r.kind === 'agent')).toBe(true);
    expect(results.some((r) => r.kind === 'page')).toBe(true);
    expect(results.some((r) => r.kind === 'skill')).toBe(false);
  });

  it('treats a 404 federation endpoint as not-applicable — silently skipped', async () => {
    const { service } = await setup({
      federation: vi.fn(() => throwError(() => new ApiError(404))),
    });
    await service.searchNow('');
    expect(service.results().some((r) => r.kind === 'forge')).toBe(false);
    expect(service.unverified()).not.toContain('forge');
  });

  it('surfaces known errors only for refused / non-ok task receipts', async () => {
    const { service } = await setup();
    await service.searchNow('');
    const errors = service.results().filter((r) => r.kind === 'error');
    expect(errors.map((e) => e.id).sort()).toEqual(['err:t1', 'err:t3']);
    expect(errors[0]?.route).toBe('/tasks');
  });

  it('makes refusal strings searchable', async () => {
    const { service } = await setup();
    await service.searchNow('portal-confirm');
    const hit = service.results().find((r) => r.id === 'err:t1');
    expect(hit).toBeTruthy();
    expect(hit?.label).toBe('PORTAL-CONFIRM required');
  });

  it('queries docs per search with url passthrough and knowledge fallback', async () => {
    const { api, service } = await setup();
    await service.searchNow('guide');
    expect(api.docsSearch).toHaveBeenCalledWith('guide');
    const docs = service.results().filter((r) => r.kind === 'doc');
    expect(docs.find((d) => d.id === 'doc:docs/a.md')?.route).toBe('/knowledge');
    expect(docs.find((d) => d.id === 'doc:docs/b.md')?.url).toBe('https://example.com/b');
  });

  it('keeps doc hits even when the title does not textually match', async () => {
    const { service } = await setup({
      docsSearch: vi.fn(() =>
        of([{ path: 'docs/z.md', title: 'zzz unrelated', excerpt: '', category: 'x' }]),
      ),
    });
    await service.searchNow('qqq');
    expect(service.results().some((r) => r.id === 'doc:docs/z.md')).toBe(true);
  });

  it('flags docs as unverified when the docs search fails — others unaffected', async () => {
    const { service } = await setup({
      docsSearch: vi.fn(() => throwError(() => new ApiError(503))),
    });
    await service.searchNow('review');
    expect(service.unverified()).toContain('doc');
    expect(service.results().some((r) => r.kind === 'agent')).toBe(true);
    expect(service.results().some((r) => r.kind === 'doc')).toBe(false);
  });

  it('merges server nav with static routes — nav metadata wins', async () => {
    const { service } = await setup(
      {},
      {
        nav: signal<PortalNavItem[]>([
          { id: 'sk', label_key: 'nav.skills', route: '/skills', icon: 'mcp' },
        ]),
      },
    );
    await service.searchNow('');
    const skills = service.results().filter((r) => r.id === 'page:/skills');
    expect(skills.length).toBe(1);
    expect(skills[0]?.icon).toBe('mcp');
  });

  it('hides capability-gated pages when the capability is unsupported', async () => {
    const { service } = await setup(
      {},
      { capabilities: signal<PortalCapability[]>([{ id: 'tasks', state: 'unsupported' }]) },
    );
    await service.searchNow('');
    expect(service.results().some((r) => r.id === 'page:/tasks')).toBe(false);
    expect(service.results().some((r) => r.id === 'cap:tasks')).toBe(true);
  });

  it('runs the refresh action through the store', async () => {
    const { service, store } = await setup();
    await service.searchNow('');
    const refresh = service.results().find((r) => r.id === 'act:refresh');
    refresh?.run?.();
    expect(store.refreshHealth).toHaveBeenCalled();
  });

  describe('debounce', () => {
    it('debounces non-empty queries and keeps only the last one', async () => {
      const { api, service } = await setup();
      vi.useFakeTimers();
      try {
        service.setQuery('a');
        service.setQuery('ab');
        service.setQuery('abc');
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
        expect(api.docsSearch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        expect(api.docsSearch).toHaveBeenCalledTimes(1);
        expect(api.docsSearch).toHaveBeenCalledWith('abc');
      } finally {
        vi.useRealTimers();
      }
    });

    it('runs an empty query immediately — no debounce wait', async () => {
      const { api, service } = await setup();
      vi.useFakeTimers();
      try {
        service.setQuery('');
        await flush();
        expect(api.federation).toHaveBeenCalledTimes(1);
        expect(api.docsSearch).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
