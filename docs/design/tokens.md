# Design tokens — Forge Portal (Cycle 1)

Single source of truth: `src/styles/tokens.css` (loaded before
`src/styles.css` via `angular.json`). Components consume **semantic
aliases** (`--space-*`, `--bg`, `--accent`, `--ok`…) — never raw palette
values and, for new code, preferably aliases over `--fg-*` primitives.

## Layers

```
primitives  --fg-*          scale values + neutral/state ramps
scheme      [data-scheme]   light = :root default · dark override
accents     [data-forge]    one --fg-accent* set per Forja
aliases     --space-*, --bg, --accent, --ok …   component-facing names
```

`data-scheme` and `data-forge` are set on `<html>` by
`ThemeStore` (`src/app/core/theme/theme.store.ts`). Scheme preference
persists in `localStorage['forge-portal.scheme']`; **dark is the
primary/default** scheme, `system` resolves via
`prefers-color-scheme` and re-resolves live on OS change.

## Color

| Token (alias)     | Primitive            | Light     | Dark      |
| ----------------- | -------------------- | --------- | --------- |
| `--bg`            | `--fg-bg`            | `#f4f5f7` | `#0d1014` |
| `--bg-elevated`   | `--fg-surface`       | `#ffffff` | `#161b22` |
| `--bg-hover`      | `--fg-surface-2`     | `#eef0f3` | `#1d232c` |
| `--border`        | `--fg-border`        | `#d9dde3` | `#2b333d` |
| `--border-strong` | `--fg-border-strong` | `#b9c0ca` | `#3d4754` |
| `--fg`            | `--fg-text`          | `#16191d` | `#e6e9ee` |
| `--fg-muted`      | `--fg-text-2`        | `#4b5563` | `#a9b3bf` |
| `--fg-dim`        | `--fg-text-dim`      | `#646c78` | `#7d8894` |
| `--scrim`         | `--fg-scrim`         | 45% black | —         |
| `--fg-focus`      | —                    | `#2563eb` | `#6ea8fe` |

`--fg-bg-raised` exists as a second raised surface for layered chrome.

### States

Every state ships a foreground + background pair (`*-bg`).

| State      | Alias                              | Usage                                                |
| ---------- | ---------------------------------- | ---------------------------------------------------- |
| ok         | `--ok` / `--ok-bg`                 | verified, supported, success                         |
| warn       | `--warn` / `--warn-bg`             | degraded, blocked                                    |
| error      | `--error` / `--error-bg`           | failed, unreachable, destructive                     |
| info       | `--info` / `--info-bg`             | running, links, neutral notice                       |
| unverified | `--unverified` / `--unverified-bg` | not yet observed — neutral slate, distinct from warn |

`--on-color` is the text color painted on saturated fills (badge dots,
danger button, stepper marks).

### Accent (per Forja)

`--accent`, `--accent-strong`, `--accent-bg`, `--accent-fg`,
`--gradient` — switched by `data-forge` for the seven Forjas; unknown
ids fall back to `the-forge` in `ThemeStore.normalizeForge`.

## Typography

| Token                    | Value      |
| ------------------------ | ---------- |
| `--font-xs`              | 0.75rem    |
| `--font-sm`              | 0.8125rem  |
| `--font-md`              | 0.9375rem  |
| `--font-lg`              | 1.125rem   |
| `--font-xl`              | 1.25rem    |
| `--font-2xl`             | 1.375rem   |
| `--font-weight-regular`  | 400        |
| `--font-weight-medium`   | 500        |
| `--font-weight-semibold` | 650        |
| `--font-weight-bold`     | 700        |
| `--font-mono`            | mono stack |

Families: `--fg-font` (UI), `--fg-font-mono` (code). Line heights:
`--fg-leading-tight` 1.25, `--fg-leading-base` 1.5.

## Spacing, radii, layout

4px base scale: `--space-1` 0.25rem → `--space-8` 3rem
(`--fg-space-1…7`). Radii: `--radius-sm/md/lg` + `--radius-pill`.
Layout: `--fg-topbar-h`, `--fg-sidebar-w`, `--fg-sidebar-w-collapsed`
(the shell sidebar consumes `--sidebar-w`, which defaults to the token).

## Elevation

`--elev-card` (resting), `--elev-hover` (lift), `--elev-pop`
(overlays/dialogs). Dark scheme deepens the same three steps.

## Motion

`--motion` (220ms standard), `--motion-fast` (120ms micro),
`--press` (140ms strong-out), easings `--fg-motion-ease`,
`--ease-out`, `--ease-in-out`.

## Focus

`--fg-focus-width` (2px, 3px under `prefers-contrast: more`),
`--fg-focus-offset`, `--fg-focus` (color), `--fg-focus-ring` /
`--focus-ring` (halo box-shadow used by inputs and option cards).
The global `:focus-visible` rule reads the width/offset tokens.

## Z-index

`--z-base` 0 · `--z-sticky` 10 · `--z-overlay` 90 · `--z-dialog` 100 ·
`--z-toast` 120. Floating UI must use these names — no magic numbers.

## Media preferences

- `prefers-color-scheme` — honored when `ThemeStore.scheme === 'system'`.
- `prefers-contrast: more` — stronger borders, dim text lifted toward
  `--fg-text`, focus ring widened to 3px (both schemes).
- `prefers-reduced-motion: reduce` — all `--fg-motion-*` durations
  collapse to `0ms` (token-driven) **plus** a global rule in
  `styles.css` that stops animations/transitions not on the token path
  (skeleton shimmer, page-enter, dot pulse are also disabled).

## Shell navigation (Cycle 1)

Sidebar groups follow the user journey and mirror real routes only:

| Group    | Items                                                  |
| -------- | ------------------------------------------------------ |
| Overview | Dashboard, Forge family                                |
| Explore  | Forges, Agents, Skills, MCP, Knowledge, Match          |
| Operate  | Tasks, Installation, Profiles, AI hosts, Configuration |
| Analyze  | Graph Studio, Observability, Lab, Versions             |
| Settings | Settings                                               |

Items gated by a `capability` flag hide only when the serving Forja
declares that capability unsupported; empty groups are dropped.
`[` toggles the sidebar from the keyboard (ignored while typing);
groups render as `role="group"` + `aria-labelledby`.

## Known limitations

- Contrast was chosen by palette convention, not measured with an
  automated contrast tool — a measured WCAG audit is still open.
- `unverified` is new in Cycle 1: `ui-state-badge` maps `unverified` /
  `UNVERIFIED` to the dedicated slate tone; it used to render as warn.
- Cytoscape node colors (`core/graph/view-model.ts`) are a graph-viz
  palette, intentionally outside the UI token set.
