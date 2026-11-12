import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ExplorerPage } from './explorer.page';
import { PortalApi } from '../../core/api/api.client';
import { PortalStore } from '../../core/portal/portal.store';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { FederationSnapshot, PortalDescriptor, PortalHealth } from '../../core/api/api.models';

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
  workspace: { root: 'E:/ws', name: 'ws' },
};

const HEALTH: PortalHealth = {
  state: 'VERIFIED',
  checks: [],
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
    },
    { provider: 'forge-doctor-api', status: 'BLOCKED', checkout: null },
  ],
  installed_forges: ['the-forge', 'spark-forge-aws', 'platform-forge'],
  registry: { count: 3, path: 'E:/ws/.forge/registry.json' },
  summary: { catalog: 2, installed: 3, with_mcp: 1, with_checkout: 1 },
};

const ATLAS_DOWN = {
  schema: 'forge/PortalAtlasStatus/1' as const,
  state: 'unavailable' as const,
  url: 'http://127.0.0.1:8741',
  service: null,
  api_version: null,
  detail: 'connection-refused',
  health: null,
  index: null,
  checked_at: '2026-01-01T10:00:00Z',
};

function fakeApi(overrides: Partial<PortalApi> = {}): PortalApi {
  return {
    bootstrap: () => of({ descriptor: DESCRIPTOR, health: HEALTH }),
    installationStatus: () => of(HEALTH),
    federation: () => of(SNAPSHOT),
    // the registry ops panel is part of the page — absent state, not a crash
    registryState: () =>
      of({
        schema: 'forge-cli/RegistryState/v1' as const,
        state_path: '/t/.forge-cli/forges/state.json',
        present: false,
        forges: {},
      }),
    // the atlas panel probes on mount — a down service is data, not an error
    atlasStatus: () => of(ATLAS_DOWN),
    ...overrides,
  } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const row = (el: HTMLElement, id: string) =>
  [...el.querySelectorAll('tbody tr')].find((tr) => text(tr).includes(id));

describe('ExplorerPage', () => {
  async function setup(overrides: Partial<PortalApi> = {}) {
    await TestBed.configureTestingModule({
      imports: [ExplorerPage],
      providers: [provideRouter([]), { provide: PortalApi, useValue: fakeApi(overrides) }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    await TestBed.inject(PortalStore).bootstrap();
    const fixture = TestBed.createComponent(ExplorerPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders the serving Forja plus every federation entry', async () => {
    const el = (await setup()).nativeElement as HTMLElement;
    const rows = el.querySelectorAll('tbody tr');
    // serving + 2 specialists + 1 registry-only
    expect(rows.length).toBe(4);
    expect(text(el)).toContain('The Forge');
    expect(text(el)).toContain('spark-forge-aws');
    expect(text(el)).toContain('forge-doctor-api');
    expect(text(el)).toContain('platform-forge');
    expect(el.querySelector('tr[data-serving]')).toBeTruthy();
  });

  it('renders checkout and MCP tri-state honestly', async () => {
    const el = (await setup()).nativeElement as HTMLElement;

    // verified checkout path + declared MCP for the specialist
    const aws = row(el, 'spark-forge-aws');
    expect(text(aws)).toContain('E:/projetos/spark');
    expect(text(aws)).toContain('MCP declared');
    expect(text(aws)).toContain('2.0.0');

    // known-absent checkout vs unverifiable MCP stay distinct
    const fda = row(el, 'forge-doctor-api');
    expect(text(fda)).toContain('Absent');
    expect(text(fda)).toContain('UNVERIFIED');
  });

  it('keeps the serving row and marks the rest UNVERIFIED when federation 404s', async () => {
    const el = (
      await setup({
        federation: () =>
          throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
      })
    ).nativeElement as HTMLElement;

    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('tr[data-serving]')).toBeTruthy();
    expect(text(el)).toContain('UNVERIFIED');
    expect(el.querySelector('ui-error')).toBeNull();
  });

  it('marks registry-only entries as UNVERIFIED instead of inventing state', async () => {
    const el = (await setup()).nativeElement as HTMLElement;
    const reg = row(el, 'platform-forge');
    expect(reg).toBeTruthy();
    expect(text(reg)).toContain('UNVERIFIED');
    // every detail row links to /forges/:id
    const link = reg?.querySelector('a[href="/forges/platform-forge"]');
    expect(link).toBeTruthy();
  });

  it('projects forge/context granular facets into rows', async () => {
    const snap: FederationSnapshot = {
      ...SNAPSHOT,
      context: {
        state: 'registered',
        count: 1,
        forges: {
          'spark-forge-aws': {
            state: 'degraded',
            kind: 'specialist',
            health: 'healthy',
            health_checks: 2,
            degraded_reasons: ['partial index'],
            discovery: ['workspace-file', 'cli'],
            discovery_manifest: 'forge.agentic.json',
            scope: 'project',
            profile: 'recommended',
            updated_at: '2026-01-01T10:00:00Z',
          },
        },
      },
    };
    const el = (await setup({ federation: () => of(snap) })).nativeElement as HTMLElement;

    const aws = row(el, 'spark-forge-aws');
    expect(text(aws)).toContain('Degraded'); // manifest state badge
    expect(text(aws)).toContain('Specialist'); // kind chip (forgeKind.specialist)
    expect(text(aws)).toContain('Healthy'); // health badge (contextHealth.healthy)
    expect(text(aws)).toContain('workspace file'); // discovery chip
    expect(text(aws)).toContain('CLI');

    // a forge with no context-registry entry stays UNVERIFIED
    const fda = row(el, 'forge-doctor-api');
    expect(text(fda)).toContain('UNVERIFIED');
  });
});
