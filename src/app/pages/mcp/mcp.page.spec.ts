import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { McpPage } from './mcp.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { InstallationReceipt, McpServerDescriptor } from '../../core/api/api.models';

const SERVERS: McpServerDescriptor[] = [
  {
    id: 'api-forge-mcp',
    state: 'HANDSHAKE_VERIFIED',
    host: 'claude',
    tools_count: 7,
    last_verify: '2026-01-01T10:00:00Z',
    detail: 'initialize handshake verified',
    limitations: ['read-only probes only'],
  },
  {
    id: 'doctor-mcp',
    state: 'FAILED',
    host: null,
    tools_count: null,
    last_verify: null,
    detail: 'spawn doctor-mcp ENOENT',
    limitations: ['server binary missing', 'no handshake evidence'],
  },
  {
    id: 'platform-mcp',
    state: 'CONFIGURED',
    host: 'devin',
    tools_count: 0,
    last_verify: null,
  },
  {
    id: 'stale-mcp',
    state: 'DEGRADED',
    host: null,
    tools_count: null,
    last_verify: '2026-01-02T09:00:00Z',
    detail: 'handshake evidence is stale',
  },
];

const RECEIPT: InstallationReceipt = {
  status: 'ok',
  detail: 'handshakes replayed',
  actions: [
    { kind: 'handshake', path: 'mcp://api-forge-mcp/initialize', status: 'ok' },
    { kind: 'handshake', path: 'mcp://doctor-mcp/initialize', status: 'fail' },
  ],
};

