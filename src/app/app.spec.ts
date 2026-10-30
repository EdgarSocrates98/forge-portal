import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { PortalStore } from './core/portal/portal.store';
import { PREFS_KEY } from './core/prefs/prefs.store';

@Component({ standalone: true, template: '<p>stub</p>' })
class StubPage {}

const STUB_ROUTES = [
  { path: 'dashboard', component: StubPage },
  { path: 'agents', component: StubPage },
  { path: '**', redirectTo: 'dashboard' },
];

class PortalStoreStub {
  readonly status = () => 'offline' as const;
  readonly descriptor = () => null;
  readonly forgeName = () => 'Forge Portal';
  readonly forgeId = () => 'the-forge';
  readonly federated = () => false;
  readonly capabilities = () => [];
  readonly nav = () => [];
  readonly workspace = () => null;
  readonly health = () => null;
  readonly lastError = () => null;
  async bootstrap(): Promise<void> {}
  async refreshHealth(): Promise<void> {}
}

describe('App shell', () => {
  beforeEach(async () => {
    try {
      localStorage.removeItem(PREFS_KEY);
    } catch {
      // jsdom without storage
    }
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: PortalStore, useClass: PortalStoreStub }],
    }).compileComponents();
  });

  it('creates the shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the five journey nav groups in order', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const groups = [...el.querySelectorAll<HTMLElement>('.nav__group')];
    expect(groups.length).toBe(5);
    const labelledBy = groups.map((g) => g.getAttribute('aria-labelledby'));
    expect(labelledBy).toEqual([
      'nav-h-overview',
      'nav-h-explore',
      'nav-h-operate',
      'nav-h-analyze',
      'nav-h-settings',
    ]);
    const sectionIds = [...el.querySelectorAll<HTMLElement>('.nav__section')].map((s) => s.id);
    expect(sectionIds).toEqual(labelledBy);
  });

  it('keeps every route item inside its journey group', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const routes = [...el.querySelectorAll<HTMLAnchorElement>('.nav__item')].map((a) =>
      a.getAttribute('href'),
    );
    expect(routes).toEqual([
      '/dashboard',
      '/guide',
      '/federation',
      '/forges',
      '/agents',
      '/skills',
      '/mcp',
      '/knowledge',
      '/pf',
      '/match',
      '/tasks',
      '/install',
      '/profiles',
      '/hosts',
      '/config',
      '/graph',
      '/observe',
      '/execution',
      '/lab',
      '/versions',
      '/settings',
    ]);
  });

  it('collapses the sidebar via the button and the [ key', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const side = el.querySelector<HTMLElement>('.shell__side')!;
    const btn = el.querySelector<HTMLButtonElement>('.nav__collapse')!;
    expect(side.hasAttribute('data-collapsed')).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    btn.click();
    fixture.detectChanges();
    expect(side.hasAttribute('data-collapsed')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
    fixture.detectChanges();
    expect(side.hasAttribute('data-collapsed')).toBe(false);
  });

  it('ignores the [ shortcut while typing in an input', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));
    fixture.detectChanges();
    const side = fixture.nativeElement.querySelector('.shell__side') as HTMLElement;
    expect(side.hasAttribute('data-collapsed')).toBe(false);
    input.remove();
  });

  it('shows the offline banner when the server is unreachable', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.offline-banner');
    expect(banner).toBeTruthy();
  });

  it('shows the real error key (not unreachable) on session errors', async () => {
    class SessionErrorStub extends PortalStoreStub {
      override readonly status = () => 'error' as 'offline';
      override readonly lastError = () =>
        ({
          transport: false,
          status: 403,
          body: { code: 'PORTAL-SESSION', message_key: 'error.session' },
        }) as never;
    }
    await TestBed.resetTestingModule()
      .configureTestingModule({
        imports: [App],
        providers: [provideRouter([]), { provide: PortalStore, useClass: SessionErrorStub }],
      })
      .compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.offline-banner') as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('error.session');
    expect(banner.textContent).not.toContain('error.unreachable');
  });
});

describe('App shell — a11y chrome', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(STUB_ROUTES), { provide: PortalStore, useClass: PortalStoreStub }],
    }).compileComponents();
  });

  it('marks the active nav link aria-current="page"', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    fixture.detectChanges();
    await router.navigateByUrl('/dashboard');
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const active = el.querySelector<HTMLAnchorElement>('.nav__item--active');
    expect(active?.getAttribute('href')).toBe('/dashboard');
    expect(active?.getAttribute('aria-current')).toBe('page');
    const others = [...el.querySelectorAll<HTMLAnchorElement>('.nav__item')].filter(
      (a) => a !== active,
    );
    expect(others.every((a) => !a.hasAttribute('aria-current'))).toBe(true);
  });

  it('moves focus into <main> on later navigations, not the first', async () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    fixture.detectChanges();
    await router.navigateByUrl('/dashboard');
    await fixture.whenStable();
    const main = document.getElementById('content');
    expect(main).toBeTruthy();
    expect(document.activeElement).not.toBe(main);
    await router.navigateByUrl('/agents');
    await fixture.whenStable();
    expect(document.activeElement).toBe(main);
  });
});
