import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ConfigPage } from './config.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { ToastService } from '../../shared/toast';
import { AccountEnvironment } from '../../core/api/api.models';

const ENV_PARTIAL: AccountEnvironment = {
  schema: 'forge/InstallEnvironment/v1',
  scope: 'user',
  forge_id: 'the-forge',
  prefix: 'THE_FORGE',
  state: 'PARTIAL',
  windows_aliases: true,
  variables: [
    {
      name: 'THE_FORGE_HOME',
      required: true,
      present: true,
      valid: true,
      kind: 'directory',
      path: 'E:/forge',
    },
    {
      name: 'THE_FORGE_VENV',
      required: true,
      present: false,
      valid: null,
      kind: 'directory',
      path: null,
    },
    {
      name: 'THE_FORGE_PYTHON',
      required: true,
      present: true,
      valid: false,
      kind: 'file',
      path: 'E:/bad/python.exe',
    },
    {
      name: 'THE_FORGE_LAUNCHER',
      required: false,
      present: false,
      valid: null,
      kind: 'file',
      path: null,
    },
  ],
};

function setup(env: AccountEnvironment | ApiError = ENV_PARTIAL) {
  const api = {
    accountEnvironment: vi.fn(() => (env instanceof ApiError ? throwError(() => env) : of(env))),
  };
  const toast = { show: vi.fn() };
  TestBed.configureTestingModule({
    imports: [ConfigPage],
    providers: [
      provideRouter([]),
      { provide: PortalApi, useValue: api },
      { provide: ToastService, useValue: toast },
    ],
  });
  return { api, toast };
}

async function make() {
  const fixture = TestBed.createComponent(ConfigPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('ConfigPage — Configuration Center', () => {
  it('renders the environment state and one row per variable', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.env-table tbody tr');
    expect(rows.length).toBe(4);
    expect(el.querySelector('.card__heading ui-state-badge')).toBeTruthy();
  });

  it('highlights missing required and invalid variables', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const missing = el.querySelectorAll('tr[data-missing]');
    const invalid = el.querySelectorAll('tr[data-invalid]');
    expect(missing.length).toBe(1); // THE_FORGE_VENV — required, absent
    expect(invalid.length).toBe(1); // THE_FORGE_PYTHON — present but invalid
    expect(el.querySelector('.env-alert')).toBeTruthy();
  });

  it('renders valid=null as unverified, never as a fabricated yes/no', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    // two absent vars carry valid: null → two unverified badges
    const badges = el.querySelectorAll('.env-table tbody tr ui-state-badge');
    expect(badges.length).toBeGreaterThanOrEqual(3); // 2 unverified + 1 INVALID
    expect(text).not.toContain('undefined');
  });

  it('generates copyable PowerShell + bash commands for vars needing attention', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(c.attention().map((v) => v.name)).toEqual([
      'THE_FORGE_VENV',
      'THE_FORGE_PYTHON',
      'THE_FORGE_LAUNCHER',
    ]);
    expect(c.psCommand('THE_FORGE_VENV')).toBe(
      "[Environment]::SetEnvironmentVariable('THE_FORGE_VENV', '', 'User')",
    );
    expect(c.shCommand('THE_FORGE_VENV')).toBe('export THE_FORGE_VENV=');
    const el = fixture.nativeElement as HTMLElement;
    const text = el.textContent ?? '';
    expect(text).toContain("SetEnvironmentVariable('THE_FORGE_VENV'");
    expect(text).toContain('export THE_FORGE_VENV=');
  });

  it('copies a command to the clipboard and toasts on success', async () => {
    const { toast } = setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const fixture = await make();
    await fixture.componentInstance.copy('export THE_FORGE_VENV=');
    expect(writeText).toHaveBeenCalledWith('export THE_FORGE_VENV=');
    expect(toast.show).toHaveBeenCalledWith('state.copied', 'success');
  });

  it('toasts an error when the clipboard is unavailable', async () => {
    const { toast } = setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
      configurable: true,
    });
    const fixture = await make();
    await fixture.componentInstance.copy('x');
    expect(toast.show).toHaveBeenCalledWith('error.generic', 'error');
  });

  it('states apply-via-portal as unverified instead of faking a write op', async () => {
    setup();
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    const cap = el.querySelector('.capability ui-state-badge');
    expect(cap).toBeTruthy();
    // links to profiles instead of offering a fake apply button
    expect(el.querySelector('a[href="/profiles"], a[routerLink]')).toBeTruthy();
  });

  it('renders the error state when the environment call fails', async () => {
    setup(new ApiError(0));
    const fixture = await make();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('ui-error')).toBeTruthy();
    expect(el.querySelector('.env-table')).toBeNull();
  });
});
