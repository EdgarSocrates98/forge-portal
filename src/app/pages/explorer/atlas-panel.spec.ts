import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AtlasStatusPanel } from './atlas-panel';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { AtlasStatus } from '../../core/api/api.models';

const AVAILABLE: AtlasStatus = {
  schema: 'forge/PortalAtlasStatus/1',
  state: 'available',
  url: 'http://127.0.0.1:8741',
  service: 'code-atlas-api',
  api_version: 1,
  detail: null,
  health: { status: 'ok', service: 'code-atlas-api', version: 1 },
  index: {
    items: [
      {
        repository_id: 1,
        root_handle: 'E:/ws/repo',
        ready_snapshots: 2,
        latest_ready: 7,
        counts: { file_inventory: 12, symbol_occurrences: 120 },
      },
    ],
    repositories: 1,
    ready_snapshots: 2,
  },
  checked_at: '2026-01-01T10:00:00Z',
};

const text = (el: Element | null | undefined) => el?.textContent ?? '';

describe('AtlasStatusPanel', () => {
  async function setup(doc: AtlasStatus | null, err?: ApiError) {
    await TestBed.configureTestingModule({
      imports: [AtlasStatusPanel],
      providers: [
        {
          provide: PortalApi,
          useValue: {
            atlasStatus: () => (err ? throwError(() => err) : of(doc)),
          } as unknown as PortalApi,
        },
      ],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(AtlasStatusPanel);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  it('renders available + index status honestly', async () => {
    const el = (await setup(AVAILABLE)).nativeElement as HTMLElement;
    const section = el.querySelector('[data-section="atlas"]') as HTMLElement;
    expect(text(section)).toContain('Code Atlas');
    expect(text(section)).toContain('Available');
    expect(text(section)).toContain('http://127.0.0.1:8741');
    expect(text(section)).toContain('code-atlas-api');
    expect(text(section)).toContain('Repositories: 1');
    expect(text(section)).toContain('Ready snapshots: 2');
    expect(text(section)).toContain('E:/ws/repo');
    expect(text(section)).toContain('symbol_occurrences 120');
    expect(el.querySelector('ui-error')).toBeNull();
  });

  it('renders a named unavailable state — no spinner, no fake data', async () => {
    const el = (
      await setup({
        schema: 'forge/PortalAtlasStatus/1',
        state: 'unavailable',
        url: 'http://127.0.0.1:8741',
        service: null,
        api_version: null,
        detail: 'connection-refused',
        health: null,
        index: null,
        checked_at: '2026-01-01T10:00:00Z',
      })
    ).nativeElement as HTMLElement;
    const section = el.querySelector('[data-section="atlas"]') as HTMLElement;
    expect(text(section)).toContain('Unavailable');
    expect(text(section)).toContain('connection-refused');
    expect(text(section)).toContain('code-atlas api serve'); // recovery hint
    expect(el.querySelector('ui-skeleton')).toBeNull(); // terminal, not loading
    expect(el.querySelector('ui-error')).toBeNull(); // a named state, not an error
  });

  it('renders degraded with the failure token', async () => {
    const el = (
      await setup({
        schema: 'forge/PortalAtlasStatus/1',
        state: 'degraded',
        url: 'http://127.0.0.1:8741',
        service: 'code-atlas-api',
        api_version: 1,
        detail: 'index:http-500',
        health: { status: 'ok' },
        index: null,
        checked_at: '2026-01-01T10:00:00Z',
      })
    ).nativeElement as HTMLElement;
    expect(text(el)).toContain('Degraded');
    expect(text(el)).toContain('index:http-500');
  });

  it('renders UNVERIFIED when the serving Forja lacks the op', async () => {
    const el = (
      await setup(null, new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' }))
    ).nativeElement as HTMLElement;
    expect(text(el)).toContain('UNVERIFIED');
    expect(text(el)).toContain('does not expose the Code Atlas probe');
    expect(el.querySelector('ui-error')).toBeNull();
  });
});
