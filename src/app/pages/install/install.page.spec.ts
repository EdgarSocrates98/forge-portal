import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { InstallPage } from './install.page';
import { PortalApi } from '../../core/api/api.client';
import { PortalStore } from '../../core/portal/portal.store';
import { ConfirmService } from '../../shared/confirm-dialog';
import {
  HostDetection,
  InstallationReceipt,
  PortalHealth,
  TaskExecution,
} from '../../core/api/api.models';

const HEALTH: PortalHealth = {
  state: 'INSTALLED',
  checks: [{ id: 'ledger', state: 'PASS' }],
  workspace: 'E:/ws',
  profile: 'recommended',
  updated_at: '2026-10-14T00:00:00Z',
  forge_portal: {
    state: 'installed',
    install_root: 'E:/portal',
    manifest: 'E:/portal/manifest.json',
    installed_at: '2026-10-14T00:00:00Z',
    locations: [{ kind: 'install_root', path: 'E:/portal' }],
  },
};

const HOSTS: HostDetection[] = [
  {
    host: 'claude',
    detected: true,
    version: '1.0',
    supported: true,
    logged_in: true,
    integration: 'INSTALLED',
    launchable: false,
  },
];

const TASKS: TaskExecution[] = [
  {
    id: 't1',
    verb: 'install',
    label: 'install apply',
    stage: 'completed',
    started_at: '2026-10-14T00:00:00Z',
    finished_at: '2026-10-14T00:00:01Z',
    exit_code: 0,
  },
];

const PLAN: InstallationReceipt = {
  status: 'planned',
  plan: {
    scope: 'project',
    diff: [{ path: 'skills/a.md', before: 'v1', after: 'v2' }],
  },
  plan_token: 'tok-1',
  actions: [{ kind: 'write', path: 'skills/a.md', status: 'update' }],
};

const APPLY: InstallationReceipt = {
  status: 'applied',
  actions: [{ kind: 'write', path: 'skills/a.md', status: 'done' }],
  checks: [{ id: 'doctor', status: 'PASS' }],
};

const APPLY_NO_CHECKS: InstallationReceipt = { status: 'applied', actions: [] };

function setup(apiOverrides: Partial<Record<keyof PortalApi, unknown>> = {}, confirmResult = true) {
  const api = {
    hosts: vi.fn(() => of(HOSTS)),
    tasks: vi.fn(() => of(TASKS)),
    installationPlan: vi.fn(() => of(PLAN)),
    installationApply: vi.fn(() => of(APPLY)),
    installationRepair: vi.fn(() => of({ status: 'repaired' } satisfies InstallationReceipt)),
    installationUninstall: vi.fn(() => of({ status: 'removed' } satisfies InstallationReceipt)),
    ...apiOverrides,
  };
  const store = {
    health: signal<PortalHealth | null>(HEALTH),
    refreshHealth: vi.fn(async () => {}),
  };
  const ask = vi.fn(async (_opts?: { danger?: boolean }) => confirmResult);
  TestBed.configureTestingModule({
    imports: [InstallPage],
    providers: [
      { provide: PortalApi, useValue: api },
      { provide: PortalStore, useValue: store },
      { provide: ConfirmService, useValue: { ask } },
    ],
  });
  return { api, store, ask };
}

