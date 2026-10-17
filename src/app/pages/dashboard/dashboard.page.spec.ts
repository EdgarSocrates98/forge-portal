import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { DashboardPage } from './dashboard.page';
import { PortalApi } from '../../core/api/api.client';
import { PortalStore } from '../../core/portal/portal.store';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  FederationSnapshot,
  GraphBundle,
  PortalDescriptor,
  PortalHealth,
  RegistryState,
  TaskExecution,
  VersionInfo,
} from '../../core/api/api.models';

const DESCRIPTOR: PortalDescriptor = {
  forge_id: 'the-forge',
  forge_name: 'The Forge',
  forge_version: '1.2.3',
  cli: 'theforge',
  theme: 'the-forge',
  portal_version: '0.9.0',
  federated: true,
  capabilities: [
    { id: 'tasks', state: 'supported' },
    { id: 'federation', state: 'supported' },
    { id: 'graph', state: 'unverified' },
  ],
  nav: [],
  workspace: { root: 'E:/ws', name: 'ws' },
};

const HEALTH: PortalHealth = {
  state: 'VERIFIED',
  checks: [
    { id: 'ledger', state: 'PASS' },
    { id: 'mcp', state: 'FAIL', detail: 'handshake stale' },
  ],
  workspace: 'E:/ws',
  profile: 'recommended',
  updated_at: '2026-01-01T10:00:00Z',
};

const SNAPSHOT: FederationSnapshot = {
  specialists: [
    {
      provider: 'spark-forge-aws',
      state: 'INSTALLED',
      cli: 'sparkforge',
      checkout: 'E:/projetos/spark',
      mcp: { command: 'spark-mcp' },
      version: '2.0.0',
      checks: [{ id: 'cli', status: 'PASS' }],
      notes: ['uses shared venv'],
    },
    { provider: 'forge-doctor-api', status: 'BLOCKED', checkout: null },
  ],
  installed_forges: ['the-forge', 'spark-forge-aws', 'platform-forge'],
  registry: { count: 3, path: 'E:/ws/.forge/registry.json' },
  summary: { catalog: 2, installed: 3, with_mcp: 1, with_checkout: 1 },
};

const TASKS: TaskExecution[] = [
  {
    id: 't1',
    verb: 'analyze',
    label: 'Analyze workspace',
    stage: 'completed',
    started_at: '2026-01-01T10:00:00Z',
    finished_at: '2026-01-01T10:01:00Z',
    exit_code: 0,
  },
  {
    id: 't2',
    verb: 'diagnose',
    label: 'Diagnose drift',
    stage: 'failed',
    started_at: '2026-01-02T10:00:00Z',
    finished_at: '2026-01-02T10:02:00Z',
    exit_code: 1,
  },
  {
    id: 't3',
    verb: 'scan',
    label: 'Scan apis',
    stage: 'running',
    started_at: '2026-01-03T10:00:00Z',
    finished_at: null,
    exit_code: null,
  },
];

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
      verifiedHash: 'abc123',
    },
    'platform-forge': { forge: 'platform-forge', method: 'registry', version: '3.0.0' },
  },
};

const VERSIONS: VersionInfo = {
  installed: { version: '1.2.3', origin: 'registry', channel: 'stable' },
  available: { version: null, source: 'offline' },
  compat: 'compatible',
  changelog: null,
  history: [],
  rollback: { supported: false },
};

const GRAPHS: GraphBundle = {
  availability: { state: 'available' },
  views: [{ id: 'v1' }],
  studio_url: null,
};

function fakeApi(overrides: Partial<PortalApi> = {}): PortalApi {
  return {
    bootstrap: () => of({ descriptor: DESCRIPTOR, health: HEALTH }),
    installationStatus: () => of(HEALTH),
    health: () => of(HEALTH),
    capabilities: () => of(DESCRIPTOR.capabilities),
    federation: () => of(SNAPSHOT),
    skills: () => of([{ id: 's1' }, { id: 's2' }]),
    agents: () => of([{ id: 'a1' }]),
    mcpServers: () => of([{ id: 'm1' }]),
    hosts: () => of([{ host: 'claude' }, { host: 'devin' }]),
    tasks: () => of(TASKS),
    registryState: () => of(REGISTRY),
    versions: () => of(VERSIONS),
    graphs: () => of(GRAPHS),
    ...overrides,
  } as unknown as PortalApi;
}

const section = (el: HTMLElement, name: string) =>
  el.querySelector(`[data-section="${name}"]`) as HTMLElement | null;
const text = (el: Element | null | undefined) => el?.textContent ?? '';

