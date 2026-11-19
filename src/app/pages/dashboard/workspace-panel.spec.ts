import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { WorkspacePanel } from './workspace-panel';
import { PortalApi } from '../../core/api/api.client';
import { PortalStore } from '../../core/portal/portal.store';
import {
  PortalHealth,
  RegistryState,
  VersionInfo,
  WorkspaceResources,
} from '../../core/api/api.models';

const WS: WorkspaceResources = {
  workspace: '/ws',
  forges: ['the-forge'],
  members: [
    { name: 'a', path: 'a', markers: ['.git', 'pyproject.toml'], git: true, manifest: false },
    { name: 'b', path: 'b', markers: ['package.json'], git: false, manifest: false },
  ],
  resources: [],
  errors: [],
};

const HEALTH: PortalHealth = {
  state: 'INSTALLED',
  checks: [
    { id: 'drift:/etc/x', state: 'FAIL' },
    { id: 'cross-forge-conflicts', state: 'FAIL' },
    { id: 'hosts', state: 'PASS' },
  ],
  workspace: '/ws',
  profile: 'recommended',
  updated_at: '2026-01-01T10:00:00Z',
  lifecycle: { schema: 'forge/InstallLifecycle/v1', state: 'verified', detail: 'PASS' },
};

const REGISTRY: RegistryState = {
  schema: 'forge-cli/RegistryState/v1',
  state_path: '/home/u/.forge-cli/forges/state.json',
  present: true,
  forges: {
    'api-forge': { method: 'registry', spec: 'api-forge', installedAt: '2026-01-02T09:00:00Z' },
  },
};

const VERSIONS: VersionInfo = {
  installed: { version: '1.1.3', origin: 'dev', channel: null },
  available: { version: null, source: 'none' },
  compat: 'unknown',
  changelog: null,
  history: [{ version: '1.0.0', at: '2026-01-03T08:00:00Z', detail: 'install' }],
  rollback: { supported: false },
};

function setup() {
  const api = { workspaceResources: () => of(WS) };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
  });
  const fixture = TestBed.createComponent(WorkspacePanel);
  const inst = fixture.componentInstance;
  const store = TestBed.inject(PortalStore);
  store.descriptor.set({
    forge_id: 'the-forge',
    forge_name: 'The Forge',
    forge_version: '1.0.0',
    cli: 'theforge',
    theme: 'the-forge',
    portal_version: '1.1.3',
    workspace: { root: '/ws', name: 'ws' },
    capabilities: [
      { id: 'a', state: 'supported' },
      { id: 'b', state: 'unverified' },
    ],
    nav: [],
    federated: true,
  });
  return { fixture, inst };
}

describe('WorkspacePanel', () => {
  it('renders members, markers and capabilities from real sources', async () => {
    const { inst } = setup();
    await inst.load();
    expect(inst.members()?.length).toBe(2);
    expect(inst.markers()).toEqual(['.git', 'package.json', 'pyproject.toml']);
    expect(inst.capsSupported()).toBe(1);
    expect(inst.root()).toBe('/ws');
  });

  it('drift/conflict/lastInstall stay null until the sources answer', async () => {
    const { inst } = setup();
    await inst.load();
    expect(inst.driftChecks()).toBeNull();
    expect(inst.conflictChecks()).toBeNull();
    expect(inst.lastInstall()).toBeNull();
  });

  it('drift and conflicts come from real doctor checks only', async () => {
    const { fixture, inst } = setup();
    fixture.componentRef.setInput('health', HEALTH);
    await inst.load();
    expect(inst.driftChecks()?.length).toBe(1);
    expect(inst.driftChecks()?.[0].id).toBe('drift:/etc/x');
    expect(inst.conflictChecks()?.length).toBe(1);
  });

  it('picks the newest observed install stamp with its source label', async () => {
    const { fixture, inst } = setup();
    fixture.componentRef.setInput('registry', REGISTRY);
    fixture.componentRef.setInput('versions', VERSIONS);
    await inst.load();
    const li = inst.lastInstall();
    expect(li?.at).toBe('2026-01-03T08:00:00Z');
    expect(li?.source).toBe('receipt');
  });
});
