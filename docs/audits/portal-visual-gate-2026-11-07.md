# Portal visual, accessibility and UX gate — 2026-11-07

## Execution boundary

The gate ran from a clean detached worktree at Portal `main` `5f8258d`, with
the existing Portal checkout left untouched. The real Angular production bundle,
Portal server, Playwright Chromium and local `axe-core` were used. The test
harness discovered the sibling `forge-cli` source checkout through an explicit
override or bounded workspace-ancestor search; no registry outside the test
temporary directory was changed.

## Results

| Gate | Result | Evidence |
|---|---:|---|
| Angular production build | PASS | bundle generated in 27.3s |
| Angular unit suite | PASS | 54 files, 588 tests |
| Browser E2E | PASS | 45 passed, 3 optional skips, 175.04s |
| axe-core | PASS | 0 violations across 42 route/variant entries |
| Focus ring probe | PASS | 0 routes without a visible ring |
| Horizontal overflow | PASS | 0 pages |
| Reflow | PASS | 252 captures, 0 bad clips outside scrollers |
| Visual captures | PASS | 214 screenshots across base/dense, themes and viewports |
| Modes | PASS | system/forced schemes, contrast and reduced motion |
| Usability journey | PASS | 9/9 steps, 0 frictions, 94 keystrokes |

The visual probes report clipped/ellipsized text only where the component has a
legitimate bounded presentation (or a title/accessible fallback); the gate's
blocking rule for unlabelled clipping outside scrollers stayed at zero.

## Fix included with this gate

`e2e/test_browser_e2e.py` no longer assumes `forge-cli` is a direct sibling of
the Portal checkout. It first honors `FORGE_CLI_BIN`, then searches bounded
workspace ancestors for `forge-cli/dist/index.js`. This makes the real registry
boundary reproducible from detached worktrees and nested CI layouts.

The two previously failing registry tests now pass:

- `test_registry_security_http`
- `test_registry_plan_is_side_effect_free`

## Remaining limits

- The three optional skips are environment-dependent tests, not axe or visual
  failures.
- This is Chromium evidence. It does not claim Firefox/WebKit or a manual
  screen-reader certification.
- Live provider/cloud execution remains a separate governed gate.
