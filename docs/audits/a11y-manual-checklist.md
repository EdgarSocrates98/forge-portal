# Accessibility — manual verification checklist (NVDA / VoiceOver)

Companion to the automated gates. `test_axe_core_audit` (e2e,
axe-core 4.14.0 injected into real Chromium) now runs every main route
and fails on serious/critical violations — see
`e2e/artifacts/axe-report.json` for the latest machine-readable state.
axe proved the DOM contract; the items below need a human with a real
screen reader + browser — they cannot be asserted in CI.

## What the automated pass already covers

- Accessible names on icon buttons, form labels on inputs (axe
  `button-name`, `label`, `label-content-name-mismatch`).
- AA text contrast in dark + light schemes (`color-contrast`), including
  `.fed__node`, `ui-state-badge`, and dimmed host cards — these were real
  bugs fixed in this branch (see PR description).
- Landmark uniqueness (`landmark-unique`), headings (`empty-heading`),
  `skip-link`, `aria-live` regions, reduced-motion CSS.

## Remaining manual steps

### NVDA (Windows) — browse + focus modes

- [ ] Sidebar nav announces as a named complementary region; group
      headings read before their links.
- [ ] Skip link jumps to `<main>`; after SPA route changes focus lands
      in the new page's content (the app focuses `#content` on
      `NavigationEnd` — verify announcement).
- [ ] Command palette: `Ctrl K` opens, arrows move through the flat
      result list, `Enter` navigates, `Esc` restores focus to the trigger.
- [ ] Graph Studio: the node list (`.fed__node`) is a real button list —
      select a node, confirm the inspector announces name/kind/id.
      Canvas mode must be verified for parity via the shared selection
      (list ↔ canvas share one state; canvas itself is not screen-reader
      navigable by design — the list IS the AT path).
- [ ] Tasks replay: stepping events announces status + timestamp; the
      `unplaced`/`partial` timeline states read as text, not color-only.
- [ ] Toasts and `ui-confirm` dialogs announce on appear; `aria-modal`
      confirm traps focus and returns it on close/cancel.
- [ ] Language toggle (PT/EN): `lang` attribute on `<html>` flips and
      subsequent announcements use the new language.

### VoiceOver (macOS) — VO+arrows / rotor

- [ ] Rotor → landmarks lists sidebar nav, topbar actions, main content.
- [ ] Rotor → headings exposes a sane outline on Dashboard, Knowledge,
      Agent/Skill detail cards.
- [ ] Form controls (filter-bar search, select dropdowns, radio groups
      on Install/Federation) announce label + role.
- [ ] Canvas container (`role="application"`) — verify the documented
      non-goal: AT users use the list view; canvas must not steal focus.
- [ ] Tables (skills/agents grids): column headers read with cell data.

### Cross-cutting

- [ ] Windows High Contrast / forced-colors: borders, focus ring and
      state dots remain visible (tokens already adapt via
      `prefers-contrast`; verify visually).
- [ ] 200% zoom / mobile 360px: no clipped interactive targets, toolbar
      wraps, canvas keeps a usable height.
- [ ] Keyboard-only full flow: install plan → review → confirm → apply
      (focus visible at every step; confirm dialog reachable).

## Record results

File findings under `docs/audits/` as `a11y-manual-YYYY-MM-DD.md` and
link them from `docs/reports/forge-portal-nextgen-completion.md`; any
serious/critical finding that axe *could* have caught should also become
a regression assertion in `e2e/test_browser_e2e.py`.
