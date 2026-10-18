# Graph Studio 2.1 — measured performance

Measured on `feat/portal-2.1-cycle2`, 2026-10-17, Node v22.23.2, Cytoscape
3.34.3 headless (jsdom, no rasterizer). Generator:
`node scripts/graph-bench.mjs` — it bundles the real `view-model`,
`analysis` and `cytoscape-adapter` modules via esbuild and times the
canonical pipeline: `FedGraph → toViewModel → setData+first layout →
per-layout runs → analysis → interaction → SVG export → grouping`.

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