function fakeApi(overrides: Partial<Record<keyof PortalApi, unknown>> = {}): PortalApi {
  return {
    mcpServers: vi.fn(() => of(SERVERS)),
    mcpVerify: vi.fn(() => of(RECEIPT)),
    ...overrides,
  } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const section = (el: HTMLElement, name: string) =>
  el.querySelector(`[data-section="${name}"]`) as HTMLElement | null;
const row = (el: HTMLElement, id: string) =>
  [...el.querySelectorAll('tbody tr')].find((tr) => text(tr).includes(id));

describe('McpPage', () => {
  async function setup(overrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [McpPage],
      providers: [{ provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(McpPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  it('renders the registry with only the fields the adapter reported', async () => {
    const { el } = await setup();
    const registry = section(el, 'registry');

    expect(registry?.querySelectorAll('tbody tr').length).toBe(4);
    const api = row(el, 'api-forge-mcp');
    expect(text(api)).toContain('Handshake verified');
    expect(text(api)).toContain('claude');
    expect(text(api)).toContain('7');
    expect(text(api)).not.toContain('Never verified');

    // null tools_count / last_verify / host stay honest — never fabricated
    const doctor = row(el, 'doctor-mcp');
    expect(doctor?.querySelector('[data-unbound]')).toBeTruthy();
    expect(text(doctor)).toContain('UNVERIFIED');
    expect(text(doctor)).toContain('Never verified');
    expect(text(doctor)).toContain('2'); // two real limitation entries

    // read-only scope note is always visible
    expect(section(el, 'safety')).toBeTruthy();
    expect(text(section(el, 'safety')).trim().length).toBeGreaterThan(0);
  });

  it('marks unexposed tool/resource/prompt surfaces UNVERIFIED in the inspector', async () => {
    const { el, fixture } = await setup();

    el.querySelector<HTMLElement>('[data-inspect="api-forge-mcp"]')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const inspector = section(el, 'inspector');
    expect(text(inspector)).toContain('api-forge-mcp');
    // tools: only the count is real data
    expect(text(inspector?.querySelector('[data-surface="tools"]'))).toContain('7 tools');
    // resources / prompts are not exposed by adapters — badge, never a list
    for (const surface of ['resources', 'prompts']) {
      const panel = inspector?.querySelector(`[data-surface="${surface}"]`);
      expect(text(panel)).toContain('UNVERIFIED');
      expect(panel?.querySelectorAll('li').length).toBe(0);
    }

    // a server without tools_count makes even the tools surface unverified
    el.querySelector<HTMLElement>('[data-inspect="doctor-mcp"]')?.click();
    fixture.detectChanges();
    expect(text(inspector?.querySelector('[data-surface="tools"]'))).toContain('UNVERIFIED');
    expect(text(inspector)).toContain('spawn doctor-mcp ENOENT');
  });

  it('renders the verify receipt with actions and portal-measured latency', async () => {
    const { el, api, fixture } = await setup();

    el.querySelector<HTMLElement>('[data-action="verify"]')?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.mcpVerify).toHaveBeenCalledTimes(1);
    // verification refreshes the registry afterwards
    expect(api.mcpServers).toHaveBeenCalledTimes(2);

    const verify = section(el, 'verify');
    expect(verify?.querySelector('.badge[data-kind="ok"]')).toBeTruthy();
    expect(text(verify)).toContain('handshakes replayed');
    expect(text(verify)).toContain('mcp://api-forge-mcp/initialize');
    expect(text(verify)).toContain('fail');
    expect(text(verify?.querySelector('[data-latency]'))).toMatch(/^\d+ ms$/);
  });

  it('surfaces FAILED and DEGRADED servers in diagnostics with a retry', async () => {
    const { el, api, fixture } = await setup();
    const diag = section(el, 'diagnostics');

    expect(diag).toBeTruthy();
    expect(text(diag)).toContain('doctor-mcp');
    expect(text(diag)).toContain('spawn doctor-mcp ENOENT');
    expect(text(diag)).toContain('server binary missing');
    expect(text(diag)).toContain('stale-mcp');
    expect(text(diag)).toContain('handshake evidence is stale');
    // platform-mcp is healthy — it must not appear in diagnostics
    expect(text(diag)).not.toContain('platform-mcp');

    diag?.querySelector<HTMLElement>('[data-diag-retry]')?.click();
    await fixture.whenStable();
    expect(api.mcpVerify).toHaveBeenCalledTimes(1);
  });

  it('renders the compat matrix without guessing for abnormal states', async () => {
    const { el } = await setup();
    const compat = section(el, 'compat');

    // 4 server rows + 2 limitation rows (api-forge + doctor)
    expect(compat?.querySelectorAll('tbody tr').length).toBe(6);
    expect(compat?.querySelectorAll('tr.lim').length).toBe(2);

    // HANDSHAKE_VERIFIED → three reached stages, two unreached
    const api = row(compat!, 'api-forge-mcp');
    expect(api?.querySelectorAll('.stage ui-icon').length).toBe(3);
    expect(api?.querySelectorAll('.stage__no').length).toBe(2);

    // CONFIGURED → exactly one reached stage
    const platform = row(compat!, 'platform-mcp');
    expect(platform?.querySelectorAll('.stage ui-icon').length).toBe(1);

    // FAILED/DEGRADED — the matrix never guesses the last good stage
    const doctor = row(compat!, 'doctor-mcp');
    expect(doctor?.querySelector('td[colspan="5"]')).toBeTruthy();
    expect(text(doctor)).toContain('UNVERIFIED');
  });

  it('marks the registry UNVERIFIED when /mcp/servers is not exposed', async () => {
    const { el } = await setup({
      mcpServers: () =>
        throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
    });
    const registry = section(el, 'registry');

    expect(registry?.querySelector('.unv')).toBeTruthy();
    expect(text(registry)).toContain('UNVERIFIED');
    expect(registry?.querySelectorAll('tbody tr').length).toBe(0);
    expect(registry?.querySelector('ui-error')).toBeNull();
    // no data → no diagnostics, no compat rows
    expect(section(el, 'diagnostics')).toBeNull();
    expect(section(el, 'compat')?.querySelectorAll('tbody tr').length).toBe(0);
  });

  it('shows the honest empty state when the registry is empty', async () => {
    const { el } = await setup({ mcpServers: () => of([]) });
    const registry = section(el, 'registry');

    expect(registry?.querySelector('ui-empty')).toBeTruthy();
    expect(text(registry)).toContain('Nothing to show yet.');
  });
});
