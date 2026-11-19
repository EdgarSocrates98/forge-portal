import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { FederationPage } from './federation.page';
import { PortalApi } from '../../core/api/api.client';
import { PortalStore } from '../../core/portal/portal.store';
import {
  FederationPlanResponse,
  FederationSnapshot,
  InstallationReceipt,
} from '../../core/api/api.models';

const SNAPSHOT: FederationSnapshot = {
  specialists: [
    { provider: 'alpha-forge', state: 'ACTIVE', cli: 'alpha', mcp: { state: 'CONFIGURED' } },
    { provider: 'beta-forge', state: 'ACTIVE', cli: 'beta', mcp: null },
  ],
  installed_forges: ['alpha-forge', 'beta-forge'],
  registry: { count: 2, path: 'E:/ws/.forge/installations' },
  summary: { catalog: 2, installed: 2, with_mcp: 1, with_checkout: 2 },
} as FederationSnapshot;

const PLANNED: FederationPlanResponse = {
  status: 'planned',
  plan: {
    scope: 'project',
    forge: ['alpha-forge', 'beta-forge'],
    host: 'all',
    profile: 'recommended',
    gateway_profile: 'balanced',
    components: ['skills', 'agents', 'mcp', 'tui', 'graph-studio'],
  },
  plan_token: 'tok-fed',
  receipt: {
    status: 'planned',
    checks: [{ id: 'forge:alpha-forge', status: 'UNVERIFIED', detail: 'alpha install --dry-run' }],
    forges: [{ forge_id: 'alpha-forge', status: 'planned', cmd: ['alpha', 'install'] }],
    workspace_detection: {
      workspace_techs: ['python', 'spark'],
      members: [{ path: '.', techs: ['python'] }],
      limitations: [],
    },
    recommendation: {
      suggested: [
        {
          forge_id: 'alpha-forge',
          role: 'primary',
          confidence: 'high',
          reason: 'declared technologies matched',
          installed: true,
        },
      ],
      alternatives: [],
      limitations: [],
      note: 'advisory only',
    },
  },
  actions: [{ kind: 'forge', path: 'alpha-forge', status: 'planned' }],
};

const BLOCKED_PLAN: FederationPlanResponse = {
  status: 'failed',
  plan: { scope: 'project', forge: [], host: 'all', profile: 'recommended' },
  plan_token: 'tok-blocked',
  receipt: {
    status: 'failed',
    checks: [{ id: 'selection', status: 'BLOCKED', detail: 'empty selection' }],
    selection: {
      state: 'empty_manual_selection',
      requested: [],
      detail: 'selecao de forges vazia — nunca alargada para todas',
      next_action: 'informe --forge <id> ou omita o filtro',
    },
  },
  actions: [],
};

const APPLIED: InstallationReceipt = {
  status: 'completed',
  verification: { status: 'PASS' },
  lifecycle: { schema: 'forge/InstallLifecycle/v1', state: 'verified' },
  forges: [
    {
      forge_id: 'alpha-forge',
      status: 'completed',
      via: 'delegated',
      verification: { status: 'PASS' },
    },
    { forge_id: 'beta-forge', status: 'blocked', detail: 'beta nao resolvido' },
  ],
  checks: [
    { id: 'forge:alpha-forge', status: 'PASS' },
    { id: 'forge:beta-forge', status: 'BLOCKED', detail: 'beta nao resolvido' },
  ],
  onboarding: {
    hosts: [
      { host: 'claude', state: 'mcp_verified', detail: 'handshake ok' },
      {
        host: 'devin',
        state: 'configurable',
        detail: 'config dir exists — presence is not readiness',
      },
      { host: 'codex', state: 'not_found', detail: 'no evidence' },
    ],
    limitations: ['configured != active'],
    next_steps: [],
  },
  installation: {
    conflicts: [
      { path: 'AGENTS.md', winner: 'alpha-forge', loser: 'beta-forge', resolution: 'winner wrote' },
    ],
  },
};

