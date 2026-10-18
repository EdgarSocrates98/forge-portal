import { TestBed } from '@angular/core/testing';
import { I18nService } from '../core/i18n/i18n.service';
import { UiPager, pageSlice } from './pager';

describe('pageSlice — bounds-honest slicing', () => {
  it('splits a full range into pages and reports its own position', () => {
    expect(pageSlice(250, 100, 0)).toEqual({
      page: 0,
      pages: 3,
      start: 0,
      end: 100,
      total: 250,
    });
    expect(pageSlice(250, 100, 2)).toEqual({
      page: 2,
      pages: 3,
      start: 200,
      end: 250,
      total: 250,
    });
  });

  it('clamps an out-of-range page instead of rendering an empty view', () => {
    // data shrank since the page was chosen — resolve to the last real page
    expect(pageSlice(30, 100, 4).page).toBe(0);
    expect(pageSlice(150, 100, 9).page).toBe(1);
    expect(pageSlice(150, 100, 9).end).toBe(150);
    expect(pageSlice(150, 100, -3).page).toBe(0);
  });

  it('keeps a single honest page for empty and exact-fit input', () => {
    expect(pageSlice(0, 100, 0)).toEqual({ page: 0, pages: 1, start: 0, end: 0, total: 0 });
    expect(pageSlice(100, 100, 0).pages).toBe(1);
  });

  it('survives degenerate sizes without dividing by zero', () => {
    const s = pageSlice(10, 0, 0);
    expect(s.pages).toBe(10);
    expect(s.end).toBe(1);
  });
});

describe('UiPager', () => {
  /** Configure once per spec — `make` then stamps fixtures freely. */
  async function configure() {
    await TestBed.configureTestingModule({ imports: [UiPager] }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
  }

  function make(total = 250, page = 0) {
    const fixture = TestBed.createComponent(UiPager);
    fixture.componentRef.setInput('total', total);
    fixture.componentRef.setInput('pageSize', 100);
    fixture.componentRef.setInput('page', page);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function setup(total = 250, page = 0) {
    await configure();
    return make(total, page);
  }

  it('renders the real range and emits page changes', async () => {
    const { fixture, el } = await setup();
    expect(el.querySelector('[data-page="range"]')?.textContent).toContain('1');
    expect(el.querySelector('[data-page="range"]')?.textContent).toContain('250');
    const emitted: number[] = [];
    fixture.componentInstance.pageChange.subscribe((p) => emitted.push(p));
    el.querySelector<HTMLButtonElement>('[data-page="next"]')!.click();
    expect(emitted).toEqual([1]);
    // stateless by contract: the parent applies the emitted page,
    // then prev becomes reachable
    fixture.componentRef.setInput('page', 1);
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('[data-page="prev"]')!.disabled).toBe(false);
  });

  it('disables the prev control on the first page and next on the last', async () => {
    const { fixture, el } = await setup(250, 0);
    expect(el.querySelector<HTMLButtonElement>('[data-page="prev"]')!.disabled).toBe(true);
    fixture.componentRef.setInput('page', 2);
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('[data-page="next"]')!.disabled).toBe(true);
  });

  it('hides itself when a single page covers the data — no fake chrome', async () => {
    const { el } = await setup(40, 0);
    expect(el.querySelector('nav.pager')).toBeNull();
  });
});
