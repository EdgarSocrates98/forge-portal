import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HostsPage } from './hosts.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { ToastService } from '../../shared/toast';
import { HostDetection } from '../../core/api/api.models';

/** Probe fixture covering the interesting shapes: a fully integrated
 *  host, one detected-but-unverified, one absent, one failed. */
const HOSTS: HostDetection[] = [
  {
    host: 'claude',
    detected: true,
    version: '2.0',
    supported: true,
    logged_in: true,
    integration: 'EXECUTION_VERIFIED',
    launchable: true,
    detail: 'ready',
    command_hint: 'claude mcp list',
  },
  {
    host: 'devin',
    detected: true,
    version: null,
    supported: false,
    logged_in: null,
    integration: 'DETECTED',
    launchable: false,
  },
  {
    host: 'codex',
    detected: false,
    version: null,
    supported: false,
    logged_in: null,
    integration: 'NOT_DETECTED',
    launchable: false,
  },
  {
    host: 'copilot',
    detected: true,
    version: '1.0',
    supported: true,
    logged_in: false,
    integration: 'FAILED',
    launchable: true,
    detail: 'handshake refused',
  },
];

interface LaunchReply {
  command: string | null;
  refusal?: string;
  detail?: string;
}

function setup(
  hosts: HostDetection[] | ApiError = HOSTS,
  launch: LaunchReply | ApiError = { command: 'claude --mcp forge' },
) {
  const api = {
    hosts: vi.fn(() => (hosts instanceof ApiError ? throwError(() => hosts) : of(hosts))),
    hostsLaunch: vi.fn((_host: string) =>
      launch instanceof ApiError ? throwError(() => launch) : of(launch),
    ),
  };
  const toast = { show: vi.fn() };
  TestBed.configureTestingModule({
    imports: [HostsPage],
    providers: [
      { provide: PortalApi, useValue: api },
      { provide: ToastService, useValue: toast },
    ],
  });
  return { api, toast };
}

