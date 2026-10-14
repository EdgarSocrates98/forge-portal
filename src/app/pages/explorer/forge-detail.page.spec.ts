import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ForgeDetailPage } from './forge-detail.page';
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

function fakeApi(overrides: Partial<PortalApi> = {}): PortalApi {
  return {
    bootstrap: () => of({ descriptor: DESCRIPTOR, health: HEALTH }),
    installationStatus: () => of(HEALTH),
    federation: () => of(SNAPSHOT),
    skills: () => of([{ id: 's1' }, { id: 's2' }]),
    agents: () => of([{ id: 'a1' }]),
    mcpServers: () => of([{ id: 'm1' }]),
    hosts: () => of([{ host: 'claude' }]),
    ...overrides,
  } as unknown as PortalApi;
}

const section = (el: HTMLElement, name: string) =>
  el.querySelector(`[data-section="${name}"]`) as HTMLElement | null;
const text = (el: Element | null | undefined) => el?.textContent ?? '';

describe('ForgeDetailPage', () => {
  async function setup(id: string, overrides: Partial<PortalApi> = {}) {
    await TestBed.configureTestingModule({
      imports: [ForgeDetailPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id })) } },
        { provide: PortalApi, useValue: fakeApi(overrides) },
      ],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    await TestBed.inject(PortalStore).bootstrap();
    const fixture = TestBed.createComponent(ForgeDetailPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders the serving Forja from bootstrap + health + live counts', async () => {
    const el = (await setup('self')).nativeElement as HTMLElement;

    expect(text(section(el, 'identity'))).toContain('The Forge');
    expect(text(section(el, 'identity'))).toContain('the-forge');
    expect(text(section(el, 'identity'))).toContain('theforge');
    expect(text(section(el, 'identity'))).toContain('1.2.3');
    expect(text(section(el, 'health'))).toContain('Verified');
    expect(text(section(el, 'health'))).toContain('handshake stale');
    expect(section(el, 'capabilities')?.querySelectorAll('.cap').length).toBe(3);
    expect(text(el.querySelector('[data-count-id="skills"] [data-count]'))).toBe('2');
    expect(text(el.querySelector('[data-count-id="hosts"] [data-count]'))).toBe('1');
  });

  it('renders a specialist from the federation snapshot', async () => {
    const el = (await setup('spark-forge-aws')).nativeElement as HTMLElement;

    expect(text(section(el, 'identity'))).toContain('spark-forge-aws');
    expect(text(section(el, 'identity'))).toContain('sparkforge');
    expect(text(section(el, 'identity'))).toContain('Installed');
    expect(text(section(el, 'presence'))).toContain('E:/projetos/spark');
    expect(text(section(el, 'presence'))).toContain('MCP declared');
    expect(text(section(el, 'presence'))).toContain('command');
    expect(text(section(el, 'checks'))).toContain('cli');
    expect(text(section(el, 'notes'))).toContain('uses shared venv');
  });

  it('keeps absent fields explicit instead of filling them in', async () => {
    const el = (await setup('forge-doctor-api')).nativeElement as HTMLElement;

    expect(text(section(el, 'presence'))).toContain('Absent'); // checkout: null
    expect(text(section(el, 'presence'))).toContain('UNVERIFIED'); // mcp key missing
    expect(text(section(el, 'checks'))).toContain('UNVERIFIED'); // checks key missing
  });

  it('renders a registry-only entry as UNVERIFIED', async () => {
    const el = (await setup('platform-forge')).nativeElement as HTMLElement;
    expect(text(el)).toContain('platform-forge');
    expect(text(el)).toContain('UNVERIFIED');
  });

  it('shows the empty state for an identity nobody reported', async () => {
    const el = (await setup('ghost-forge')).nativeElement as HTMLElement;
    expect(el.querySelector('ui-empty')).toBeTruthy();
  });

  it('marks the detail UNVERIFIED when the federation op does not exist', async () => {
    const el = (
      await setup('spark-forge-aws', {
        federation: () =>
          throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
      })
    ).nativeElement as HTMLElement;
    expect(text(el)).toContain('UNVERIFIED');
    expect(text(el)).toContain('spark-forge-aws');
    expect(el.querySelector('ui-error')).toBeNull();
  });
});