describe('DashboardPage', () => {
  async function setup(overrides: Partial<PortalApi> = {}) {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: fakeApi(overrides) }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    await TestBed.inject(PortalStore).bootstrap();
    const fixture = TestBed.createComponent(DashboardPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders real backend rows across every section', async () => {
    const el = (await setup()).nativeElement as HTMLElement;

    // status / health / workspace / profile from the store
    expect(text(section(el, 'status'))).toContain('The Forge');
    expect(text(section(el, 'status'))).toContain('v1.2.3');
    expect(text(section(el, 'status'))).toContain('recommended');

    // discovered Forjas: serving + 2 specialists + 1 registry-only
    const forges = section(el, 'forges');
    expect(forges?.querySelectorAll('tbody tr').length).toBe(4);
    expect(text(forges)).toContain('The Forge');
    expect(text(forges)).toContain('spark-forge-aws');
    expect(text(forges)).toContain('forge-doctor-api');
    expect(text(forges)).toContain('platform-forge');
    expect(forges?.querySelector('tr[data-serving]')).toBeTruthy();
    expect(text(forges)).toContain('E:/projetos/spark');

    // capabilities from bootstrap
    expect(section(el, 'capabilities')?.querySelectorAll('.cap').length).toBe(3);

    // inventory counts per endpoint
    expect(text(el.querySelector('[data-count-id="skills"] [data-count]'))).toBe('2');
    expect(text(el.querySelector('[data-count-id="agents"] [data-count]'))).toBe('1');
    expect(text(el.querySelector('[data-count-id="mcp"] [data-count]'))).toBe('1');
    expect(text(el.querySelector('[data-count-id="hosts"] [data-count]'))).toBe('2');

    // recent tasks, newest first, failures highlighted
    const tasks = section(el, 'tasks');
    const rows = tasks?.querySelectorAll('tbody tr') ?? [];
    expect(rows.length).toBe(3);
    expect(text(rows[0])).toContain('Scan apis');
    expect(tasks?.querySelectorAll('tr[data-fail]').length).toBe(1);
    expect(tasks?.querySelector('[data-failures]')?.getAttribute('data-failures')).toBe('1');
  });

  it('marks a missing federation source UNVERIFIED without crashing other sections', async () => {
    const el = (
      await setup({
        federation: () =>
          throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
      })
    ).nativeElement as HTMLElement;

    const forges = section(el, 'forges');
    expect(text(forges)).toContain('UNVERIFIED');
    // the serving Forja is still known — her row must not disappear
    expect(forges?.querySelectorAll('tbody tr').length).toBe(1);
    expect(text(forges)).toContain('The Forge');
    // and the other sources keep rendering real data
    expect(section(el, 'tasks')?.querySelectorAll('tbody tr').length).toBe(3);
    expect(text(el.querySelector('[data-count-id="skills"] [data-count]'))).toBe('2');
  });

  it('isolates a tasks failure to the tasks section', async () => {
    const el = (
      await setup({ tasks: () => throwError(() => new ApiError(500, { message: 'boom' })) })
    ).nativeElement as HTMLElement;

    expect(section(el, 'tasks')?.querySelector('.err')).toBeTruthy();
    expect(section(el, 'forges')?.querySelectorAll('tbody tr').length).toBe(4);
    expect(text(section(el, 'status'))).toContain('The Forge');
    expect(text(el.querySelector('[data-count-id="skills"] [data-count]'))).toBe('2');
  });

  it('marks a failed catalog count UNVERIFIED while sibling tiles render numbers', async () => {
    const el = (
      await setup({
        skills: () =>
          throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
      })
    ).nativeElement as HTMLElement;

    expect(text(el.querySelector('[data-count-id="skills"]'))).toContain('UNVERIFIED');
    expect(text(el.querySelector('[data-count-id="agents"] [data-count]'))).toBe('1');
    expect(text(el.querySelector('[data-count-id="hosts"] [data-count]'))).toBe('2');
  });

  it('shows an honest empty state when no tasks ran', async () => {
    const el = (await setup({ tasks: () => of([]) })).nativeElement as HTMLElement;

    const tasks = section(el, 'tasks');
    expect(tasks?.querySelector('ui-empty')).toBeTruthy();
    expect(text(tasks)).toContain('No tasks run in this session.');
  });

  // ── Cycle 3: operational control center ─────────────────────────

  it('renders actionable alerts linking each one to its resolution page', async () => {
    const el = (await setup()).nativeElement as HTMLElement;
    const alerts = section(el, 'alerts');
    const items = [...(alerts?.querySelectorAll('[data-alert-id]') ?? [])] as HTMLElement[];

    // failing check → /install · BLOCKED specialist → forge detail ·
    // failed task → /tasks — every alert resolves somewhere real
    const byId = new Map(items.map((li) => [li.dataset['alertId'], li]));
    expect(byId.get('check-mcp')?.dataset['severity']).toBe('error');
    expect(byId.get('check-mcp')?.querySelector('a')?.getAttribute('href')).toBe('/install');
    expect(text(byId.get('check-mcp'))).toContain('mcp');
    expect(byId.get('spec-forge-doctor-api')?.querySelector('a')?.getAttribute('href')).toBe(
      '/forges/forge-doctor-api',
    );
    expect(byId.get('tasks-failed')?.querySelector('a')?.getAttribute('href')).toBe('/tasks');
    // exactly the three real problems — nothing else was invented
    expect(items.length).toBe(3);
    expect(alerts?.querySelector('[data-alerts]')?.getAttribute('data-alerts')).toBe('3');
    // errors sort before warnings and info
    expect(items[0].dataset['severity']).toBe('error');
  });

  it('shows the honest empty state when no observed signal reports a problem', async () => {
    const clean: PortalHealth = { ...HEALTH, checks: [{ id: 'ledger', state: 'PASS' }] };
    const el = (
      await setup({
        bootstrap: () => of({ descriptor: DESCRIPTOR, health: clean }),
        installationStatus: () => of(clean),
        federation: () =>
          of({
            specialists: [],
            installed_forges: [],
            registry: { count: 0, path: '/x' },
            summary: { catalog: 0, installed: 0, with_mcp: 0, with_checkout: 0 },
          }),
        tasks: () => of([]),
        mcpServers: () => of([]),
        hosts: () => of([]),
        registryState: () => of({ ...REGISTRY, forges: {} }),
      })
    ).nativeElement as HTMLElement;

    const alerts = section(el, 'alerts');
    expect(alerts?.querySelectorAll('[data-alert-id]').length).toBe(0);
    expect(alerts?.querySelector('ui-empty')).toBeTruthy();
    expect(text(alerts)).toContain('No actionable alerts.');
  });

  it('renders installed versions from registry receipts, bootstrap and federation', async () => {
    const el = (await setup()).nativeElement as HTMLElement;
    const versions = section(el, 'versions');
    const rows = [...(versions?.querySelectorAll('tbody tr') ?? [])] as HTMLElement[];

    // serving Forja first, then api-forge + platform-forge (registry),
    // spark-forge-aws + forge-doctor-api (federation, no version key)
    expect(rows.length).toBe(5);
    expect(rows[0].hasAttribute('data-serving')).toBe(true);
    expect(text(rows[0])).toContain('the-forge');
    expect(text(rows[0])).toContain('1.2.3');
    expect(text(versions)).toContain('api-forge');
    expect(text(versions)).toContain('0.1.0');
    expect(text(versions)).toContain('platform-forge');
    expect(text(versions)).toContain('3.0.0');
    expect(text(versions)).toContain('spark-forge-aws');
    expect(text(versions)).toContain('2.0.0');
    // no verifiable update → no update chip, never a guessed one
    expect(versions?.querySelector('[data-update]')).toBeNull();
  });

  it('shows the update chip only when /versions reports a concrete newer version', async () => {
    const el = (
      await setup({
        versions: () => of({ ...VERSIONS, available: { version: '2.0.0', source: 'offline' } }),
      })
    ).nativeElement as HTMLElement;
    const versions = section(el, 'versions');

    const chip = versions?.querySelector('[data-update]');
    expect(chip?.getAttribute('data-update')).toBe('2.0.0');
    // and the alert surfaces too — verifiably, from the same source
    const alerts = section(el, 'alerts');
    expect(alerts?.querySelector('[data-alert-id="update-available"]')).toBeTruthy();
    expect(
      alerts?.querySelector('[data-alert-id="update-available"] a')?.getAttribute('href'),
    ).toBe('/versions');
  });

  it('keeps rendering versions from the remaining sources when the registry is absent', async () => {
    const el = (
      await setup({
        registryState: () =>
          throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
      })
    ).nativeElement as HTMLElement;
    const versions = section(el, 'versions');

    expect(text(versions)).toContain('UNVERIFIED');
    // bootstrap + federation rows are still real — they must not vanish
    // (api-forge/platform-forge exist only in the absent registry source)
    expect(versions?.querySelectorAll('tbody tr').length).toBe(3);
  });

  it('links diagnostics shortcuts to real pages', async () => {
    const el = (await setup()).nativeElement as HTMLElement;
    const diag = section(el, 'diagnostics');
    const hrefs = [...(diag?.querySelectorAll('a[data-shortcut]') ?? [])].map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/hosts', '/observe', '/config', '/versions', '/mcp', '/tasks']);
  });
});