async function make() {
  const fixture = TestBed.createComponent(HostsPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('HostsPage — Host Integration Center', () => {
  it('renders one card per host with the probed inventory fields', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('article.host');
    expect(cards.length).toBe(4);
    const claude = el.querySelector('[data-host="claude"]') as HTMLElement;
    expect(claude.textContent).toContain('claude');
    expect(claude.textContent).toContain('2.0');
    expect(claude.textContent).toContain('claude mcp list');
    expect(claude.textContent).toContain('ready');
    // supported renders as a real state badge, not free text
    expect(claude.querySelectorAll('ui-state-badge').length).toBeGreaterThanOrEqual(2);
  });

  it('computes the summary strip from the probe — never assumed', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const stats = el.querySelectorAll('.summary .stat strong');
    // detected=3 (claude, devin, copilot), integrated=1, unknown auth=2
    expect([...stats].map((s) => s.textContent?.trim())).toEqual(['3', '1', '2']);
    expect(fixture.componentInstance.summary()).toEqual({
      detected: 3,
      integrated: 1,
      unknown: 2,
    });
  });

  it('renders logged_in=null as UNVERIFIED — never authenticated', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    const devin = el.querySelector('[data-host="devin"]') as HTMLElement;
    const badge = devin.querySelector('.kv ui-state-badge .badge');
    // devin is detected but auth is unknown: the badge must be the
    // unverified one and no signed-in text may appear for it.
    expect(devin.querySelectorAll('.kv ui-state-badge').length).toBeGreaterThanOrEqual(1);
    expect(c.authLabel(HOSTS[1])).toBe('hosts.auth.unknown');
    expect(c.authLabel(HOSTS[0])).toBe('hosts.auth.signedIn');
    expect(c.authLabel(HOSTS[3])).toBe('hosts.auth.signedOut');
    expect(badge).toBeTruthy();
  });

  it('maps lifecycle states onto the 7-stage mini stepper', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;

    // EXECUTION_VERIFIED → six done + last stage active
    const claude = el.querySelector('[data-host="claude"] .lc') as HTMLElement;
    expect(claude.querySelectorAll('li[data-state="done"]').length).toBe(6);
    expect(claude.querySelectorAll('li[data-state="active"]').length).toBe(1);
    expect(claude.querySelectorAll('li[data-state="todo"]').length).toBe(0);

    // DETECTED → first stage active, the rest todo
    const devin = el.querySelector('[data-host="devin"] .lc') as HTMLElement;
    const devinStages = devin.querySelectorAll('li');
    expect(devinStages.length).toBe(7);
    expect(devinStages[0].getAttribute('data-state')).toBe('active');
    expect([...devinStages].slice(1).every((s) => s.getAttribute('data-state') === 'todo')).toBe(
      true,
    );

    // NOT_DETECTED → no stage claimed
    const codex = el.querySelector('[data-host="codex"] .lc') as HTMLElement;
    expect(codex.querySelectorAll('li[data-state="done"], li[data-state="active"]').length).toBe(0);

    // FAILED → terminal marker, no stage claimed as done/active
    const copilot = el.querySelector('[data-host="copilot"] .lc') as HTMLElement;
    const terminal = copilot.querySelector('li.terminal');
    expect(terminal?.getAttribute('data-state')).toBe('error');
    expect(copilot.querySelectorAll('li[data-state="active"]').length).toBe(0);

    // method-level mapping — BLOCKED is a warn terminal, unknown strings map to -1
    expect(c.stageIndex('BLOCKED')).toBe(-1);
    expect(c.stageIndex('NEEDS_LOGIN')).toBe(-1);
    expect(c.terminalState({ integration: 'BLOCKED' } as HostDetection)).toBe('warn');
    expect(c.terminalState(HOSTS[0])).toBeNull();
  });

  it('request integration shows the real command for the user terminal', async () => {
    const { api, toast } = setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.requestIntegration(HOSTS[0]);
    fixture.detectChanges();
    expect(api.hostsLaunch).toHaveBeenCalledWith('claude');
    const el = fixture.nativeElement as HTMLElement;
    const outcome = el.querySelector('[data-host="claude"] .outcome') as HTMLElement;
    expect(outcome.getAttribute('data-kind')).toBe('command');
    expect(outcome.textContent).toContain('claude --mcp forge');
    expect(outcome.querySelector('button')).toBeTruthy();
    expect(toast.show).toHaveBeenCalledWith('notify.success', 'success');
    // the portal never claims it launched anything
    expect(c.launch()['claude']?.command).toBe('claude --mcp forge');
  });

  it('request integration renders the refusal code verbatim', async () => {
    const { toast } = setup(HOSTS, {
      command: null,
      refusal: 'HOST-BLOCKED',
      detail: 'host refused integration',
    });
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.requestIntegration(HOSTS[0]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const outcome = el.querySelector('[data-host="claude"] .outcome') as HTMLElement;
    expect(outcome.getAttribute('data-kind')).toBe('refusal');
    expect(outcome.textContent).toContain('HOST-BLOCKED');
    expect(outcome.textContent).toContain('host refused integration');
    expect(outcome.querySelector('.outcome__cmd')).toBeNull();
    expect(toast.show).toHaveBeenCalledWith('HOST-BLOCKED', 'error');
  });

  it('renders the unavailable note when the adapter returns no command', async () => {
    setup(HOSTS, { command: null, detail: 'no TTY in this session' });
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.requestIntegration(HOSTS[1]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const outcome = el.querySelector('[data-host="devin"] .outcome') as HTMLElement;
    expect(outcome.getAttribute('data-kind')).toBe('none');
    expect(outcome.textContent).toContain('no TTY in this session');
  });

  it('refresh re-probes /hosts and surfaces the observed transition', async () => {
    const { api } = setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(api.hosts).toHaveBeenCalledTimes(1);

    // second probe: devin advanced from DETECTED to INSTALLED
    const next = HOSTS.map((h) =>
      h.host === 'devin' ? { ...h, integration: 'INSTALLED' as const, logged_in: true } : h,
    );
    api.hosts.mockImplementation(() => of(next));
    await c.load();
    fixture.detectChanges();

    expect(api.hosts).toHaveBeenCalledTimes(2);
    expect(c.checks()['devin']?.changed).toBe(true);
    expect(c.checks()['devin']?.from).toBe('DETECTED');
    expect(c.checks()['claude']?.changed).toBe(false);

    const el = fixture.nativeElement as HTMLElement;
    const transition = el.querySelector('[data-host="devin"] .transition');
    expect(transition).toBeTruthy();
    expect(transition!.querySelectorAll('ui-state-badge').length).toBe(2);
    // every host got a checked timestamp from the probe
    expect(el.querySelectorAll('.checked').length).toBe(4);
  });

  it('keeps per-host results independent across requests', async () => {
    const { api } = setup(HOSTS, { command: 'claude --mcp forge' });
    const fixture = await make();
    const c = fixture.componentInstance;
    api.hostsLaunch.mockImplementation((host: string) =>
      of(host === 'devin' ? { command: 'devin integrate' } : { command: 'claude --mcp forge' }),
    );
    await c.requestIntegration(HOSTS[0]);
    await c.requestIntegration(HOSTS[1]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-host="claude"] .outcome')?.textContent).toContain(
      'claude --mcp forge',
    );
    expect(el.querySelector('[data-host="devin"] .outcome')?.textContent).toContain(
      'devin integrate',
    );
  });

  it('copies the command to the clipboard and toasts', async () => {
    const { toast } = setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const fixture = await make();
    await fixture.componentInstance.copyCommand('claude', 'claude --mcp forge');
    expect(writeText).toHaveBeenCalledWith('claude --mcp forge');
    expect(toast.show).toHaveBeenCalledWith('state.copied', 'success');
    expect(fixture.componentInstance.copied()).toBe('claude');
  });

  it('renders unverified adapter capabilities instead of fake buttons', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const caps = el.querySelectorAll('.capability li');
    expect(caps.length).toBe(4);
    for (const cap of caps) {
      expect(cap.querySelector('ui-state-badge')).toBeTruthy();
      expect(cap.querySelector('button')).toBeNull();
    }
  });

  it('renders the error panel when the probe fails', async () => {
    setup(new ApiError(0));
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ui-error')).toBeTruthy();
    expect(el.querySelector('article.host')).toBeNull();
  });

  it('renders UNVERIFIED when the adapter does not expose /hosts', async () => {
    setup(new ApiError(404));
    const fixture = await make();
    const c = fixture.componentInstance;
    const el = fixture.nativeElement as HTMLElement;
    expect(c.src.unavailable()).toBe(true);
    expect(el.querySelector('.unverified-panel ui-state-badge')).toBeTruthy();
    expect(el.querySelector('article.host')).toBeNull();
  });

  it('renders the empty state when the probe returns no hosts', async () => {
    setup([]);
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ui-empty')).toBeTruthy();
    expect(el.querySelector('.summary')).toBeTruthy();
  });
});
