import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ResourcesPage } from './resources.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { ResourceEntry, WorkspaceResources } from '../../core/api/api.models';

const RES: ResourceEntry[] = [
  {
    forge_id: 'spark-forge-aws',
    id: 'glue-tuning',
    kind: 'skill',
    resource_class: 'agentic',
    availability: 'available',
    unavailable_reason: null,
    location: 'skills/glue-tuning/SKILL.md',
    tags: ['spark'],
    description: 'Glue tuning',
    format: 'markdown',
    version: '2.2.1',
    domain: null,
    hosts: ['claude', 'devin'],
    hash: null,
    integrity: null,
  },
  {
    forge_id: 'api-forge',
    id: 'missing-doc',
    kind: 'knowledge',
    resource_class: 'read-only',
    availability: 'unavailable',
    unavailable_reason: 'not shipped in wheel',
    location: null,
    tags: [],
    description: null,
    format: null,
  },
];

const PAYLOAD: WorkspaceResources = {
  workspace: '/ws',
  forges: ['spark-forge-aws', 'api-forge'],
  members: [
    {
      name: 'spark-forge-aws',
      path: 'spark-forge-aws',
      markers: ['.git', 'forge.agentic.json'],
      git: true,
      manifest: true,
    },
    {
      name: 'gitless-lib',
      path: 'gitless-lib',
      markers: ['package.json'],
      git: false,
      manifest: false,
    },
  ],
  resources: RES,
  errors: [],
};

function setup(payload = PAYLOAD, fail = false) {
  const api = {
    workspaceResources: () => (fail ? throwError(() => new ApiError(500)) : of(payload)),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: PortalApi, useValue: api }],
  });
  return TestBed.createComponent(ResourcesPage).componentInstance;
}

describe('ResourcesPage', () => {
  it('lists federated resources and filters by forge/kind', async () => {
    const page = setup();
    await page.load();
    expect(page.data()?.resources.length).toBe(2);
    expect(page.unavailableCount()).toBe(1);
    page.forge.set('api-forge');
    expect(page.filtered().map((r) => r.id)).toEqual(['missing-doc']);
    page.forge.set(null);
    page.kind.set('skill');
    expect(page.filtered().map((r) => r.id)).toEqual(['glue-tuning']);
  });

  it('surfaces typed error on failure', async () => {
    const page = setup(PAYLOAD, true);
    await page.load();
    expect(page.error()).not.toBeNull();
    expect(page.data()).toBeNull();
  });

  it('exposes workspace members incl. gitless (§20.1)', async () => {
    const page = setup();
    await page.load();
    const members = page.data()?.members ?? [];
    expect(members.length).toBe(2);
    expect(page.gitlessCount(members)).toBe(1);
    const gitless = members.find((m) => m.name === 'gitless-lib');
    expect(gitless?.git).toBe(false);
    expect(gitless?.markers).toEqual(['package.json']);
  });

  it('keeps manifest provenance fields honest — null stays null', async () => {
    const page = setup();
    await page.load();
    const typed = page.data()?.resources.find((r) => r.id === 'glue-tuning');
    expect(typed?.version).toBe('2.2.1');
    expect(typed?.hosts).toEqual(['claude', 'devin']);
    expect(typed?.domain).toBeNull();
    expect(typed?.hash).toBeNull();
    expect(typed?.integrity).toBeNull();
    // entries without declared provenance stay undefined|null — the UI
    // renders state.absent, never an invented value
    const legacy = page.data()?.resources.find((r) => r.id === 'missing-doc');
    expect(legacy?.version).toBeUndefined();
  });
});
