# Cycle 2.2.2 — Execution Studio Keyboard-Only Validation

Method: real **Google Chrome** (headed-capable build, driven via Playwright `channel="chrome"`, not bundled headless-only Chromium) against the **production `dist/` bundle** served by the vendored `portal_core.forge_portal.PortalServer` + `E2EAdapter`. A real execution was produced through `POST /api/v1/tasks/plan` + `/tasks/execute` — events on screen are recorded `forge/PortalEvent/1` documents, not fixtures. Raw trace: `docs/audits/forge-2.2.2-dump/keyboard-e2e-evidence.json` (57 keys logged, per-key ms + focused element + selection/inspector state).

## Journey result (prompt §6, 9 steps)

| # | Step | Evidence | Result |
|---|---|---|---|
| 1 | Open Portal | `load_ms` ≈ 2.5s, shell rendered | PASS |
| 2 | Open Execution Studio | `/execution` rendered | PASS |
| 3 | Locate execution | 17 `.tl__row` timeline rows rendered from recorded events | PASS |
| 4 | Navigate events | roving tabindex on timeline + `tbody tr` list; `aria-keyshortcuts="ArrowUp ArrowDown Home End PageUp PageDown Enter Escape"` present on table | PASS |
| 5 | Select event | `Enter` on `.tl__row` → `data-selected` set (sel_rows 0→1) | PASS |
| 6 | Open inspector | `Enter` on table `tr` → `[data-section="inspector"]` rendered (count=1) | PASS |
| 7 | Read details | inspector shows verbatim `operation.start`, `evt-1`, schema `forge/PortalEvent/1`, timestamp `18/10/2026 13:14:03`, correlation `03b34a74dc06`, span `446a64f0…`, origin `portal_core`, destination `POST /tasks/plan`, related events (`task.planned`, `operation.end`) | PASS |
| 8 | Close inspector | `Escape` → inspector removed (count=0) | PASS |
| 9 | Focus return | `document.activeElement` = the same `TR` (`tabindex=0`, `aria-rowindex=2`, visible) — focus restored to the row, not body | PASS |

## Measured details

- **Tab depth**: 31 Tab stops to reach the first timeline row (skip-link → brand → 15 nav items → page controls → filters → table). 9 further stops timeline→events table. Total journey: 57 keypresses, ~3s of user-time equivalent. The depth is honest sequential tab order; the skip-link exists and lands inside `<main>` (verified in the earlier run — focus landed on `MAIN.content` after skip activation).
- **Per-key latency**: all key handlers ≤16ms (median ~4ms) — no long-task stalls observed during navigation.
- **Console errors**: 2 × `404` resource loads — identified as missing favicon/static asset, not app errors; no pageerror events.
- **Selection/activation**: exactly one `data-selected` after Enter; Escape did not clear selection (row state preserved) and restored focus — the guard contract "blocked/closed operations preserve state" holds.

## Assistive-technology layer

| AT | Result |
|---|---|
| Orca | **NOT_TESTED** — `/usr/bin/orca` exists and `e2e/orca_probe.py` (headed Chromium + `--force-renderer-accessibility`) is in-tree, but an Orca speech run was not executed this cycle (session risk: mutating the user's live desktop AT). The DOM-level contract it would announce (roles, `aria-setsize/posinset`, roving tabindex, `aria-keyshortcuts`, focus restore) is what the trace above verifies. |
| NVDA | NOT_TESTED (Windows-only) |
| VoiceOver | NOT_TESTED (macOS-only) |

## Comparison: previous vs current methodology

- **Cycle 2.2.1 methodology** (per `docs/reports/portal-2.2-cycle5-ux-a11y.md`): unit-level keydown specs (jsdom/vitest) — proves handler wiring, not real focus behavior.
- **This cycle**: real browser focus/activation through the production bundle — catches what jsdom cannot (tab-order depth, roving-tabindex DOM state, focus restoration target, console errors). **Finding worth recording**: reaching the events table costs ~40 Tab stops linearly; the skip-link helps but the page could benefit from a documented "jump to results" affordance — recorded as a P2 UX note, not a defect (the contract did not promise a shortcut count).

## Verdict

**PASS** — the full keyboard-only journey is completable with correct focus management, verbatim inspector content, state preservation, and focus restoration. Evidence is a real-browser trace, not a unit assertion.
