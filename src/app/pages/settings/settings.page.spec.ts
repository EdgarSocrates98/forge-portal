import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsPage } from './settings.page';
import { PrefsStore, PREFS_KEY } from '../../core/prefs/prefs.store';

describe('SettingsPage — Cycle 5 preference controls', () => {
  beforeEach(async () => {
    try {
      localStorage.removeItem(PREFS_KEY);
    } catch {
      // jsdom without storage
    }
    await TestBed.configureTestingModule({
      imports: [SettingsPage],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  function make() {
    const fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
    return fixture;
  }

  it('renders density, motion and hint-reset controls', () => {
    const el = make().nativeElement as HTMLElement;
    expect(el.querySelectorAll("input[name='density']").length).toBe(2);
    expect(el.querySelectorAll("input[name='motion']").length).toBe(3);
    const reset = el.querySelector<HTMLButtonElement>('.card .btn');
    expect(reset).toBeTruthy();
  });

  it('writes density + motion through to the store and <html>', () => {
    const fixture = make();
    const prefs = TestBed.inject(PrefsStore);
    fixture.componentInstance.setDensity('compact');
    fixture.componentInstance.setMotion('reduced');
    fixture.detectChanges();
    expect(prefs.density()).toBe('compact');
    expect(prefs.motion()).toBe('reduced');
    expect(document.documentElement.dataset['density']).toBe('compact');
    expect(document.documentElement.dataset['motion']).toBe('reduced');
    // restore document state for the remaining specs
    fixture.componentInstance.setDensity('comfortable');
    fixture.componentInstance.setMotion('system');
    fixture.detectChanges();
  });

  it('enables the hint reset only when a hint was dismissed', () => {
    const fixture = make();
    const prefs = TestBed.inject(PrefsStore);
    const button = () =>
      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.card .btn')!;
    expect(button().disabled).toBe(true);
    prefs.dismissHint('graph');
    fixture.detectChanges();
    expect(button().disabled).toBe(false);
    button().click();
    fixture.detectChanges();
    expect(prefs.dismissedHints().length).toBe(0);
  });
});
