import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { PortalStore } from './core/portal/portal.store';
import { PrefsStore } from './core/prefs/prefs.store';
import { I18nService } from './core/i18n/i18n.service';
import { TPipe } from './core/i18n/i18n.pipe';
import { ThemeStore } from './core/theme/theme.store';
import { UiIcon } from './shared/icon';
import { CommandPalette } from './shared/command-palette';
import { UiToastOutlet } from './shared/toast';
import { UiConfirmHost } from './shared/confirm-dialog';

interface NavEntry {
  key: string;
  label: string;
  items: { route: string; label: string; icon: string; capability?: string }[];
}

/** Journey-grouped nav — groups mirror real routes only (app.routes.ts);
 *  `capability` hides an item when the serving Forge declares it
 *  unsupported, never reorders the journey. */
const NAV: NavEntry[] = [
  {
    key: 'overview',
    label: 'nav.section.overview',
    items: [
      { route: '/dashboard', label: 'nav.dashboard', icon: 'dashboard' },
      { route: '/guide', label: 'nav.guide', icon: 'guide' },
      { route: '/federation', label: 'nav.federation', icon: 'network', capability: 'federation' },
    ],
  },
  {
    key: 'explore',
    label: 'nav.section.explore',
    items: [
      { route: '/forges', label: 'nav.forges', icon: 'gem', capability: 'federation' },
      { route: '/agents', label: 'nav.agents', icon: 'agents' },
      { route: '/skills', label: 'nav.skills', icon: 'skills' },
      { route: '/resources', label: 'nav.resources', icon: 'gem' },
      { route: '/mcp', label: 'nav.mcp', icon: 'mcp' },
      { route: '/knowledge', label: 'nav.knowledge', icon: 'knowledge' },
      { route: '/pf', label: 'nav.productForge', icon: 'gem' },
      { route: '/match', label: 'nav.match', icon: 'compass' },
    ],
  },
  {
    key: 'operate',
    label: 'nav.section.operate',
    items: [
      { route: '/tasks', label: 'nav.tasks', icon: 'tasks', capability: 'tasks' },
      { route: '/install', label: 'nav.install', icon: 'install' },
      { route: '/profiles', label: 'nav.profiles', icon: 'profiles' },
      { route: '/hosts', label: 'nav.hosts', icon: 'hosts' },
      { route: '/config', label: 'nav.config', icon: 'key' },
    ],
  },
  {
    key: 'analyze',
    label: 'nav.section.analyze',
    items: [
      { route: '/graph', label: 'nav.graph', icon: 'graph', capability: 'graph' },
      { route: '/observe', label: 'nav.observe', icon: 'pulse' },
      { route: '/execution', label: 'nav.execution', icon: 'execution' },
      { route: '/lab', label: 'nav.lab', icon: 'diff' },
      { route: '/versions', label: 'nav.versions', icon: 'history' },
    ],
  },
  {
    key: 'settings',
    label: 'nav.section.settings',
    items: [{ route: '/settings', label: 'nav.settings', icon: 'settings' }],
  },
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TPipe,
    UiIcon,
    CommandPalette,
    UiToastOutlet,
    UiConfirmHost,
  ],
  styleUrl: './app.css',
  host: {
    '(document:keydown)': 'onDocKeydown($event)',
  },
  template: `
    <a class="skip-link" href="#content">{{ 'nav.skip' | t }}</a>
    <div class="nav-progress" [attr.data-active]="navigating() || null" aria-hidden="true"></div>
    <div class="shell">
      <aside
        class="shell__side"
        [attr.data-collapsed]="collapsed() || null"
        [attr.data-mobile-open]="mobileNavOpen() || null"
        [attr.aria-label]="'nav.primary' | t"
      >
        <a class="brand" routerLink="/dashboard">
          <span class="brand__mark" aria-hidden="true"><ui-icon name="gem" [size]="18" /></span>
          <span class="brand__text">
            <strong>{{ store.forgeName() }}</strong>
            <small>{{ 'app.tagline' | t }}</small>
          </span>
        </a>

        <nav class="nav" id="shell-nav" [attr.aria-label]="'nav.primary' | t">
          @for (group of visibleNav(); track group.key) {
            <div class="nav__group" role="group" [attr.aria-labelledby]="'nav-h-' + group.key">
              <p class="nav__section" [id]="'nav-h-' + group.key">{{ group.label | t }}</p>
              @for (item of group.items; track item.route) {
                <a
                  class="nav__item"
                  [routerLink]="item.route"
                  routerLinkActive="nav__item--active"
                  ariaCurrentWhenActive="page"
                  [title]="item.label | t"
                  (click)="closeMobileNav()"
                >
                  <ui-icon class="nav__icon" [name]="item.icon" [size]="17" />
                  <span class="nav__label">{{ item.label | t }}</span>
                </a>
              }
            </div>
          }
        </nav>

        <button
          class="nav__collapse"
          (click)="toggleCollapsed()"
          [attr.aria-label]="(collapsed() ? 'nav.expand' : 'nav.collapse') | t"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="shell-nav"
          [title]="'nav.shortcut.collapse' | t"
        >
          <ui-icon [name]="collapsed() ? 'chevron-right' : 'chevron-left'" [size]="14" />
        </button>
      </aside>

      @if (mobileNavOpen()) {
        <button
          class="nav-scrim"
          type="button"
          (click)="closeMobileNav()"
          [attr.aria-label]="'nav.close' | t"
        ></button>
      }

      <div class="shell__main">
        <header class="topbar">
          <button
            class="nav-mobile-toggle"
            type="button"
            (click)="toggleMobileNav()"
            [attr.aria-expanded]="mobileNavOpen()"
            aria-controls="shell-nav"
            [attr.aria-label]="(mobileNavOpen() ? 'nav.close' : 'nav.open') | t"
            [title]="(mobileNavOpen() ? 'nav.close' : 'nav.open') | t"
          >
            <ui-icon [name]="mobileNavOpen() ? 'close' : 'menu'" [size]="17" />
          </button>
          <div class="topbar__status">
            <span
              class="dot"
              [attr.data-state]="store.status()"
              [title]="store.status()"
              aria-hidden="true"
            ></span>
            <span
              class="topbar__workspace"
              [attr.title]="store.workspace()?.root ?? ('dashboard.noWorkspace' | t)"
            >
              <ui-icon name="folder" [size]="14" />
              @if (store.workspace()?.name; as workspaceName) {
                {{ workspaceName }}
              } @else {
                <span class="topbar__workspace-full">{{ 'dashboard.noWorkspace' | t }}</span>
                <span class="topbar__workspace-short" aria-hidden="true">
                  {{ 'dashboard.noWorkspaceShort' | t }}
                </span>
              }
            </span>
            <span class="topbar__route" aria-live="polite">
              <span class="topbar__route-sep" aria-hidden="true">/</span>
              <span class="topbar__route-section">{{ currentSection() }}</span>
              <span class="topbar__route-sep" aria-hidden="true">/</span>
              <strong>{{ currentPage() }}</strong>
            </span>
            @if (store.federated()) {
              <span class="topbar__fed">{{ 'settings.federated' | t }}</span>
            }
          </div>
          <div class="topbar__actions">
            <!-- WCAG 2.5.3 (label in name): the visible text must appear in
                 the accessible name — the Ctrl K hint and the PT/EN label are
                 rendered text even though they are aria-hidden from AT. -->
            <button
              class="icon-btn icon-btn--search"
              (click)="palette.toggle()"
              [attr.aria-label]="('command.open' | t) + ' — Ctrl K'"
              [title]="('command.open' | t) + ' — Ctrl K'"
            >
              <ui-icon name="search" [size]="15" />
              <kbd class="icon-btn__kbd" aria-hidden="true">Ctrl K</kbd>
            </button>
            <button
              class="icon-btn"
              (click)="toggleLocale()"
              [attr.aria-label]="
                (i18n.locale() === 'pt-BR' ? 'PT' : 'EN') + ' — ' + ('settings.language' | t)
              "
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
          @if (store.status() === 'offline' || store.status() === 'error') {
            <div class="offline-banner" role="alert">
              <p>{{ bannerMessageKey() | t }}</p>
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
    <ui-toast-outlet />
    <ui-confirm-host />
  `,
})
export class App {
  readonly store = inject(PortalStore);
  readonly i18n = inject(I18nService);
  private readonly theme = inject(ThemeStore);
  private readonly prefs = inject(PrefsStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Sidebar collapse persists via PrefsStore — the last layout the user
   *  chose is the layout they return to (§8.2/§8.3). */
  readonly collapsed = signal(this.prefs.navCollapsed());
  readonly nav = NAV;

  /** First navigation keeps default focus (skip-link still leads); every
   *  later navigation moves focus into <main> so keyboard/AT users land
   *  on the new page's content instead of staying on the old focus. */
  private navigated = false;
  readonly mobileNavOpen = signal(false);
  readonly currentRoute = signal('/dashboard');
  /** Route-level progress: instant feedback on nav click — the bar
   *  animates while the router resolves, so even a cached page feels
   *  responsive before `withViewTransitions` takes over. */
  readonly navigating = signal(false);

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

  private readonly activeNavItem = computed(() => {
    const path = this.currentRoute().split('?')[0].replace(/\/$/, '') || '/';
    return (
      this.nav
        .flatMap((section) => section.items.map((item) => ({ item, section })))
        .filter(
          ({ item }) =>
            path === item.route || (item.route !== '/' && path.startsWith(`${item.route}/`)),
        )
        .sort((a, b) => b.item.route.length - a.item.route.length)[0] ?? null
    );
  });

  readonly currentPage = computed(() => {
    this.i18n.locale();
    const item = this.activeNavItem();
    return item ? this.i18n.t(item.item.label) : this.i18n.t('nav.dashboard');
  });

  readonly currentSection = computed(() => {
    this.i18n.locale();
    const item = this.activeNavItem();
    return item ? this.i18n.t(item.section.label) : this.i18n.t('nav.section.overview');
  });

  readonly schemeIcon = computed(() => {
    const scheme = this.theme.scheme();
    return scheme === 'dark' ? 'moon' : scheme === 'light' ? 'sun' : 'contrast';
  });

  /** Chave i18n do banner: a `message_key` real do servidor quando
   *  presente (ex.: `error.session`), senão `error.unreachable`. */
  readonly bannerMessageKey = computed(
    () => this.store.lastError?.()?.body.message_key ?? 'error.unreachable',
  );

  constructor() {
    void this.store.bootstrap();
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.navigating.set(true);
        return;
      }
      if (e instanceof NavigationEnd || e instanceof NavigationCancel || e instanceof NavigationError) {
        this.navigating.set(false);
      }
      if (!(e instanceof NavigationEnd)) return;
      this.currentRoute.set(e.urlAfterRedirects);
      this.closeMobileNav();
      // last visited internal URL → "voltar à última área" on the
      // dashboard (§8.3). Internal-only guard lives in PrefsStore.
      this.prefs.recordRoute(e.urlAfterRedirects);
      if (!this.navigated) {
        this.navigated = true;
        return;
      }
      const main = document.getElementById('content');
      if (main) {
        main.focus();
        main.scrollTop = 0;
      }
    });
  }

  toggleLocale(): void {
    void this.i18n.applyPreference(this.i18n.locale() === 'pt-BR' ? 'en' : 'pt-BR');
  }

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    this.prefs.setNavCollapsed(next);
  }

  toggleMobileNav(): void {
    this.mobileNavOpen.update((open) => !open);
  }

  closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }

  /** `[` toggles the sidebar — ignored while typing or with modifiers. */
  protected onDocKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.mobileNavOpen()) {
      this.closeMobileNav();
      return;
    }
    if (event.key !== '[' || event.ctrlKey || event.metaKey || event.altKey) return;
    const el = event.target as HTMLElement | null;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
    this.toggleCollapsed();
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
