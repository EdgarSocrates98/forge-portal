import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { RegistryOpsPanel } from './registry-ops-panel';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import {
  RegistryExecuteResponse,
  RegistryPlanResponse,
  RegistryState,
} from '../../core/api/api.models';

const STATE_EMPTY: RegistryState = {
  schema: 'forge-cli/RegistryState/v1',
  state_path: '/home/t/.forge-cli/forges/state.json',
  present: false,
  forges: {},
};

const STATE_ONE: RegistryState = {
  ...STATE_EMPTY,
  present: true,
  forges: {
    'api-forge': {
      forge: 'api-forge',
      method: 'pypi',
      dist: 'apiforge-af',
      version: '0.1.0',
      installedAt: '2026-10-01T00:00:00Z',
    },
    'platform-forge': {
      forge: 'platform-forge',
      method: 'pypi',
      version: '3.0.0',
      pinned: '3.0.0',
      installedAt: '2026-10-02T00:00:00Z',
    },
  },
};

const PLAN: RegistryPlanResponse = {
  status: 'planned',
  plan: {
    action: 'install',
    forge: 'api-forge',
    preview: { method: 'pypi', planned: [{ forge: 'api-forge', version: '0.2.0' }] },
  },
  plan_token: 'tok-1',
  cli: '/usr/bin/forge-cli',
};

const EXECUTED: RegistryExecuteResponse = {
  status: 'executed',
  result: { results: [{ forge: 'api-forge', ok: true, version: '0.2.0' }] },
  state: STATE_ONE,
};