function setup(apiOverrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
  const api = {
    federation: vi.fn(() => of(SNAPSHOT)),
    federationPlan: vi.fn(() => of(PLANNED)),
    federationInstallAuto: vi.fn(() => of(APPLIED)),
    ...apiOverrides,
  };
  const store = {
    health: signal(null),
    refreshHealth: vi.fn(async () => {}),
    healthRefreshing: signal(false),
    healthRefreshError: signal<null>(null),
  };
  TestBed.configureTestingModule({
    imports: [FederationPage],
    providers: [
      provideRouter([]),
      { provide: PortalApi, useValue: api },
      { provide: PortalStore, useValue: store },
    ],
  });
  return { api, store };
}

async function make() {
  const fixture = TestBed.createComponent(FederationPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('FederationPage — governed family install', () => {
  it('checks every registered forge by default and sends the explicit reviewed list', async () => {
    const { api } = setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect([...c.forgeSelected()].sort()).toEqual(['alpha-forge', 'beta-forge']);
    await c.plan();
    const input = (api.federationPlan as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(input.forge).toEqual(['alpha-forge', 'beta-forge']);
  });

  it('sends an explicit empty selection as forge: [] — never widened to all', async () => {
    const { api } = setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    c.forgeSelected.set(new Set());
    await c.plan();
    const input = (api.federationPlan as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(input.forge).toEqual([]);
  });

  it('renders the named selection state + next_action verbatim on a blocked plan', async () => {
    setup({ federationPlan: () => of(BLOCKED_PLAN) });
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.plan();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('empty_manual_selection');
    expect(el.textContent).toContain('selecao de forges vazia');
    expect(el.textContent).toContain('informe --forge');
    expect(el.querySelector('.selection-note')).toBeTruthy();
  });

  it('never offers Apply on a blocked plan — nothing to approve', async () => {
    const { api } = setup({ federationPlan: () => of(BLOCKED_PLAN) });
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.plan();
    fixture.detectChanges();
    expect(c.planExecutable(BLOCKED_PLAN)).toBe(false);
    const applyBtn = (fixture.nativeElement as HTMLElement).querySelector(
      '.plan .actions-row .btn--primary',
    ) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    // defense in depth: even bypassing the disabled button, apply refuses
    await c.apply(BLOCKED_PLAN);
    expect(api.federationInstallAuto).not.toHaveBeenCalled();
    expect(c.phase()).toBe('review');
  });

  it('renders per-forge plan rows, checks, detection and recommendation evidence', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.plan();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('forge:alpha-forge');
    expect(el.textContent).toContain('alpha-forge');
    expect(el.textContent).toContain('alpha install --dry-run');
    // evidence blocks are collapsed <details> — present in DOM
    const details = el.querySelectorAll('details.evidence');
    expect(details.length).toBe(2);
    expect(el.textContent).toContain('python');
  });

  it('receipt renders verification, per-forge rows, onboarding states and conflicts verbatim', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.plan();
    await c.apply(c.planResult()!);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('alpha-forge');
    expect(el.textContent).toContain('beta nao resolvido');
    // honest host states — verbatim, not promoted
    expect(el.textContent).toContain('mcp_verified');
    expect(el.textContent).toContain('configurable');
    expect(el.textContent).toContain('not_found');
    expect(el.textContent).toContain('configured != active');
    // conflict row
    expect(el.textContent).toContain('AGENTS.md');
  });

  it('surfaces plan echo for the forge filter', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(c.forgeEcho(['a', 'b'])).toBe('a, b');
    expect(c.forgeEcho([])).toContain('federation.forge.none');
    expect(c.forgeEcho(null)).toBe('—');
    expect(c.forgeEcho(undefined)).toBe('—');
  });

  it('honest tones: configured/configurable never promote to green', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(c.onboardKind('configurable')).toBe('muted');
    expect(c.onboardKind('installed')).toBe('info');
    expect(c.onboardKind('in_path')).toBe('info');
    expect(c.onboardKind('mcp_verified')).toBe('ok');
    expect(c.onboardKind('integration_written')).toBe('ok');
    expect(c.onboardKind('restart_needed')).toBe('warn');
    expect(c.onboardKind('not_found')).toBe('muted');
    expect(c.onboardKind(undefined)).toBe('muted');
    expect(c.selectionKind('empty_manual_selection')).toBe('warn');
    expect(c.selectionKind('all_already_active')).toBe('info');
    expect(c.selectionKind(undefined)).toBe('muted');
  });
});
