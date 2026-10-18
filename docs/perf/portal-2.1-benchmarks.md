# Forge Portal 2.1 — measured performance

Two instruments, both real:

- **Browser/CDP probe** (`e2e/perf_probe.py`, new in cycle 6) — real
  Chromium (Playwright 1.60) over the production `dist/` bundle served
  by the real `PortalServer` + E2E adapter. Navigation Timing
  (FCP/DCL/load), CDP `Performance.getMetrics` (heap, DOM nodes,
  Layout/RecalcStyle counts, Script/Task durations) measured **per
  route as counter deltas**, plus bracketed interaction timings
  (filter, command palette, graph canvas toggle, theme toggle) and
  telemetry recorder + live HTTP latency.
- **Graph headless benchmark** (`scripts/graph-bench.mjs`) — real
  `view-model`/`analysis`/`cytoscape-adapter` modules via esbuild,
  Cytoscape 3.34.3 under jsdom (no rasterizer).

Environment: Linux, Node v22.23.2, Chromium bundled by Playwright,
loopback-only server, production bundle. Single-run numbers — ±20%
noise between runs was observed; treat as orders of magnitude, not SLAs.
Raw artifacts: `e2e/artifacts/perf-cycle6.json`.

## Cycle 6 — portal-wide route measurements (real browser, prod bundle)

Per route: FCP, load-complete, JS heap, DOM node count and CDP deltas
(Task = total main-thread task time attributed to that navigation).
Heap grows monotonically because the probe navigates one long-lived
page through all 21 routes — per-route heap is cumulative, so the
columns below should be read as "heap at this point of the session".

| route | FCP | load | heap (cum.) | DOM nodes | TaskΔ | ScriptΔ |
|---|---:|---:|---:|---:|---:|---:|
| /dashboard | 340 ms | 316 ms | 4.6 MB | 1 168 | 529 ms | 87 ms |
| /install | 140 ms | 93 ms | 6.8 MB | 2 065 | 131 ms | 20 ms |
| /observe | 128 ms | 88 ms | 40.3 MB | 24 125 | 280 ms | 58 ms |
| /execution | 124 ms | 99 ms | 43.8 MB | 53 250 | 430 ms | 127 ms |
| /lab | 136 ms | 108 ms | 47.4 MB | 53 664 | 109 ms | 13 ms |
| /knowledge | 124 ms | 108 ms | 52.2 MB | 54 858 | 126 ms | 19 ms |
| /settings | 124 ms | 99 ms | 59.5 MB | 56 033 | 124 ms | 15 ms |

(Other 14 routes: FCP 100–116 ms, load 81–97 ms — full table in the
JSON artifact. /dashboard is the first navigation so its numbers include
app boot; SPA navigations after boot are ~80–110 ms load-complete.)

**Many-executions surface**: `/execution` renders the 500-event buffer
plus grouped spans — 53 k DOM nodes, ~99 ms load, TaskΔ ~430 ms. The
event inspector keeps it as the heaviest DOM surface together with
`/lab`; both stay responsive because the long DOM is mostly static
spans/ticks, not reactive widgets.

### Interactions (wall-clock + engine deltas)

| interaction | wall | TaskΔ | ScriptΔ | LayoutΔ | RecalcStyleΔ |
|---|---:|---:|---:|---:|---:|
| type "analyze" into /skills filter | 400 ms | 41 ms | 2.6 ms | 0.5 ms | 2.1 ms |
| type "review" into /agents filter | 377 ms | 23 ms | 1.8 ms | 0.6 ms | 2.1 ms |
| Ctrl+K → type "install" (palette) | 448 ms | 82 ms | 19 ms | 6.7 ms | 4.0 ms |
| graph list→canvas toggle (lazy Cytoscape) | 1 056 ms | 706 ms | 353 ms | 2.3 ms | 4.8 ms |
| theme dark→light toggle | 565 ms | 96 ms | 1.8 ms | 0.6 ms | 31.6 ms |

Filter keystrokes land in a single-digit ms of script + <40 ms of total
task time — the filter path is cheap; most of the wall number is the
probe's fixed settle. The canvas toggle is dominated by the lazy
Cytoscape chunk (453 kB raw) + first layout — the documented one-time
cost. Theme toggle recalcs ~all styles (RecalcStyleΔ 31.6 ms) — that's
the animation/token overhead; under `prefers-reduced-motion` the same
recalc happens with transition durations zeroed at the token layer.

