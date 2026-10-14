import { TestBed } from '@angular/core/testing';
import { I18nService } from '../core/i18n/i18n.service';
import { ToastService, UiToastOutlet } from './toast';

describe('ToastService', () => {
  let toast: ToastService;

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    // load the real en dictionary before fake timers go on
    await TestBed.inject(I18nService).applyPreference('en');
    vi.useFakeTimers();
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('translates i18n keys and keeps literals verbatim', () => {
    toast.show('notify.success');
    toast.show('Something happened');
    const items = toast.items();
    expect(items.length).toBe(2);
    expect(items[0].text).toBe('Done');
    expect(items[0].kind).toBe('info');
    expect(items[1].text).toBe('Something happened');
  });

  it('interpolates params for key-based toasts', () => {
    toast.show('install.plan.changes', 'info', { params: { count: 3 } });
    expect(toast.items()[0].text).toBe('3 planned changes');
  });

  it('auto-dismisses info after ~4.5s and errors after ~7s', () => {
    toast.show('a', 'info');
    toast.show('b', 'error');
    expect(toast.items().length).toBe(2);
    vi.advanceTimersByTime(4600);
    expect(toast.items().map((t) => t.kind)).toEqual(['error']);
    vi.advanceTimersByTime(2500);
    expect(toast.items().length).toBe(0);
  });

  it('keeps at most 3 stacked toasts, evicting the oldest', () => {
    toast.show('one');
    toast.show('two');
    toast.show('three');
    toast.show('four');
    expect(toast.items().map((t) => t.text)).toEqual(['two', 'three', 'four']);
    vi.advanceTimersByTime(4600);
    expect(toast.items().length).toBe(0);
  });

  it('dismiss(id) removes a toast and clears its timer', () => {
    const id = toast.show('x');
    toast.dismiss(id);
    expect(toast.items().length).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(toast.items().length).toBe(0);
  });
});

describe('UiToastOutlet', () => {
  let toast: ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiToastOutlet] }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    vi.useFakeTimers();
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders items inside a polite live region, errors as alerts', () => {
    const fixture = TestBed.createComponent(UiToastOutlet);
    fixture.detectChanges();
    toast.show('all good', 'success');
    toast.show('it broke', 'error');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const region = el.querySelector('.toasts');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    const items = el.querySelectorAll('.toast');
    expect(items.length).toBe(2);
    expect(items[0].getAttribute('data-kind')).toBe('success');
    expect(items[0].getAttribute('role')).toBeNull();
    expect(items[1].getAttribute('role')).toBe('alert');
    expect(items[0].textContent).toContain('all good');
  });

  it('close button dismisses its own toast', () => {
    const fixture = TestBed.createComponent(UiToastOutlet);
    fixture.detectChanges();
    toast.show('x');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const close = host.querySelector('.toast__close') as HTMLElement | null;
    expect(close?.getAttribute('aria-label')).toBe('Dismiss');
    close?.click();
    fixture.detectChanges();
    expect(toast.items().length).toBe(0);
    expect(fixture.nativeElement.querySelector('.toast')).toBeNull();
  });

  it('Escape dismisses the newest toast', () => {
    const fixture = TestBed.createComponent(UiToastOutlet);
    fixture.detectChanges();
    toast.show('first');
    toast.show('second');
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(toast.items().map((t) => t.text)).toEqual(['first']);
  });
});