async function make() {
  const fixture = TestBed.createComponent(InstallPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('InstallPage — Installation Center', () => {
  it('renders the 9-step stepper', async () => {
    setup();
    const fixture = await make();
    const steps = fixture.nativeElement.querySelectorAll('.stepper__step');
    expect(steps.length).toBe(9);
  });

  it('discovers backend state and detected hosts', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.discover .badge')).toBeTruthy();
    expect(el.textContent).toContain('claude');
  });

  it('never applies before plan + review + confirm (phase machine order)', async () => {
    const { api } = setup();
    const fixture = await make();
    const c = fixture.componentInstance;

    // idle — no plan exists
    await c.confirmExecute();
    expect(api.installationApply).not.toHaveBeenCalled();

    // review — plan exists but the confirm step was not reached
    await c.plan();
    expect(c.phase()).toBe('review');
    expect(api.installationPlan).toHaveBeenCalledOnce();
    await c.confirmExecute();
    expect(api.installationApply).not.toHaveBeenCalled();
  });

  it('runs plan → review → confirm → execute → verify → receipt in order', async () => {
    const { api, store } = setup();
    const fixture = await make();
    const c = fixture.componentInstance;

    await c.plan();
    expect(c.phase()).toBe('review');
    expect(c.stepIndex()).toBe(4);

    c.proceedToConfirm();
    expect(c.phase()).toBe('confirming');
    expect(c.stepIndex()).toBe(5);

    await c.confirmExecute();
    expect(api.installationApply).toHaveBeenCalledOnce();
    expect(api.installationApply).toHaveBeenCalledWith(PLAN.plan, 'tok-1');
    expect(store.refreshHealth).toHaveBeenCalled();
    expect(c.phase()).toBe('receipt');
    expect(c.stepIndex()).toBe(8);
  });

  it('renders the field-level diff when the plan carries one', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.plan();
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.diff__row');
    expect(rows.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('v2');
  });

  it('shows the explicit no-diff note when the backend provides none', async () => {
    setup({
      installationPlan: () => of({ status: 'planned', plan: {}, plan_token: 't', actions: [] }),
    });
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.plan();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.diff-none')).toBeTruthy();
  });

  it('surfaces a plan refusal without advancing the flow', async () => {
    setup({
      installationPlan: () =>
        of({ status: 'refused', refusal: 'PORTAL-LOCKED', unlock: 'close the CLI' }),
    });
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.plan();
    fixture.detectChanges();
    expect(c.phase()).toBe('refused');
    expect(fixture.nativeElement.textContent).toContain('PORTAL-LOCKED');
    // step 4 (index 3) marked warn — the flow did not reach review
    expect(c.stepState(3)).toBe('warn');
    expect(c.stepState(4)).toBe('todo');
  });

  it('marks verification UNVERIFIED when the receipt carries no checks', async () => {
    setup({ installationApply: () => of(APPLY_NO_CHECKS) });
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.plan();
    c.proceedToConfirm();
    await c.confirmExecute();
    fixture.detectChanges();
    expect(c.phase()).toBe('receipt');
    expect(fixture.nativeElement.querySelector('.unverified')).toBeTruthy();
  });

  it('gates uninstall behind the confirm dialog', async () => {
    const { api } = setup({}, false);
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.uninstall();
    expect(api.installationUninstall).not.toHaveBeenCalled();
  });

  it('uninstalls only after confirmation and resets the flow', async () => {
    const { api, ask } = setup({}, true);
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.uninstall();
    expect(ask).toHaveBeenCalledOnce();
    const call = ask.mock.calls[0];
    expect(call?.[0]?.danger).toBe(true);
    expect(api.installationUninstall).toHaveBeenCalledOnce();
    expect(c.opReceipt()?.op).toBe('uninstall');
    expect(c.phase()).toBe('idle');
  });

  it('gates repair behind the confirm dialog', async () => {
    const { api } = setup({}, false);
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.repair();
    expect(api.installationRepair).not.toHaveBeenCalled();
  });

  it('reinstall re-plans with the same selection after a receipt', async () => {
    const { api } = setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.plan();
    c.proceedToConfirm();
    await c.confirmExecute();
    expect(c.phase()).toBe('receipt');
    await c.reinstall();
    expect(api.installationPlan).toHaveBeenCalledTimes(2);
    expect(c.phase()).toBe('review');
  });

  it('renders the operation history read-only', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.history tbody tr');
    expect(rows.length).toBe(1);
    expect(el.textContent).toContain('install apply');
  });

  it('shows the update operation as UNVERIFIED (no dedicated adapter op)', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const op = el.querySelector('.op[data-state="unverified"]');
    expect(op).toBeTruthy();
    expect(op!.querySelector('ui-state-badge')).toBeTruthy();
  });
});
