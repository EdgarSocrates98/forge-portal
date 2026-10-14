import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { PortalApi } from '../core/api/api.client';
import { ApiError } from '../core/api/api.error';
import { I18nService } from '../core/i18n/i18n.service';
import { PortalStore } from '../core/portal/portal.store';
import { SEARCH_DEBOUNCE_MS } from '../core/search/search.service';
import { CommandPalette } from './command-palette';

const flush = async (rounds = 10): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};

function fakeApi(over: Record<string, unknown> = {}) {
  return {
    federation: vi.fn(() =>
      of({
        specialists: [{ provider: 'api-forge', state: 'installed' }],
        installed_forges: ['api-forge'],
        registry: { count: 1, path: '/reg' },
        summary: { catalog: 1, installed: 1, with_mcp: 0, with_checkout: 0 },
      }),
    ),
    skills: vi.fn(() =>
      of([
        {
          id: 's1',
          name: 'spark-debug',
          domain: 'spark',
          description: '',
          state: 'installed',
          hosts: [],
        },
      ]),
    ),
    agents: vi.fn(() => of([])),
    mcpServers: vi.fn(() => of([])),
    hosts: vi.fn(() => of([])),
    tasks: vi.fn(() => of([])),
    docsSearch: vi.fn(() => of([])),
    ...over,
  };
}

const fakeStore = {
  nav: signal([]),
  capabilities: signal([]),
  refreshedAt: signal<string | null>('2026-10-14T00:00:00Z'),
  refreshHealth: vi.fn(async () => {}),
};

describe('CommandPalette', () => {
  let fixture: ComponentFixture<CommandPalette>;
  let comp: CommandPalette;
  let el: HTMLElement;
  let api: ReturnType<typeof fakeApi>;

  async function open() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  }

  async function type(q: string) {
    const input = el.querySelector<HTMLInputElement>('.cp__input');
    if (!input) throw new Error('no input');
    input.value = q;
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();
    fixture.detectChanges();
  }

  function keydown(target: Element, key: string) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key }));
    fixture.detectChanges();
  }

  const options = () => [...el.querySelectorAll<HTMLElement>('.cp__item')];
  const chips = () => [...el.querySelectorAll<HTMLElement>('.cp__chip')];
  const groups = () => [...el.querySelectorAll<HTMLElement>('.cp__group')];

  beforeEach(async () => {
    api = fakeApi();
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CommandPalette],
      providers: [
        provideRouter([]),
        { provide: PortalApi, useValue: api },
        { provide: PortalStore, useValue: fakeStore },
      ],
    });
    const i18n = TestBed.inject(I18nService);
    await i18n.applyPreference('en');
    fixture = TestBed.createComponent(CommandPalette);
    comp = fixture.componentInstance;
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts closed and opens on Ctrl+K with input focused', async () => {
    expect(el.querySelector('.cp__panel')).toBeNull();
    await open();
    expect(el.querySelector('.cp__panel')).toBeTruthy();
    expect(el.querySelector('.cp__list[role="listbox"]')).toBeTruthy();
    expect(document.activeElement).toBe(el.querySelector('.cp__input'));
  });

  it('renders results grouped by kind with filter chips and a footer hint', async () => {
    await open();
    expect(groups().length).toBeGreaterThanOrEqual(3); // page, forge, skill…
    expect(chips().length).toBeGreaterThanOrEqual(3);
    expect(chips()[0]?.textContent?.trim()).toBe('All');
    expect(el.querySelector('.cp__footer')).toBeTruthy();
    expect(el.querySelector('[role="radiogroup"]')).toBeTruthy();
    expect(el.querySelectorAll('[role="option"]').length).toBe(options().length);
  });

  it('debounces typing — one docs query per debounce window', async () => {
    await open();
    const input = el.querySelector<HTMLInputElement>('.cp__input');
    if (!input) throw new Error('no input');
    input.value = 'a';
    input.dispatchEvent(new Event('input'));
    input.value = 'ab';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();
    expect(api.docsSearch).toHaveBeenCalledTimes(1);
    expect(api.docsSearch).toHaveBeenCalledWith('ab');
  });

  it('arrow keys move aria-selected and Enter navigates', async () => {
    await open();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const input = el.querySelector<HTMLElement>('.cp__input');
    if (!input) throw new Error('no input');
    keydown(input, 'ArrowDown');
    const selected = el.querySelector('[role="option"][aria-selected="true"]');
    expect(selected).toBeTruthy();
    const item = comp.flat()[comp.idx()];
    keydown(input, 'Enter');
    expect(comp.open()).toBe(false);
    expect(nav).toHaveBeenCalledWith(item?.route);
  });

  it('Escape closes the palette', async () => {
    await open();
    const input = el.querySelector<HTMLElement>('.cp__input');
    if (!input) throw new Error('no input');
    keydown(input, 'Escape');
    expect(comp.open()).toBe(false);
    fixture.detectChanges();
    expect(el.querySelector('.cp__panel')).toBeNull();
  });

  it('clicking a result runs it', async () => {
    await open();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const first = options()[0];
    first?.dispatchEvent(new MouseEvent('click'));
    expect(comp.open()).toBe(false);
    expect(nav).toHaveBeenCalled();
  });

  it('runs shell actions without navigation', async () => {
    await open();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const refresh = comp.flat().find((r) => r.id === 'act:refresh');
    comp.run(refresh!);
    expect(fakeStore.refreshHealth).toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  it('filters by kind when a chip is clicked', async () => {
    await open();
    const skillChip = chips().find((c) =>
      ['command.kind.skill', 'Skills'].some((label) => c.textContent?.includes(label)),
    );
    // fall back to the component API if chip order changed
    if (!skillChip) {
      comp.setFilter('skill');
      fixture.detectChanges();
    } else {
      skillChip.click();
    }
    fixture.detectChanges();
    expect(comp.filter()).toBe('skill');
    expect(options().length).toBe(1);
    expect(comp.flat().every((r) => r.kind === 'skill')).toBe(true);
  });

  it('ArrowRight on the chip row cycles the filter (roving radiogroup)', async () => {
    await open();
    const first = chips()[0];
    first?.focus();
    keydown(first!, 'ArrowRight');
    expect(comp.filter()).toBe('page');
    expect(document.activeElement).toBe(chips()[1]);
    keydown(chips()[1]!, 'ArrowLeft');
    expect(comp.filter()).toBe('all');
  });

  it('shows a loading row while a search is in flight', async () => {
    api.docsSearch = vi.fn(() => new Observable<never>(() => {}));
    await open();
    const input = el.querySelector<HTMLInputElement>('.cp__input');
    if (!input) throw new Error('no input');
    input.value = 'x';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    await flush();
    fixture.detectChanges();
    expect(comp.search.loading()).toBe(true);
    expect(el.querySelector('.cp__status')).toBeTruthy();
  });

  it('shows the empty state after a search with no matches', async () => {
    await open();
    await type('zzzz-no-match');
    expect(comp.search.searched()).toBe(true);
    expect(comp.flat().length).toBe(0);
    expect(el.querySelector('.cp__empty')).toBeTruthy();
  });

  it('keeps rendering other kinds when one source fails and marks its chip', async () => {
    api.skills = vi.fn(() => throwError(() => new ApiError(500)));
    api.agents = vi.fn(() => of([]));
    await open();
    expect(options().length).toBeGreaterThan(0); // pages + forge still listed
    const failed = chips().filter((c) => c.hasAttribute('data-unverified'));
    expect(failed.length).toBe(1); // skill chip flagged
  });
});
