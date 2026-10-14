import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ProfilesPage } from './profiles.page';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { ConfirmService } from '../../shared/confirm-dialog';
import { ProfileDescriptor } from '../../core/api/api.models';

const PROFILES: ProfileDescriptor[] = [
  {
    id: 'economy',
    label_key: 'profiles.economy',
    description_key: 'profiles.economy.desc',
    current: false,
    components: { skills: true, agents: false, mcp: true },
  },
  {
    id: 'recommended',
    label_key: 'profiles.balanced',
    description_key: 'profiles.balanced.desc',
    current: true,
    components: { skills: true, agents: true, mcp: true },
  },
  {
    id: 'full',
    label_key: 'profiles.full',
    description_key: 'profiles.full.desc',
    current: false,
    components: { skills: true, agents: true, mcp: true, tui: true },
  },
];

function setup(confirmResult = true, apiOverrides: Partial<Record<keyof PortalApi, unknown>> = {}) {
  const api = {
    profiles: vi.fn(() => of(PROFILES)),
    profilesApply: vi.fn(() => of({ status: 'applied' })),
    ...apiOverrides,
  };
  const ask = vi.fn(async () => confirmResult);
  TestBed.configureTestingModule({
    imports: [ProfilesPage],
    providers: [
      { provide: PortalApi, useValue: api },
      { provide: ConfirmService, useValue: { ask } },
    ],
  });
  return { api, ask };
}

async function make() {
  const fixture = TestBed.createComponent(ProfilesPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('ProfilesPage', () => {
  it('lists the backend profiles', async () => {
    setup();
    const fixture = await make();
    const cards = fixture.nativeElement.querySelectorAll('article.card');
    expect(cards.length).toBe(3);
  });

  it('defaults the comparison to current vs the first other profile', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    expect(c.compareA()).toBe('recommended');
    expect(c.compareB()).toBe('economy');
    // union of both component maps, sorted
    expect(c.compareRows().map((r) => r.id)).toEqual(['agents', 'mcp', 'skills']);
  });

  it('highlights rows where the profiles differ', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    // recommended vs economy differ on agents only
    expect(c.diffCount()).toBe(1);
    fixture.detectChanges();
    const diffRows = fixture.nativeElement.querySelectorAll('tr[data-diff]');
    expect(diffRows.length).toBe(1);
    expect(diffRows[0].textContent).toContain('agents');
  });

  it('treats a missing component key as off, never as invented state', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    c.compareA.set('full'); // has tui: true
    c.compareB.set('economy'); // no tui key at all
    const tui = c.compareRows().find((r) => r.id === 'tui');
    expect(tui).toEqual({ id: 'tui', a: true, b: false });
    expect(c.diffCount()).toBe(2); // agents + tui
  });

  it('reports identical selections with the same-profile message', async () => {
    setup();
    const fixture = await make();
    const c = fixture.componentInstance;
    c.compareA.set('economy');
    c.compareB.set('economy');
    expect(c.diffCount()).toBe(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.compare__summary')).toBeTruthy();
  });

  it('does not apply a profile when the confirm dialog is cancelled', async () => {
    const { api, ask } = setup(false);
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.apply('economy');
    expect(ask).toHaveBeenCalledOnce();
    expect(api.profilesApply).not.toHaveBeenCalled();
  });

  it('applies a profile through ConfirmService when confirmed', async () => {
    const { api, ask } = setup(true);
    const fixture = await make();
    const c = fixture.componentInstance;
    await c.apply('economy');
    expect(ask).toHaveBeenCalledOnce();
    expect(api.profilesApply).toHaveBeenCalledWith('economy');
    expect(c.receipt()?.status).toBe('applied');
  });

  it('shows the error state when profiles cannot load', async () => {
    setup(true, { profiles: () => throwError(() => new ApiError(0)) });
    const fixture = await make();
    expect(fixture.nativeElement.querySelector('ui-error')).toBeTruthy();
  });
});
