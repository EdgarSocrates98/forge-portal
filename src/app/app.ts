import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PortalStore } from './core/portal/portal.store';
import { I18nService } from './core/i18n/i18n.service';
import { TPipe } from './core/i18n/i18n.pipe';
import { ThemeStore } from './core/theme/theme.store';
import { UiIcon } from './shared/icon';
import { CommandPalette } from './shared/command-palette';

interface NavEntry {
  section: string;
  items: { route: string; label: string; icon: string; capability?: string }[];
}

const NAV: NavEntry[] = [
  {
    section: 'nav.section.operate',
    items: [
      { route: '/dashboard', label: 'nav.dashboard', icon: 'dashboard' },
      { route: '/tasks', label: 'nav.tasks', icon: 'tasks', capability: 'tasks' },
      { route: '/graph', label: 'nav.graph', icon: 'graph', capability: 'graph' },
    ],
  },
  {
    section: 'nav.section.configure',
    items: [
      { route: '/install', label: 'nav.install', icon: 'install' },
      { route: '/profiles', label: 'nav.profiles', icon: 'profiles' },
      { route: '/hosts', label: 'nav.hosts', icon: 'hosts' },
      { route: '/mcp', label: 'nav.mcp', icon: 'mcp' },
    ],
  },
  {
    section: 'nav.section.explore',
    items: [
      { route: '/skills', label: 'nav.skills', icon: 'skills' },
      { route: '/agents', label: 'nav.agents', icon: 'agents' },
      { route: '/knowledge', label: 'nav.knowledge', icon: 'knowledge' },
      { route: '/settings', label: 'nav.settings', icon: 'settings' },
    ],
  },
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TPipe, UiIcon, CommandPalette],
  styleUrl: './app.css',
  template: `
    <a class="skip-link" href="#content">{{ 'nav.skip' | t }}</a>
    <div class="shell">
      <aside class="shell__side" [attr.data-collapsed]="collapsed() || null">
        <a class="brand" routerLink="/dashboard">
          <span class="brand__mark" aria-hidden="true"><ui-icon name="gem" [size]="18" /></span>
          <span class="brand__text">
            <strong>{{ store.forgeName() }}</strong>
            <small>{{ 'app.tagline' | t }}</small>
          </span>
        </a>

        <nav class="nav" aria-label="portal">
          @for (section of visibleNav(); track section.section) {
            <p class="nav__section">{{ section.section | t }}</p>
            @for (item of section.items; track item.route) {
              <a class="nav__item" [routerLink]="item.route" routerLinkActive="nav__item--active">
                <ui-icon class="nav__icon" [name]="item.icon" [size]="17" />
                <span class="nav__label">{{ item.label | t }}</span>
              </a>
            }
          }
        </nav>

        <button
          class="nav__collapse"
          (click)="collapsed.set(!collapsed())"
          [attr.aria-label]="(collapsed() ? 'nav.expand' : 'nav.collapse') | t"
        >
          <ui-icon [name]="collapsed() ? 'chevron-right' : 'chevron-left'" [size]="14" />
        </button>
      </aside>

      <div class="shell__main">
        <header class="topbar">
          <div class="topbar__status">
            <span
              class="dot"
              [attr.data-state]="store.status()"
              [title]="store.status()"
              aria-hidden="true"
            ></span>
            <span class="topbar__workspace">
              <ui-icon name="folder" [size]="14" />
              {{ store.workspace()?.name ?? ('dashboard.noWorkspace' | t) }}
            </span>
            @if (store.federated()) {
              <span class="topbar__fed">{{ 'settings.federated' | t }}</span>
            }
          </div>
          <div class="topbar__actions">
            <button
              class="icon-btn icon-btn--search"
              (click)="palette.toggle()"
              [attr.aria-label]="'command.open' | t"
              [title]="'command.open' | t"
            >
              <ui-icon name="search" [size]="15" />
              <kbd class="icon-btn__kbd" aria-hidden="true">Ctrl K</kbd>
            </button>
            <button
              class="icon-btn"
              (click)="toggleLocale()"
              [attr.aria-label]="'settings.language' | t"
              [title]="'settings.language' | t"
            >
              {{ i18n.locale() === 'pt-BR' ? 'PT' : 'EN' }}
            </button>
            <button
              class="icon-btn"
              (click)="cycleScheme()"
              [attr.aria-label]="'settings.theme' | t"
              [title]="'settings.theme' | t"
            >
              <ui-icon [name]="schemeIcon()" [size]="15" />
            </button>
          </div>
        </header>

        <main class="content" id="content" tabindex="-1">
          @if (store.status() === 'offline') {
            <div class="offline-banner" role="alert">
              <p>{{ 'error.unreachable' | t }}</p>
              <button class="btn" (click)="store.bootstrap()">
                {{ 'error.retry' | t }}
              </button>
            </div>
          }
          <router-outlet />
        </main>
      </div>
    </div>
    <ui-command-palette #palette />
  `,
})
export class App {
  readonly store = inject(PortalStore);
  readonly i18n = inject(I18nService);
  private readonly theme = inject(ThemeStore);

  readonly collapsed = signal(false);
  readonly nav = NAV;

  readonly visibleNav = computed(() =>
    this.nav
      .map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            !item.capability ||
            this.store.capabilities().length === 0 ||
            this.store
              .capabilities()
              .some((c) => c.id === item.capability && c.state !== 'unsupported'),
        ),
      }))
      .filter((section) => section.items.length > 0),
  );

  readonly schemeIcon = computed(() => {
    const scheme = this.theme.scheme();
    return scheme === 'dark' ? 'moon' : scheme === 'light' ? 'sun' : 'contrast';
  });

  constructor() {
    void this.store.bootstrap();
  }

  toggleLocale(): void {
    void this.i18n.applyPreference(this.i18n.locale() === 'pt-BR' ? 'en' : 'pt-BR');
  }

  cycleScheme(): void {
    const next =
      this.theme.scheme() === 'system'
        ? 'light'
        : this.theme.scheme() === 'light'
          ? 'dark'
          : 'system';
    this.theme.setScheme(next);
  }
}
