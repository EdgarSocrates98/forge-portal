# Portal 2.2 — Cycle 5: UX & Accessibility Validation

**Status:** VALIDATED — real screen-reader evidence captured; 0 page-level
horizontal overflow at 400% zoom; 9/9 scripted journey steps pass; all gates
green (495 unit tests, build, axe, prettier, ruff).

**Method note:** the usability walkthrough is **heuristic/scripted — no human
participants**. It replays the nine-step operator journey with a real keyboard
against a live backend + real Chromium and records focus, keystrokes and (where
attached) Orca announcements. It does not substitute a moderated study.

Evidence artifacts (machine-readable):

| Artifact                              | Contents                                                       |
| ------------------------------------- | -------------------------------------------------------------- |
| `e2e/artifacts/orca-cycle5.json`      | per-step Orca `SPEECH OUTPUT` diffed from `orca --debug-file`  |
| `e2e/artifacts/reflow-cycle5.json`    | 252 captures: overflow + clipped-text metrics                  |
| `e2e/artifacts/modes-cycle5.json`     | 9 mode cases: scheme/contrast/motion resolution                |
| `e2e/artifacts/usability-cycle5.json` | nine-step journey: keystrokes, focus trail, friction           |
| `e2e/artifacts/axe-report.json`       | reused axe-core 4.14 audit (Portal 2.1 baseline, re-run in CI) |

## 1. Screen reader — Orca 46.1 + headed Chromium (REAL, tested)

`e2e/orca_probe.py` boots the real `PortalServer(E2EAdapter())` fixture, launches
**headed** Playwright Chromium on `DISPLAY=:0` (Wayland session,
`--force-renderer-accessibility`), starts `orca --debug-file=/tmp/orca-portal.log`,
then drives an actual keyboard journey — Tab through the sidebar landmarks, skip
link → `main.content`, forge row activation, palette journeys to agents / skills /
MCP / tasks / observe / settings, and the **graph list fallback**
(`data-view="list"`), never canvas-only. After every keypress it waits ~1.5 s and
diffs the Orca debug log for `SPEECH OUTPUT` lines.

Final artifact summary:

- `orca_version`: 46.1 · `display`: `:0` · `session_type`: `wayland`
- 100 recorded steps · **87 steps produced portal speech** · **139 speech
  utterances** · `verdict: REAL`
- Confirmed announcements include: `Pular para o conteúdo` (skip link),
  `conteúdo principal` (landmark after skip-link Enter), sidebar nav items,
  the `Tema` panel with `Escuro` / `Sistema` / `Claro` radios, and list/table
  row names.
- 13 silent steps (logged in `summary.silent_steps`): mostly repeated `forge-row`
  tabs where Orca coalesced identical row announcements, plus 3 traversal
  tail-steps. None indicates a missing accessible name — the focused elements
  carried text, verified in the focus trail.

**Environment limitation (not a portal defect):** the probe shared the live `:0`
desktop with other Chrome windows. Mid-run, OS focus could be stolen, so a few
runs produced thinner coverage; the preserved artifact is the strongest run.
Periodic `bring_to_front()` mitigates it; `steps_where_orca_presented_other_apps`
is `[]` in the final evidence — no foreign-app utterances leaked into the record.

## 2. Zoom / reflow — 4 viewports × 3 zooms × 21 routes (252 captures)

`e2e/reflow_probe.py` measures `scrollWidth > clientWidth` at the document root
(page-level horizontal overflow) and clipped inline text per route. Clip
classification reuses `visual_probe`'s rule: a clip is **bad** only when the
element has no `title` fallback and sits outside a scrollable container;
graph-canvas text is excluded.

| Result                         | Count                  |
| ------------------------------ | ---------------------- |
| Captures                       | 252                    |
| Page-level horizontal overflow | **0**                  |
| Captures with any clipped text | 108                    |
| **Bad clips (no fallback)**    | **0** (was 63 pre-fix) |

The 63 pre-fix bad clips were all one defect: `.topbar__workspace` renders
“Nenhum workspace aberto” with `overflow: hidden` + ellipsis, and its `title`
binding was `store.workspace()?.root ?? null` — so the empty state had **no**
accessible full text. Fix: `?? ('dashboard.noWorkspace' | t)` in
`src/app/app.ts`. Remaining 108 clipped-text captures are intentional
truncation inside scrollable tables/containers or carry a `title`.

## 3. Modes — dark / light / system / high-contrast / reduced-motion

`e2e/modes_probe.py` emulates UA `prefers-color-scheme`, `prefers-contrast` and
`prefers-reduced-motion`, then asserts runtime resolution (9/9 cases pass):

