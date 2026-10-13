import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { PortalStore } from './core/portal/portal.store';

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
  async bootstrap(): Promise<void> {}
  async refreshHealth(): Promise<void> {}
}

describe('App shell', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: PortalStore, useClass: PortalStoreStub }],
    }).compileComponents();
  });

  it('creates the shell', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the sidebar with all three nav sections', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const items = el.querySelectorAll('.nav__item');
    expect(items.length).toBe(12);
  });

  it('shows the offline banner when the server is unreachable', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('.offline-banner');
    expect(banner).toBeTruthy();
  });
});