### Telemetry cost (real recorder + real HTTP)

| measure | value |
|---|---:|
| `EventRecorder.emit` | 18.3 µs/event (500 emits = 9.2 ms total) |
| `recorder.report()` at capacity | 0.04 ms |
| `recorder.metrics_report()` | 0.6 ms |
| `GET /api/v1/events` (500-event buffer) | 35.5 ms / 86 780 B |
| `GET /api/v1/events?limit=25` | 2.9 ms |
| `GET /api/v1/metrics` | 9.7 ms / 80 747 B |

## Bundle (production build, measured — not the build log)

Cycle 6 `ng build` (2026-10-18): **initial 369.09 kB raw / 97.50 kB
estimated transfer** across 4 files (main 43.31 + shared chunk 281.68 +
styles 39.49 + chunk 4.61); **lazy 1 045 kB raw across 37 files**
(largest: cytoscape-adapter 453.03 kB). No budget warnings
(`initial` warn 500 kB / error 1 MB; `anyComponentStyle` warn 4 kB /
error 8 kB — both still configured in `angular.json` L31–41).

Comparison with the cycle-5 baseline (`docs/perf/bundle-baseline.md`):

| measure | cycle-5 baseline | cycle 6 | Δ |
|---|---:|---:|---:|
| initial raw | 352.35 kB | 369.09 kB | +16.74 kB (+4.8%) |
| initial transfer est. | 92.98 kB | 97.50 kB | +4.52 kB |
| cytoscape lazy chunk | 448.51 kB | 453.03 kB | +4.52 kB |

The +4.8% is the accumulated cycles-3→5 surface (execution page,
explorer, knowledge) landing in shared chunks — under the regression
recommendation threshold (~400 kB raw) set by the baseline doc itself.

## Graph Studio 2.1 — headless engine benchmark

Measured on `feat/portal-2.1-cycle2`, 2026-10-17, Node v22.23.2, Cytoscape
3.34.3 headless (jsdom, no rasterizer). Generator:
`node scripts/graph-bench.mjs` — it bundles the real `view-model`,
`analysis` and `cytoscape-adapter` modules via esbuild and times the
canonical pipeline: `FedGraph → toViewModel → setData+first layout →
per-layout runs → analysis → interaction → SVG export → grouping`.
Re-run in cycle 6 for the two fast sizes (see *fresh* column notes).

Synthetic graph shape: deterministic LCG seed, 7 kinds cycling,
`associated` edges, `unverified` every 13th node — topology data only,
never modelled as product data.

## Results

| size (n/e)        | toViewModel | setData + first layout |       cose | circle | concentric |   grid | breadthfirst | analysis | interact |      SVG export | group by kind |
| ----------------- | ----------: | ---------------------: | ---------: | -----: | ---------: | -----: | -----------: | -------: | -------: | --------------: | ------------: |
| 100 / 286\*       |      1.0 ms |               1 057 ms |     918 ms |   7 ms |       7 ms |   4 ms |        28 ms |   2.5 ms |   2.7 ms |    3 ms (52 KB) |             — |
| 1 000 / 4 982\*   |      5.9 ms |              37 250 ms |  34 818 ms |  51 ms |      70 ms |  49 ms |       530 ms |  22.4 ms |  39.4 ms |  26 ms (728 KB) |        671 ms |
| 5 000 / 19 992\*  |     56.9 ms |             **>120 s** | **>120 s** | 370 ms |     273 ms | 203 ms |     1 634 ms |  70.7 ms |   110 ms |  97 ms (3.2 MB) |      2 393 ms |
| 10 000 / 49 983\* |     56.6 ms |             **>120 s** | **>120 s** | 818 ms |     706 ms | 462 ms |     4 448 ms |   227 ms |   312 ms | 238 ms (7.4 MB) |      6 608 ms |

\*requested edge counts minus a few duplicate pairs dropped by the
generator (`seen` set) — `edgesReal` is the honest count.

