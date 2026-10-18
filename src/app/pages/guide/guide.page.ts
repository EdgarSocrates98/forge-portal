import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { UiIcon } from '../../shared/icon';

interface GuideSection {
  /** Anchor id — the same id used by `ui-guide-hint` across the app, so
   *  a contextual hint deep-links to its own section. */
  id: string;
  icon: string;
  titleKey: string;
  bodyKey: string;
  /** Real portal routes only — a section never links a page that does
   *  not exist in app.routes.ts. */
  links: { route: string; labelKey: string }[];
}

/**
 * Cycle 5 §8.1 — guided journey. A quiet reference page that explains
 * the ecosystem vocabulary (what a Forja/agent/skill/MCP is, how to
 * read graphs, diagnose problems, install components and interpret
 * evidence) and deep-links into the real pages. Explanatory copy only —
 * no live data is rendered or fabricated here.
 */
const SECTIONS: GuideSection[] = [
  {
    id: 'start',
    icon: 'dashboard',
    titleKey: 'guide.start.title',
    bodyKey: 'guide.start.body',
    links: [{ route: '/dashboard', labelKey: 'nav.dashboard' }],
  },
  {
    id: 'forge',
    icon: 'gem',
    titleKey: 'guide.forge.title',
    bodyKey: 'guide.forge.body',
    links: [
      { route: '/forges', labelKey: 'nav.forges' },
      { route: '/federation', labelKey: 'nav.federation' },
    ],
  },
  {
    id: 'agent',
    icon: 'agents',
    titleKey: 'guide.agent.title',
    bodyKey: 'guide.agent.body',
    links: [
      { route: '/agents', labelKey: 'nav.agents' },
      { route: '/match', labelKey: 'nav.match' },
    ],
  },
  {
    id: 'skill',
    icon: 'skills',
    titleKey: 'guide.skill.title',
    bodyKey: 'guide.skill.body',
    links: [{ route: '/skills', labelKey: 'nav.skills' }],
  },
  {
    id: 'mcp',
    icon: 'mcp',
    titleKey: 'guide.mcp.title',
    bodyKey: 'guide.mcp.body',
    links: [
      { route: '/mcp', labelKey: 'nav.mcp' },
      { route: '/hosts', labelKey: 'nav.hosts' },
    ],
  },
  {
    id: 'graph',
    icon: 'graph',
    titleKey: 'guide.graph.title',
    bodyKey: 'guide.graph.body',
    links: [
      { route: '/graph', labelKey: 'nav.graph' },
      { route: '/knowledge', labelKey: 'nav.knowledge' },
    ],
  },
  {
    id: 'install',
    icon: 'install',
    titleKey: 'guide.install.title',
    bodyKey: 'guide.install.body',
    links: [
      { route: '/install', labelKey: 'nav.install' },
      { route: '/profiles', labelKey: 'nav.profiles' },
    ],
  },
  {
    id: 'diagnose',
    icon: 'pulse',
    titleKey: 'guide.diagnose.title',
    bodyKey: 'guide.diagnose.body',
    links: [
      { route: '/tasks', labelKey: 'nav.tasks' },
      { route: '/observe', labelKey: 'nav.observe' },
    ],
  },
  {
    id: 'evidence',
    icon: 'execution',
    titleKey: 'guide.evidence.title',
    bodyKey: 'guide.evidence.body',
    links: [
      { route: '/execution', labelKey: 'nav.execution' },
      { route: '/tasks', labelKey: 'nav.tasks' },
    ],
  },
];

@Component({
  selector: 'page-guide',
  standalone: true,
  imports: [RouterLink, TPipe, PageHeader, UiIcon],
  template: `
    <ui-page-header [title]="'guide.title' | t" [subtitle]="'guide.subtitle' | t" />

    <p class="intro">{{ 'guide.intro' | t }}</p>

    <nav class="toc" [attr.aria-label]="'guide.toc' | t">
      @for (s of sections; track s.id) {
        <a class="toc__item" [routerLink]="'/guide'" [fragment]="s.id">
          <ui-icon [name]="s.icon" [size]="14" />
          {{ s.titleKey | t }}
        </a>
      }
    </nav>

    @for (s of sections; track s.id) {
      <section class="card gsec" [id]="s.id">
        <h2>
          <ui-icon [name]="s.icon" [size]="17" />
          {{ s.titleKey | t }}
        </h2>
        <p class="gsec__body">{{ s.bodyKey | t }}</p>
        <p class="gsec__links">
          @for (l of s.links; track l.route) {
            <a class="gsec__link" [routerLink]="l.route">
              {{ l.labelKey | t }}
              <ui-icon name="chevron-right" [size]="13" />
            </a>
          }
        </p>
      </section>
    }
  `,
  styles: `
    .intro {
      max-width: 70ch;
      color: var(--fg-muted);
      margin: 0 0 var(--space-4);
    }
    .toc {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-bottom: var(--space-5);
    }
    .toc__item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 24px;
      padding: 2px var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      background: var(--bg-elevated);
      color: var(--fg);
      font-size: var(--font-sm);
      font-weight: 550;
      text-decoration: none;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast);
    }
    .toc__item:hover {
      border-color: var(--accent-ink);
      background: var(--accent-bg);
      color: var(--accent-ink);
    }
    .gsec {
      margin-bottom: var(--space-4);
      max-width: 72ch;
      scroll-margin-top: calc(var(--topbar-h) + var(--space-3));
    }
    .gsec h2 {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-2);
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .gsec h2 ui-icon {
      color: var(--accent-ink);
    }
    .gsec__body {
      margin: 0;
      color: var(--fg-muted);
      line-height: 1.6;
    }
    .gsec__links {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      margin: var(--space-3) 0 0;
    }
    .gsec__link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      font-size: var(--font-sm);
      font-weight: 600;
      text-decoration: none;
    }
    .gsec__link:hover {
      color: var(--accent-ink);
    }
  `,
})
export class GuidePage {
  readonly sections = SECTIONS;
}