- **system** follows UA dark and light (`data-scheme` resolution);
- **forced** dark/light override the UA signal;
- **`prefers-contrast: more`** widens the focus ring to 3 px in both schemes;
- **`prefers-reduced-motion: reduce`** zeros `--fg-motion-*` tokens **and**
  real transition durations (verified on `.icon-btn`/`.btn`/`.nav__item`; note
  Chromium serializes `0.01ms` as `1e-05s`);
- **explicit `data-motion='full'`** restores tokens and transitions — the user
  opt-out wins over the UA signal;
- **explicit `data-motion='reduced'`** applies under `no-preference`.

Code fix found here: the Cytoscape renderers in `agents.page.ts` and
`graph.page.ts` animated unconditionally. They now resolve
`data-motion` → UA `matchMedia` → animate accordingly. Unit test
`tokens.spec.ts` now asserts every `prefers-reduced-motion` block in
`styles.css` is scoped under `:root:not([data-motion='full'])` — it caught a
6th unscoped block (`.running__spinner`) that was also fixed.

## 4. Scripted nine-step journey (`e2e/usability_probe.py`)

Heuristic keyboard walkthrough — **no human participants**. 9/9 steps reached
their goal; total **138 keystrokes**.

| #   | Step                | Keys | Result                     |
| --- | ------------------- | ---: | -------------------------- |
| 1   | discover forge      |   12 | OK                         |
| 2   | agent               |   15 | OK                         |
| 3   | skills              |   12 | OK                         |
| 4   | MCP                 |    4 | OK                         |
| 5   | diagnose host       |    5 | OK                         |
| 6   | graph relationships |   23 | OK                         |
| 7   | dependencies        |    0 | OK (already on page state) |
| 8   | inspect execution   |   58 | OK — **friction**          |
| 9   | interpret error     |    9 | OK                         |

Focus order was sane throughout (skip link → brand → nav → main; palette traps
Tab correctly; timeline rows are now keyboard-activatable — see fix 5).

## 5. Small fixes landed (validated, in this branch)

1. **`app.ts`** — `title` fallback on the empty-workspace topbar label (fixes
   the only reflow defect class).
2. **`agents.page.ts`, `graph.page.ts`** — renderer animation honors
   `data-motion` + `prefers-reduced-motion` (was unconditional).
3. **`styles.css`** — scoped the `.running__spinner` reduced-motion block under
   `:root:not([data-motion='full'])` (6th block missed by earlier passes).
4. **`execution.page.ts`** — the timeline `<tr (click)>` rows (the only path
   into the event inspector) gained `tabindex="0"` + Enter/Space activation;
   WCAG 2.1.1. Caught by the new `a11y.spec.ts` contract.
5. **`a11y.spec.ts`** — static contract: clickable non-button elements must be
   keyboard-activatable (known dialog/palette cases excluded).
6. **`tokens.spec.ts`** — every UA reduced-motion reset must honor the
   `data-motion='full'` opt-out.

Also shipped earlier in this cycle (already exercised by E2E): focus-visible
styling on `confirm-dialog` / `toast` actions and `federation` controls.

## 6. Friction list (documented, not silently patched)

1. **Execution inspector depth — 58 keystrokes.** The event inspector is a
   two-activation flow (`tl__row` select → `data-action="inspect"` row) behind
   a dense, fully-tabbable timeline. Needs a roving-`tabindex` grid or a direct
   "inspect latest" control — larger than a cycle-5 patch; tracked as a
   follow-up.
2. **Orca coalescing on identical rows.** Repeated forge-row tabs produced no
   new utterance for 7 steps (AT-SPI coalescing, expected); visible focus moved
   correctly per the focus trail.
3. **Shared-desktop focus theft (environmental).** Live `:0` session windows
   can steal Orca's locus of focus; mitigated in-probe and disclosed — run the
   probe on a dedicated VT/Xvfb for full-attention evidence.

## 7. Gates

| Gate                                            | Result                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| `npx ng test --watch=false`                     | **49 files / 495 tests pass** (baseline 493 + 2 new contract tests) |
| `npm run build`                                 | green — 370.19 kB initial raw / 97.64 kB transfer                   |
| axe-core 4.14 E2E                               | pass — 0 serious/critical (baseline held)                           |
| route / theme / timeline / mobile / scroll E2E  | 6/6 pass                                                            |
| `npx prettier --check "src/**/*.{ts,html,css}"` | pass                                                                |
| `.venv/bin/ruff check e2e/`                     | pass                                                                |

**Not tested (UNTESTED):** real-browser zoom (the probe uses viewport+CSS-zoom
emulation — equivalent geometry, not OS zoom); NVDA/VoiceOver (Linux-only
session); touch/pointer ergonomics beyond the 390×844 viewport checks; a
moderated usability study (scripted only, as stated).
