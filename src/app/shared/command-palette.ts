import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../core/i18n/i18n.service';
import { TPipe } from '../core/i18n/i18n.pipe';
import { PortalStore } from '../core/portal/portal.store';
import { ThemeStore } from '../core/theme/theme.store';
import { UiIcon } from './icon';

interface CmdItem {
  id: string;
  icon: string;
  label: string;
  run: () => void;
}

/**
 * Command palette (Ctrl/Cmd+K) — frequência altíssima, então zero
 * animação: abre e executa instantaneamente (framework de motion).
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
            [value]="query()"
            (input)="onQuery($event)"
            (keydown)="onKey($event)"
            [placeholder]="'command.hint' | t"
            [attr.aria-label]="'command.open' | t"
          />
          <ul class="cp__list" role="listbox">
            @for (item of filtered(); track item.id; let i = $index) {
              <li
                role="option"
                [attr.aria-selected]="i === active()"
                [attr.data-active]="i === active() || null"
                (click)="run(item)"
                (mousemove)="active.set(i)"
              >
                <ui-icon [name]="item.icon" [size]="15" />
                <span>{{ item.label | t }}</span>
              </li>
            } @empty {
              <li class="cp__empty">{{ 'command.empty' | t }}</li>
            }
          </ul>
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
    .cp__list {
      list-style: none;
      margin: 0;
      padding: var(--space-2);
      max-height: 320px;
      overflow-y: auto;
    }
    .cp__list li {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-md);
      color: var(--fg);
      cursor: pointer;
      font-size: var(--font-sm);
    }
    .cp__list li ui-icon {
      color: var(--fg-muted);
      flex: none;
    }
    .cp__list li[data-active] {
      background: var(--accent-bg);
      color: var(--accent-strong);
    }
    .cp__list li[data-active] ui-icon {
      color: var(--accent-strong);
    }
    .cp__empty {
      color: var(--fg-muted);
      cursor: default;
    }
  `,
})
export class CommandPalette {
  private readonly router = inject(Router);
  private readonly store = inject(PortalStore);
  private readonly theme = inject(ThemeStore);
  private readonly i18n = inject(I18nService);

  readonly open = signal(false);
  readonly query = signal('');
  readonly active = signal(0);
  private readonly input = viewChild<ElementRef<HTMLInputElement>>('inp');

  readonly items = computed<CmdItem[]>(() => {
    const pages: CmdItem[] = [
      {
        id: 'p:dashboard',
        icon: 'dashboard',
        label: 'nav.dashboard',
        run: () => this.go('/dashboard'),
      },
      { id: 'p:install', icon: 'install', label: 'nav.install', run: () => this.go('/install') },
      {
        id: 'p:profiles',
        icon: 'profiles',
        label: 'nav.profiles',
        run: () => this.go('/profiles'),
      },
      { id: 'p:hosts', icon: 'hosts', label: 'nav.hosts', run: () => this.go('/hosts') },
      { id: 'p:mcp', icon: 'mcp', label: 'nav.mcp', run: () => this.go('/mcp') },
      { id: 'p:skills', icon: 'skills', label: 'nav.skills', run: () => this.go('/skills') },
      { id: 'p:agents', icon: 'agents', label: 'nav.agents', run: () => this.go('/agents') },
      { id: 'p:tasks', icon: 'tasks', label: 'nav.tasks', run: () => this.go('/tasks') },
      { id: 'p:graph', icon: 'graph', label: 'nav.graph', run: () => this.go('/graph') },
      {
        id: 'p:knowledge',
        icon: 'knowledge',
        label: 'nav.knowledge',
        run: () => this.go('/knowledge'),
      },
      {
        id: 'p:settings',
        icon: 'settings',
        label: 'nav.settings',
        run: () => this.go('/settings'),
      },
    ];
    const caps = this.store.capabilities();
    const hidden = new Set(
      caps.length
        ? ['tasks', 'graph'].filter(
            (id) => !caps.some((c) => c.id === id && c.state !== 'unsupported'),
          )
        : [],
    );
    return [
      ...pages.filter((p) => !hidden.has(p.id.slice(2))),
      { id: 'a:refresh', icon: 'refresh', label: 'state.refresh', run: () => this.refresh() },
      { id: 'a:theme', icon: 'contrast', label: 'settings.theme', run: () => this.cycleTheme() },
      { id: 'a:locale', icon: 'globe', label: 'settings.language', run: () => this.toggleLocale() },
    ];
  });

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.items();
    return this.items().filter((i) => this.i18n.t(i.label).toLowerCase().includes(q));
  });

  toggle(e?: Event): void {
    e?.preventDefault();
    this.open.set(!this.open());
    if (this.open()) {
      this.query.set('');
      this.active.set(0);
      setTimeout(() => this.input()?.nativeElement.focus());
    }
  }

  close(): void {
    this.open.set(false);
  }

  onQuery(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
    this.active.set(0);
  }

  onKey(e: KeyboardEvent): void {
    const n = this.filtered().length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active.set(n ? (this.active() + 1) % n : 0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active.set(n ? (this.active() - 1 + n) % n : 0);
    } else if (e.key === 'Enter') {
      const item = this.filtered()[this.active()];
      if (item) this.run(item);
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  run(item: CmdItem): void {
    this.close();
    item.run();
  }

  private go(route: string): void {
    void this.router.navigateByUrl(route);
  }

  private refresh(): void {
    void this.store.refreshHealth();
  }

  private cycleTheme(): void {
    const next =
      this.theme.scheme() === 'system'
        ? 'light'
        : this.theme.scheme() === 'light'
          ? 'dark'
          : 'system';
    this.theme.setScheme(next);
  }

  private toggleLocale(): void {
    void this.i18n.applyPreference(this.i18n.locale() === 'pt-BR' ? 'en' : 'pt-BR');
  }
}
