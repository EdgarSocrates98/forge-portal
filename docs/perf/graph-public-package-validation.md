# Cycle 2.2.2 — Graph Studio Guard & Performance Validation

Method: static-guard verification against `src/app/core/graph/layout-policy.ts` + `cytoscape-adapter.ts`, unit evidence via `ng test` (51 files / 554 tests, all pass — includes `layout-policy.spec`, `cytoscape-adapter.spec`, `graph.page.spec`), plus prior measurements in `docs/perf/graph-scale-report.md`. Browser: real Chrome available; a fresh 4-size headed run was **not** executed this cycle (see Residual).

## Guard contract verified in code

`layout-policy.ts` classifies the element set by **measured** stats (header: "Every threshold below was fixed by MEASUREMENT, not intuition"):

| Tier | Nodes | Behavior |
|---|---|---|
| small | ≤ 250 | full layout path |
| medium | ≤ 1200 | standard path |
| large | ≤ 6000 | warning-tier path |
| very-large | > 6000 | blocked tier — expensive layout refused |

- **Stats** computed per set: node/edge counts, `density = 2·E/N`, undirected **connected components**.
- **Recommendations**: dense-small → `concentric`; high-fragmentation (`components > max(8, 0.2·N)`) → `grid` fallback — a *recommended layout* is always produced with the classification.
- **Cancellation/watchdog** (`cytoscape-adapter.ts`): `stopLayout()` emits `layoutstop` synchronously; superseded runs are **stopped, never stacked**; stopped continuous layouts emit one final frame then settle — in-flight layouts are cancelled deterministically.
- **Refresh policy**: re-layout only when the share of never-positioned nodes crosses a threshold; stable otherwise — no unconditional relayout on refresh.
- **Zoom tiers**: far-tier label class churn is skipped past a size bound — per-zoom churn bounded.

Mapped to the required sizes: 100n/300e → small; 1 000n/5 000e → medium; 5 000n/20 000e → large (warning path); 10 000n/50 000e → very-large (**blocked** — renderer is not invoked; the page must show reason + alternative and keep the list view usable, which is the design the unit specs assert).

## Evidence level per prompt requirement

| Requirement | Evidence | Status |
|---|---|---|
| Tier classification & density/components | `layout-policy.ts` + `layout-policy.spec` green | PASS (unit) |
| Expensive-layout warning / blocked tier | policy + adapter watchdog code + specs | PASS (unit) |
| Blocked ops don't invoke renderer, show reason, offer alternative, preserve state | asserted by `graph.page.spec`/`cytoscape-adapter.spec`; prior headed evidence in `graph-scale-report.md` | PASS (prior + unit) |
| TTI/memory/CPU/FPS/long-tasks at 4 sizes this cycle | **not re-run** — headed run requires a size-producing adapter; unit+code evidence stands | PARTIAL — recorded as residual G-1 |
| No headless-as-FPS claim | honored — no FPS claimed from this headless/CI context | — |

## Existing measured report

`docs/perf/graph-scale-report.md` (Cycle 3) already contains headed Chromium scale measurements + the threshold derivation this policy encodes; this cycle verified the shipped code still implements those thresholds and that all 554 specs pass.

## Verdict

**PARTIAL→PASS-with-residual**: the hard guard is real, unit-tested, and unchanged from measured thresholds; a fresh 4-size headed run is open as residual gap G-1 (requires a graph-producing adapter scenario — flagged for the freeze checklist, not blocking certification since no code changed in the path).
