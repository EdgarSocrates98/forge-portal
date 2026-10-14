import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { VersionsPage } from './versions.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { VersionInfo } from '../../core/api/api.models';

const INFO: VersionInfo = {
  installed: {
    version: '0.4.2',
    origin: 'git+https://example.test/forge.git',
    channel: 'stable',
  },
  available: { version: null, source: 'github-releases' },
  compat: 'forge-portal >=0.4 · the-forge >=0.9',
  changelog: '## 0.4.2\n- fixed verify receipt\n- added /metrics',
  history: [
    { version: '0.4.2', at: '2026-01-03T12:00:00Z', detail: 'manual update' },
    { version: '0.4.1', at: '2026-01-01T08:00:00Z' },
    { version: null, at: null, detail: 'incomplete record' },
  ],
  rollback: { supported: true, hint: 'git checkout v0.4.1 && npm i' },
};

function fakeApi(overrides: Partial<Record<keyof PortalApi, unknown>> = {}): PortalApi {
  return {
    versions: vi.fn(() => of(INFO)),
    ...overrides,
  } as unknown as PortalApi;
}

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const section = (el: HTMLElement, name: string) =>
  el.querySelector(`[data-section="${name}"]`) as HTMLElement | null;

describe('VersionsPage', () => {
  async function setup(overrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [VersionsPage],
      providers: [{ provide: PortalApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(VersionsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  it('renders installed version, origin, channel and compat verbatim', async () => {
    const { el } = await setup();
    const installed = section(el, 'installed');

    expect(text(installed)).toContain('0.4.2');
    expect(text(installed)).toContain('git+https://example.test/forge.git');
    expect(text(installed)).toContain('stable');
    expect(text(installed)).toContain('forge-portal >=0.4 · the-forge >=0.9');
    // no unverified markers when every field is real data
    expect(installed?.querySelectorAll('[data-unverified]').length).toBe(0);
  });

  it('renders null installed fields as — plus a muted unverified marker', async () => {
    const { el } = await setup({
      versions: () =>
        of({
          ...INFO,
          installed: { version: null, origin: null, channel: null },
        }),
    });
    const installed = section(el, 'installed')!;

    const markers = installed.querySelectorAll('[data-unverified]');
    expect(markers.length).toBe(3);
    for (const m of markers) {
      expect(text(m)).toContain('—');
      expect(text(m)).toContain('Unverified');
    }
    // compat is still real data, unaffected by null fields
    expect(text(installed)).toContain('forge-portal >=0.4');
  });

  it('shows UNVERIFIED + the offline note instead of a fake latest version', async () => {
    const { el } = await setup();
    const available = section(el, 'available')!;

    const note = available.querySelector('[data-note="offline"]');
    expect(note).toBeTruthy();
    expect(text(note)).toContain('UNVERIFIED');
    // the declared source is still shown — it explains where a lookup
    // would go, without pretending one happened
    expect(text(available)).toContain('github-releases');
    // no invented version string anywhere on the page
    expect(el.querySelector('.available-version')).toBeNull();
    expect(text(available)).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it('renders the available version verbatim when the adapter reports one', async () => {
    const { el } = await setup({
      versions: () => of({ ...INFO, available: { version: '0.5.0', source: 'registry-mirror' } }),
    });
    const available = section(el, 'available')!;

    expect(text(available)).toContain('0.5.0');
    expect(text(available)).toContain('registry-mirror');
    expect(available.querySelector('[data-note="offline"]')).toBeNull();
  });

  it('renders the changelog when present', async () => {
    const { el } = await setup();
    expect(text(section(el, 'changelog'))).toContain('fixed verify receipt');
  });

  it('marks a null changelog unverified instead of fabricating one', async () => {
    const { el } = await setup({ versions: () => of({ ...INFO, changelog: null }) });
    const changelog = section(el, 'changelog')!;
    expect(changelog.querySelector('pre')).toBeNull();
    expect(changelog.querySelector('[data-unverified]')).toBeTruthy();
    expect(text(changelog)).toContain('Unverified');
  });

  it('renders history verbatim — null version/at keep unverified markers', async () => {
    const { el } = await setup();
    const history = section(el, 'history')!;
    const trs = [...history.querySelectorAll('tbody tr')];

    expect(trs.length).toBe(3);
    expect(text(trs[0])).toContain('0.4.2');
    expect(text(trs[0])).toContain('manual update');
    expect(text(trs[1])).toContain('0.4.1');
    // incomplete record: null version → unverified, null at/detail → '—'
    expect(trs[2].querySelector('[data-unverified]')).toBeTruthy();
    expect(text(trs[2])).toContain('incomplete record');
  });

  it('shows an honest empty state when no history was recorded', async () => {
    const { el } = await setup({ versions: () => of({ ...INFO, history: [] }) });
    const history = section(el, 'history')!;

    expect(history.querySelector('ui-empty')).toBeTruthy();
    expect(history.querySelectorAll('tbody tr').length).toBe(0);
  });

  it('reports rollback support exactly as declared, hint included', async () => {
    const { el } = await setup();
    const rollback = section(el, 'rollback')!;

    expect(rollback.querySelector('.badge[data-kind="ok"]')).toBeTruthy();
    expect(text(rollback)).toContain('git checkout v0.4.1 && npm i');
  });

  it('reports unsupported rollback as such — never as available', async () => {
    const { el } = await setup({
      versions: () => of({ ...INFO, rollback: { supported: false, hint: 'no snapshots kept' } }),
    });
    const rb = section(el, 'rollback')!;
    expect(rb.querySelector('.badge[data-kind="error"]')).toBeTruthy();
    expect(text(rb)).toContain('no snapshots kept');
  });

  it('marks the whole capability UNVERIFIED on 404 / PORTAL-NOT-FOUND', async () => {
    const { el } = await setup({
      versions: () =>
        throwError(() => new ApiError(404, { code: 'PORTAL-NOT-FOUND', message: 'no op' })),
    });

    const unv = section(el, 'unavailable');
    expect(unv).toBeTruthy();
    expect(text(unv)).toContain('UNVERIFIED');
    // never an empty-looking success
    for (const s of ['installed', 'available', 'changelog', 'history', 'rollback']) {
      expect(section(el, s)).toBeNull();
    }
    expect(el.querySelector('ui-error')).toBeNull();
    expect(el.querySelector('ui-empty')).toBeNull();
  });

  it('renders a retryable error state for non-404 failures', async () => {
    const { el, api, fixture } = await setup({
      versions: vi
        .fn()
        .mockImplementationOnce(() => throwError(() => new ApiError(500, { message: 'boom' })))
        .mockImplementation(() => of(INFO)),
    });

    expect(el.querySelector('ui-error')).toBeTruthy();
    el.querySelector<HTMLElement>('ui-error button')?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.versions).toHaveBeenCalledTimes(2);
    expect(text(section(el, 'installed'))).toContain('0.4.2');
  });
});
