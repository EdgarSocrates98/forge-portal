import { ComponentFixture, TestBed } from '@angular/core/testing';
import { I18nService } from '../core/i18n/i18n.service';
import { ConfirmService, UiConfirmHost } from './confirm-dialog';

describe('ConfirmService', () => {
  let confirm: ConfirmService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    confirm = TestBed.inject(ConfirmService);
  });

  it('exposes pending options until settled', async () => {
    const p = confirm.ask({ title: 'T', message: 'M', danger: true });
    expect(confirm.pending()?.danger).toBe(true);
    confirm.settle(true);
    expect(confirm.pending()).toBeNull();
    await expect(p).resolves.toBe(true);
  });

  it('a second ask cancels the first (fail-safe false, never stacked)', async () => {
    const first = confirm.ask({ title: 'a', message: 'a' });
    const second = confirm.ask({ title: 'b', message: 'b' });
    await expect(first).resolves.toBe(false);
    expect(confirm.pending()?.title).toBe('b');
    confirm.settle(false);
    await expect(second).resolves.toBe(false);
  });
});

describe('UiConfirmHost', () => {
  let confirm: ConfirmService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiConfirmHost] }).compileComponents();
    // real en dictionary before fake timers go on
    await TestBed.inject(I18nService).applyPreference('en');
    vi.useFakeTimers();
    confirm = TestBed.inject(ConfirmService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mount(): ComponentFixture<UiConfirmHost> {
    const fixture = TestBed.createComponent(UiConfirmHost);
    fixture.detectChanges();
    return fixture;
  }

  it('renders a labelled modal dialog and resolves on confirm', async () => {
    const fixture = mount();
    const done = confirm.ask({
      title: 'Remove profile',
      message: 'This cannot be undone.',
    });
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const panel = el.querySelector('.cd__panel');
    expect(panel?.getAttribute('role')).toBe('dialog');
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    expect(panel?.getAttribute('aria-labelledby')).toBe('ui-confirm-title');
    expect(panel?.getAttribute('aria-describedby')).toBe('ui-confirm-desc');
    expect(el.querySelector('#ui-confirm-title')?.textContent).toContain('Remove profile');
    expect(el.querySelector('#ui-confirm-desc')?.textContent).toContain('cannot be undone');

    const buttons = el.querySelectorAll<HTMLButtonElement>('.cd__actions button');
    expect(buttons[0].textContent?.trim()).toBe('Cancel');
    expect(buttons[1].textContent?.trim()).toBe('Confirm');

    buttons[1].click();
    fixture.detectChanges();
    await expect(done).resolves.toBe(true);
    expect(confirm.pending()).toBeNull();
    expect(el.querySelector('.cd__panel')).toBeNull();
  });

  it('applies danger styling and focuses Cancel first', async () => {
    const fixture = mount();
    const done = confirm.ask({ title: 'Danger', message: 'm', danger: true });
    fixture.detectChanges();
    vi.advanceTimersByTime(0);

    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll<HTMLButtonElement>('.cd__actions button');
    expect(buttons[1].classList.contains('cd__danger')).toBe(true);
    expect(buttons[1].classList.contains('btn--primary')).toBe(false);
    expect(document.activeElement).toBe(buttons[0]);

    confirm.settle(false);
    await done;
  });

  it('focuses the primary action on open and restores focus on close', async () => {
    const fixture = mount();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const done = confirm.ask({ title: 't', message: 'm' });
    fixture.detectChanges();
    vi.advanceTimersByTime(0);

    const el = fixture.nativeElement as HTMLElement;
    const buttons = el.querySelectorAll<HTMLButtonElement>('.cd__actions button');
    expect(document.activeElement).toBe(buttons[1]);

    buttons[0].click();
    fixture.detectChanges();
    vi.advanceTimersByTime(0);
    await expect(done).resolves.toBe(false);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('traps Tab within the dialog and Escape resolves false', async () => {
    const fixture = mount();
    const done = confirm.ask({ title: 't', message: 'm' });
    fixture.detectChanges();
    vi.advanceTimersByTime(0);

    const el = fixture.nativeElement as HTMLElement;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('.cd__actions button')];
    const [cancelBtn, okBtn] = buttons;
    expect(document.activeElement).toBe(okBtn);

    // Tab on the last focusable wraps to the first
    okBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(cancelBtn);
    // Shift+Tab on the first wraps to the last
    cancelBtn.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(okBtn);

    // Escape cancels (via the panel trap handler)
    okBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    await expect(done).resolves.toBe(false);
    expect(confirm.pending()).toBeNull();
  });

  it('Escape outside the panel and backdrop click both cancel', async () => {
    const fixture = mount();
    const first = confirm.ask({ title: 't', message: 'm' });
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    await expect(first).resolves.toBe(false);

    const second = confirm.ask({ title: 't2', message: 'm2' });
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.cd') as HTMLElement).click();
    fixture.detectChanges();
    await expect(second).resolves.toBe(false);
  });
});
