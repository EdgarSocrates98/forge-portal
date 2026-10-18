import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UiGuideHint } from './guide-hint';
import { PrefsStore, PREFS_KEY } from '../core/prefs/prefs.store';

describe('UiGuideHint', () => {
  beforeEach(async () => {
    try {
      localStorage.removeItem(PREFS_KEY);
    } catch {
      // jsdom without storage
    }
    await TestBed.configureTestingModule({
      imports: [UiGuideHint],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  function render(id: string) {
    const fixture = TestBed.createComponent(UiGuideHint);
    fixture.componentRef.setInput('hintId', id);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the concept line and the guide deep-link', () => {
    const fixture = render('mcp');
    const el = fixture.nativeElement as HTMLElement;
    const hint = el.querySelector('.hint');
    expect(hint).toBeTruthy();
    const link = el.querySelector<HTMLAnchorElement>('.hint__more')!;
    expect(link.getAttribute('href')).toBe('/guide#mcp');
  });

  it('dismisses persistently — the hint never reappears', () => {
    const fixture = render('graph');
    const el = fixture.nativeElement as HTMLElement;
    el.querySelector<HTMLButtonElement>('.hint__x')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.hint')).toBeNull();
    const prefs = TestBed.inject(PrefsStore);
    expect(prefs.isHintDismissed('graph')).toBe(true);
    // a second render in the same session stays dismissed
    const again = render('graph');
    expect((again.nativeElement as HTMLElement).querySelector('.hint')).toBeNull();
  });

  it('resetHints brings dismissed hints back', () => {
    const fixture = render('skill');
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.hint__x')!.click();
    fixture.detectChanges();
    const prefs = TestBed.inject(PrefsStore);
    prefs.resetHints();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.hint')).toBeTruthy();
  });
});