**Cycle-6 re-run** (`BENCH_SIZES` pinned to the two fast sizes, same
generator/machine, 2026-10-18): 100/286 → toViewModel 1.2 ms,
setData+first layout 1 196 ms, cose 1 039 ms, circle 9 ms, concentric
9 ms, grid 6 ms, breadthfirst 36 ms, analysis 3.9 ms, interact 3.8 ms,
SVG 4 ms/52 KB; 1 000/4 982 → toViewModel 7.7 ms, setData+first layout
44 270 ms, cose 42 001 ms, circle 57 ms, concentric 81 ms, grid 52 ms,
breadthfirst 450 ms, analysis 27.9 ms, interact 39.6 ms, SVG 31 ms/728
KB, grouping 760 ms. Both cose numbers sit inside the documented ±20%
run-to-run band (cose@1 k previously ranged 28.7–42.5 s) — **no
regression vs the cycle-2 baseline**. The ≥5 k rows were not re-run:
the cycle-2 numbers stand and cose remains non-viable there by
measurement, not assumption.

`setData + first layout` covers element creation plus the default cose
run (the first render always runs cose). `analysis` = `impactReport`
depth 3 + `connectedComponents` + one `shortestPath` over the canonical
`FedGraph` — pure JS, no renderer involved. `interact` = select +
N-hop highlight. `group by kind` = compound parents built + laid out

- then torn down again.

## What the numbers say

- **cose scales O(n²·iters) and is the bottleneck.** 100 → ~0.9 s,
  1 k → ~35 s, ≥5 k → does not finish inside the 120 s budget.
  The four structural layouts stay interactive throughout:
  at 10 k/50 k, grid 462 ms, circle 818 ms, concentric 706 ms,
  breadthfirst 4.4 s.
- **Analysis is cheap at every measured size** (≤ ~230 ms at 10 k) —
  it runs on the plain model, not on the engine.
- **Element creation + cose init at 5 k/10 k is itself slow**: the
  synchronous portion of `setData` measured ~60 s (5 k) and ~280 s
  (10 k) before the layout loop even became awaitable — `cy.add`
  alone is fast (25 k elements ≈ 0.4 s isolated); the time goes to
  cose's synchronous `createLayoutInfo` + first frame batch.
- **Interaction and SVG export stay sub-second** up to 10 k.

## Engineering consequences (all shipped on this branch)

1. **Cose runs asynchronously even when motion is disabled.**
   Cytoscape's cose executes `while(loopRet) mainLoop(i)` **inside a
   single synchronous call** whenever `animate !== true`
   (`node_modules/cytoscape/src/extensions/layout/cose.mjs`, the
   `options.animate === true` branch boundary). With
   `prefers-reduced-motion` that froze the whole tab — stop() could
   never land. The adapter now runs cose with `animate: true` +
   `animationThreshold = Number.MAX_SAFE_INTEGER`: the frame loop stays
   async and cancellable, positions apply once at `layoutstop`, and no
   intermediate motion is rendered. See
   `src/app/core/graph/cytoscape-adapter.ts` `runLayout()`.
2. **Teardown waits for in-flight layout frames.** A stopped cose
   still owns one queued frame that calls `done() → refresh()` on the
   next tick; `cy.destroy()` before it lands crashed
   `Core.endBatch → renderer.notify` on a null renderer (this exact
   crash was hit by this benchmark at 10 k before the fix). `destroy()`
   now stops the running layout, counts pending layout frames, and
   defers `cy.destroy()` until they settle (500 ms cap). Regression
   test: `destroy() while a continuous layout is in flight tears down
cleanly` in `cytoscape-adapter.spec.ts`.
3. **Superseded layouts are stopped, never stacked** — the previous
   fix retained: `stopLayout(runningLayout)` before every new
   `runLayout()`.

## Honest limits (UNVERIFIED where marked)

- Real adapter endpoints produce at most a few hundred nodes; the
  benchmark sizes (1 k–10 k) are **synthetic stress targets**, not
  observed product data.
- At ≥5 k nodes **cose is not viable** — the toolbar still offers it
  (the user's choice is theirs), but the numbers above say use
  `grid`/`circle`/`concentric`/`breadthfirst` at that size. The page
  remains responsive while cose runs — switching layouts cancels it.
- `setData` on ≥5 k nodes is heavy (~1–5 min wall) even without cose
  finishing; this is an engine-level cost documented, not hidden.
- Timings are single-run headless numbers — ±20% noise between runs
  was observed (cose@1 k ranged 28.7–42.5 s across runs). Treat them
  as orders of magnitude, not SLAs.
- PNG export is `null` headless (no rasterizer) — UNVERIFIED as bytes;
  verified as painted pixels in the Chromium e2e.
