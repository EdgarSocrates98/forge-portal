import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TPipe } from '../core/i18n/i18n.pipe';
import {
  SEARCH_KIND_LABEL,
  SEARCH_KIND_ORDER,
  SearchKind,
  SearchResult,
  SearchService,
} from '../core/search/search.service';
import { UiIcon } from './icon';

type ChipKind = SearchKind | 'all';

interface Chip {
  kind: ChipKind;
  labelKey: string;
  unverified: boolean;
}

/**
 * Global search palette (Ctrl/Cmd+K) — spec §3.6 front-end for
 * `SearchService`. Zero-animation philosophy kept: opens and executes
 * instantly, no motion anywhere.
 *
 * Keyboard contract (documented choice):
 *  - `↑`/`↓` cycle the flat result list (wraps), `↵` runs the active item,
 *    `Esc` closes — from the input or any chip.
 *  - Kind filter chips form a `radiogroup` with a roving tabindex:
 *    `←`/`→` on the chip row moves AND activates the previous/next filter,
 *    `↑`/`↓` returns focus to the input. `Tab` is left untouched so it can
 *    always move focus out of the widget.
 *  - Results are grouped by kind under `presentation` headers; the list
 *    stays a single `listbox` so `aria-selected`/arrow semantics are
 *    unchanged from the previous palette.
 */
@Component({
  selector: 'ui-command-palette',
  standalone: true,
  imports: [TPipe, UiIcon],
  host: {
    '(document:keydown.control.k)': 'toggle($event)',
    '(document:keydown.meta.k)': 'toggle($event)',
  },
  template: `
    @if (open()) {
      <div class="cp" (click)="close()">
        <div
          class="cp__panel"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="'command.open' | t"
          (click)="$event.stopPropagation()"
        >
          <input
            #inp
            class="cp__input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-list"
            [attr.aria-activedescendant]="activeDesc()"
            [value]="query()"
            (input)="onQuery($event)"
            (keydown)="onKey($event)"
            [placeholder]="'command.hint' | t"
            [attr.aria-label]="'command.open' | t"
          />
          <div class="cp__filters" role="radiogroup" [attr.aria-label]="'command.filters' | t">
            @for (chip of chips(); track chip.kind; let ci = $index) {
              <button
                type="button"
                class="cp__chip"
                role="radio"
                [attr.aria-checked]="filter() === chip.kind"
                [attr.data-active]="filter() === chip.kind || null"
                [attr.data-unverified]="chip.unverified || null"
                [attr.title]="chip.unverified ? ('command.unverified' | t) : null"
                [tabindex]="filter() === chip.kind ? 0 : -1"
                (click)="setFilter(chip.kind)"
                (keydown)="onChipKey($event, ci)"
              >
                {{ chip.labelKey | t }}
                @if (chip.unverified) {
                  <ui-icon name="alert" [size]="11" />
                }
              </button>
            }
          </div>
          <ul
            #list
            id="cp-list"
            class="cp__list"
            role="listbox"
            [attr.aria-busy]="search.loading() || null"
          >
            @if (search.loading()) {
              <li class="cp__status" role="presentation">{{ 'command.searching' | t }}</li>
            }
            @for (item of flat(); track item.id; let i = $index) {
              @if (i === 0 || flat()[i - 1].kind !== item.kind) {
                <li class="cp__group" role="presentation">{{ labels[item.kind] | t }}</li>
              }
              <li
                class="cp__item"
                role="option"
                [id]="'cp-opt-' + i"
                [attr.aria-selected]="i === idx()"
                [attr.data-active]="i === idx() || null"
                (click)="run(item)"
                (mousemove)="active.set(i)"
              >
                <ui-icon [name]="item.icon" [size]="15" />
                <span class="cp__label">{{ item.label }}</span>
                @if (item.sublabel) {
                  <span class="cp__sub">{{ item.sublabel }}</span>
                }
              </li>
            }
            @if (!search.loading() && search.searched() && flat().length === 0) {
              <li class="cp__empty" role="presentation">{{ 'command.empty' | t }}</li>
            }
          </ul>
          <div class="cp__footer">{{ 'command.footer' | t }}</div>
        </div>
      </div>
    }
  `,
  styles: `
    .cp {
      position: fixed;
      inset: 0;
      z-index: 90;
      background: rgb(0 0 0 / 0.45);
      display: grid;
      place-items: start center;
      padding-top: 14vh;
    }
    .cp__panel {
      width: min(560px, calc(100vw - var(--space-6)));
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-lg);
      box-shadow: var(--elev-pop);
      overflow: hidden;
    }
    .cp__input {
      width: 100%;
      border: 0;
      border-bottom: 1px solid var(--border);
      background: transparent;
      color: var(--fg);
      padding: var(--space-3) var(--space-4);
      font: inherit;
      font-size: var(--font-lg);
      outline: none;
    }
    .cp__filters {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
      padding: var(--space-2) var(--space-3);
      border-bottom: 1px solid var(--border);
    }
    .cp__chip {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--fg-muted);
      padding: 1px var(--space-2);
      font: inherit;
      font-size: var(--font-xs);
      cursor: pointer;
    }
    .cp__chip[data-active] {
      background: var(--accent-bg);
      border-color: color-mix(in srgb, var(--accent) 40%, transparent);
      color: var(--accent-strong);
    }
    .cp__chip[data-unverified] ui-icon {
      color: var(--warning, var(--accent));
    }
    .cp__list {
      list-style: none;
      margin: 0;
      padding: var(--space-2);
      max-height: 320px;
      overflow-y: auto;
    }
    .cp__group {
      padding: var(--space-2) var(--space-3) var(--space-1);
      color: var(--fg-muted);
      font-size: var(--font-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      cursor: default;
    }
    .cp__item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      color: var(--fg);
      cursor: pointer;
      font-size: var(--font-sm);
    }
    .cp__item ui-icon {
      color: var(--fg-muted);
      flex: none;
    }
    .cp__item[data-active] {
      background: var(--accent-bg);
      color: var(--accent-strong);
    }
    .cp__item[data-active] ui-icon {
      color: var(--accent-strong);
    }
    .cp__label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cp__sub {
      margin-left: auto;
      flex: none;
      max-width: 45%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .cp__status,
    .cp__empty {
      padding: var(--space-2) var(--space-3);
      color: var(--fg-muted);
      font-size: var(--font-sm);
      cursor: default;
    }
    .cp__footer {
      border-top: 1px solid var(--border);
      padding: var(--space-2) var(--space-4);
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
  `,
})
export class CommandPalette {
  private readonly router = inject(Router);
  readonly search = inject(SearchService);

