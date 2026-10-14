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

function fakeApi(overrides: Partial<PortalApi> = {}): PortalApi {
  return {
    bootstrap: () => of({ descriptor: DESCRIPTOR, health: HEALTH }),
    installationStatus: () => of(HEALTH),
    federation: () => of(SNAPSHOT),
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
});