function fakeApi(overrides: Partial<PortalApi> = {}): PortalApi {
  return {
    registryState: () => of(STATE_ONE),
    registryPlan: () => of(PLAN),
    registryExecute: () => of(EXECUTED),
    ...overrides,
  } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';

describe('RegistryOpsPanel', () => {
  async function setup(overrides: Partial<PortalApi> = {}) {
    await TestBed.configureTestingModule({
      imports: [RegistryOpsPanel],
      providers: [provideRouter([]), { provide: PortalApi, useValue: fakeApi(overrides) }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(RegistryOpsPanel);
    await settle(fixture);
    return fixture;
  }

  async function settle(fixture: ComponentFixture<RegistryOpsPanel>) {
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function typeForge(el: HTMLElement, fixture: ComponentFixture<RegistryOpsPanel>, name: string) {
    const input = el.querySelector<HTMLInputElement>('#registry-forge')!;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('renders installed forges from the real registry state', async () => {
    const el = (await setup()).nativeElement as HTMLElement;
    const rows = el.querySelectorAll('tr[data-forge]');
    expect(rows.length).toBe(2);
    expect(text(el)).toContain('api-forge');
    expect(text(el)).toContain('0.1.0');
    // pinned receipt shows the pin marker + unpin verb, not pin
    const pinned = el.querySelector('tr[data-forge="platform-forge"]');
    expect(text(pinned)).toContain('pinned at 3.0.0');
    expect(pinned?.querySelector('button[data-plan="unpin"]')).toBeTruthy();
    expect(pinned?.querySelector('button[data-plan="pin"]')).toBeNull();
    const free = el.querySelector('tr[data-forge="api-forge"]');
    expect(free?.querySelector('button[data-plan="pin"]')).toBeTruthy();
  });

  it('states plainly when no registry state exists — never fakes rows', async () => {
    const el = (await setup({ registryState: () => of(STATE_EMPTY) })).nativeElement as HTMLElement;
    expect(el.querySelectorAll('tr[data-forge]').length).toBe(0);
    expect(text(el)).toContain('No registry state');
    expect(text(el)).toContain('/home/t/.forge-cli/forges/state.json');
  });

  it('marks a malformed state file instead of pretending empty', async () => {
    const el = (await setup({ registryState: () => of({ ...STATE_EMPTY, error: 'malformed' }) }))
      .nativeElement as HTMLElement;
    expect(text(el)).toContain('malformed');
  });

  it('marks the state UNVERIFIED when the op is absent on this Forja', async () => {
    const el = (
      await setup({
        registryState: () =>
          throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
      })
    ).nativeElement as HTMLElement;
    expect(text(el)).toContain('UNVERIFIED');
  });

  it('runs plan → review → confirm → execute against the real contract', async () => {
    const calls: Record<string, unknown>[] = [];
    const fixture = await setup({
      registryPlan: (input) => {
        calls.push({ phase: 'plan', ...input });
        return of(PLAN);
      },
      registryExecute: (input) => {
        calls.push({ phase: 'execute', ...input });
        return of(EXECUTED);
      },
    });
    const el = fixture.nativeElement as HTMLElement;

    typeForge(el, fixture, 'api-forge');
    el.querySelector<HTMLButtonElement>('.rops__actions button[data-plan="install"]')!.click();
    await settle(fixture);

    // review card carries the plan action/forge — nothing executed yet
    const review = el.querySelector('[data-section="registry-review"]');
    expect(review).toBeTruthy();
    expect(review?.getAttribute('data-action')).toBe('install');
    expect(review?.getAttribute('data-forge')).toBe('api-forge');
    expect(calls.length).toBe(1);
    expect(calls[0]['action']).toBe('install');
    expect(calls[0]['forge']).toBe('api-forge');

    el.querySelector<HTMLButtonElement>('button[data-exec]')!.click();
    await settle(fixture);

    // execute echoed the exact plan + one-time token
    expect(calls.length).toBe(2);
    const exec = calls[1];
    expect(exec['action']).toBe('install');
    expect(exec['forge']).toBe('api-forge');
    expect(exec['planToken']).toBe('tok-1');

    const receipt = el.querySelector('[data-section="registry-receipt"]');
    expect(receipt?.getAttribute('data-status')).toBe('executed');
  });

  it('per-row buttons plan against the row forge without typing', async () => {
    const planned: { action: string; forge: string }[] = [];
    const fixture = await setup({
      registryPlan: (input) => {
        planned.push(input);
        return of(PLAN);
      },
    });
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>(
      'tr[data-forge="api-forge"] button[data-plan="uninstall"]',
    )!.click();
    // registryPlan is invoked synchronously inside plan() before the await
    expect(planned).toEqual([{ action: 'uninstall', forge: 'api-forge' }]);
    await settle(fixture);
    expect(el.querySelector('[data-section="registry-review"]')).toBeTruthy();
  });

  it('surfaces PORTAL-CLI-UNAVAILABLE instead of a generic crash', async () => {
    const fixture = await setup({
      registryPlan: () =>
        throwError(
          () =>
            new ApiError(409, {
              code: 'PORTAL-CLI-UNAVAILABLE',
              message: 'forge-cli not installed',
            }),
        ),
    });
    const el = fixture.nativeElement as HTMLElement;
    typeForge(el, fixture, 'api-forge');
    el.querySelector<HTMLButtonElement>('.rops__actions button[data-plan="install"]')!.click();
    await settle(fixture);
    expect(text(el)).toContain('forge-cli is not installed');
    expect(el.querySelector('ui-error')).toBeTruthy();
  });

  it('cancel leaves the review without executing', async () => {
    const executed: unknown[] = [];
    const fixture = await setup({
      registryExecute: (input) => {
        executed.push(input);
        return of(EXECUTED);
      },
    });
    const el = fixture.nativeElement as HTMLElement;
    typeForge(el, fixture, 'api-forge');
    el.querySelector<HTMLButtonElement>('.rops__actions button[data-plan="install"]')!.click();
    await settle(fixture);
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '[data-section="registry-review"] .rops__row .btn',
    );
    buttons[buttons.length - 1].click(); // Cancel
    await settle(fixture);
    expect(executed.length).toBe(0);
    expect(el.querySelector('[data-section="registry-review"]')).toBeNull();
  });
});