  readonly open = signal(false);
  readonly query = signal('');
  readonly active = signal(0);
  readonly filter = signal<ChipKind>('all');
  readonly labels = SEARCH_KIND_LABEL;

  private readonly input = viewChild<ElementRef<HTMLInputElement>>('inp');
  private readonly list = viewChild<ElementRef<HTMLUListElement>>('list');

  /** Visible results — kind-filtered, preserving the service's rank order. */
  readonly flat = computed<SearchResult[]>(() => {
    const f = this.filter();
    const all = this.search.results();
    return f === 'all' ? all : all.filter((r) => r.kind === f);
  });

  /** Active row clamped to the visible list — never out of bounds. */
  readonly idx = computed(() => {
    const n = this.flat().length;
    return n ? Math.min(this.active(), n - 1) : 0;
  });

  readonly activeDesc = computed(() => (this.flat().length ? `cp-opt-${this.idx()}` : null));

  /** "All" plus one chip per kind present in the results (or unverified),
   *  in `SEARCH_KIND_ORDER`. The active filter's chip is always kept. */
  readonly chips = computed<Chip[]>(() => {
    const present = new Set(this.search.results().map((r) => r.kind));
    const failed = new Set(this.search.unverified());
    const out: Chip[] = [{ kind: 'all', labelKey: 'state.all', unverified: false }];
    for (const k of SEARCH_KIND_ORDER) {
      if (present.has(k) || failed.has(k) || this.filter() === k) {
        out.push({ kind: k, labelKey: SEARCH_KIND_LABEL[k], unverified: failed.has(k) });
      }
    }
    return out;
  });

  toggle(e?: Event): void {
    e?.preventDefault();
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.query.set('');
      this.filter.set('all');
      this.active.set(0);
      this.search.setQuery('');
      setTimeout(() => this.input()?.nativeElement.focus());
    }
  }

  close(): void {
    this.open.set(false);
  }

  onQuery(e: Event): void {
    const q = (e.target as HTMLInputElement).value;
    this.query.set(q);
    this.active.set(0);
    this.search.setQuery(q);
  }

  onKey(e: KeyboardEvent): void {
    const n = this.flat().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active.set(n ? (this.idx() + 1) % n : 0);
      this.scrollActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.set(n ? (this.idx() - 1 + n) % n : 0);
      this.scrollActive();
    } else if (e.key === 'Enter') {
      const item = this.flat()[this.idx()];
      if (item) this.run(item);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  /** `←`/`→` on the chip row cycles the kind filter (roving radiogroup);
   *  `↑`/`↓` hands focus back to the input; `Esc` closes. */
  onChipKey(e: KeyboardEvent, i: number): void {
    const chips = this.chips();
    const n = chips.length;
    if (!n) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const j = e.key === 'ArrowRight' ? (i + 1) % n : (i - 1 + n) % n;
      const chip = chips[j];
      if (!chip) return;
      this.filter.set(chip.kind);
      this.active.set(0);
      const row = (e.currentTarget as HTMLElement).parentElement;
      (row?.children[j] as HTMLElement | undefined)?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.input()?.nativeElement.focus();
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  setFilter(kind: ChipKind): void {
    this.filter.set(kind);
    this.active.set(0);
    this.input()?.nativeElement.focus();
  }

  run(item: SearchResult): void {
    this.close();
    if (item.run) item.run();
    else if (item.route) void this.router.navigateByUrl(item.route);
    else if (item.url) window.open(item.url, '_blank', 'noopener');
  }

  /** Keeps the active row inside the max-h scroll viewport — instant,
   *  `block: 'nearest'`, no smooth behavior (zero-animation rule). */
  private scrollActive(): void {
    setTimeout(() => {
      const el = this.list()?.nativeElement.querySelector('[data-active]');
      (el as HTMLElement | undefined)?.scrollIntoView?.({ block: 'nearest' });
    });
  }
}
