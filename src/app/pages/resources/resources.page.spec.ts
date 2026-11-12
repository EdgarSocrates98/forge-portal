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
});
