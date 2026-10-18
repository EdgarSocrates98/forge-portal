# Graph Studio — scale & performance report (Portal 2.2, Cycle 3)

Measured 2026-10-18 on `portal-2.2/cycle3-graph-perf`. Every number below
comes from a real run — headless figures from
`node scripts/graph-bench.mjs` (bundles the real adapter, view-model,
analysis and layout-policy modules through esbuild and times them under
jsdom headless, Node v22.23.2, Cytoscape 3.34.3), raster/interaction
figures from the Chromium/CDP probe (`e2e/perf_probe.py`). No estimates,
no invented rows.

Raw artifacts — the tables below are transcriptions of these files:

- `e2e/artifacts/graph-scale-cycle3-auto.json` — full 8-size matrix,
  policy `auto` (the shipped path), 90 s layout-wait budget.
- `e2e/artifacts/graph-scale-cycle3-off.json` — `BENCH_POLICY=off`
  baseline (pre-cycle-3 pipeline: unguarded, unbounded cose first
  layout, full wipe + unconditional relayout on refresh), 60 s
  layout-wait budget; 7 rows — the 10 000-node run did not fit any
  budget and is evidenced by the raw log.
- `e2e/artifacts/graph-scale-cycle3-off.log` — stderr marks of the
  baseline run, including the 10 000-node freeze (`setData settled`
  at 1 262 286 ms ≈ **21 min**) before the process was terminated.

## Pipeline audit — where the time goes

Canonical path: `FedGraph → toViewModel → setData (element defs +
cy.add/remove/diff) → layout (guarded) → render → interaction`.

Measured phases, cycle-3 adapter, policy `auto` (values = ms unless
noted):

| phase                                    |      100/286 |    1 000/4 982 |    5 000/19 992 |   10 000/49 983 |
| ---------------------------------------- | -----------: | -------------: | --------------: | --------------: |
| `toViewModel`                            |      0.72 ms |        4.04 ms |          9.3 ms |         42.4 ms |
| `structuredClone(FedGraph)`              |      0.97 ms |        14.4 ms |         69.2 ms |        181.8 ms |
| policy `chooseLayout`                    |       0.5 ms |         6.1 ms |         22.0 ms |         44.0 ms |
| isolated `cy.add` (all elements)         |      12.5 ms |         153 ms |          523 ms |        1 378 ms |
| renderer `mount`                         |       1.7 ms |         1.1 ms |          0.7 ms |          0.5 ms |
| **setData + first layout**               | **1 171 ms** |     **311 ms** |      **963 ms** |    **2 437 ms** |
| setData refresh (same view)              |         7 ms |          70 ms |          244 ms |          591 ms |
| analysis (impact d3 + components + path) |       1.8 ms |        48.6 ms |         81.0 ms |        227.3 ms |
| SVG export                               | 2 ms / 52 KB | 36 ms / 728 KB | 179 ms / 3.1 MB | 375 ms / 7.4 MB |
| group-by-kind layout                     |            — |         946 ms |       21 046 ms |      105 507 ms |
| destroy                                  |       0.2 ms |         8.3 ms |          8.5 ms |         17.3 ms |
| peak RSS                                 |       183 MB |         339 MB |          935 MB |        1 667 MB |

### Unguarded baseline (`BENCH_POLICY=off`) — what we fixed

Same harness, same graphs, pre-cycle-3 pipeline. `null` = the call did
not return inside the 60 s wait budget (the layout keeps running — the
event loop is so starved the budget check itself lands late).

| nodes/edges   |                                                                        setData + first layout |             setData refresh |    cose slot |
| ------------- | --------------------------------------------------------------------------------------------: | --------------------------: | -----------: |
| 50/145        |                                                                                        918 ms |                      731 ms |       708 ms |
| 100/286       |                                                                                      1 317 ms |                    1 240 ms |     1 089 ms |
| 200/786       |                                                                                      2 645 ms |                    2 460 ms |     2 549 ms |
| 500/1 989     |                                                                                     13 102 ms |                   13 010 ms |    12 384 ms |
| 1 000/4 982   |                                                                                     46 144 ms |                   53 386 ms |    46 563 ms |
| 2 000/8 987   |                                                                                  null (>60 s) |                null (>60 s) | null (>60 s) |
| 5 000/19 992  |                                                                   null — gave up at **267 s** | null — gave up at **229 s** | null (>60 s) |
| 10 000/49 983 | not recorded — **1 262 s** in setData+layout when the process was terminated (see `-off.log`) |                           — |            — |

Before → after on `setData + first layout`: 1 317 ms → 1 171 ms @100
(cose is still the right pick at small), **46 144 ms → 311 ms @1 000**
(~148×), >60 s → **462 ms @2 000**, 267 s+ → **963 ms @5 000**, and the
10 000-node mount that froze for ~21 min now paints in **2 437 ms**.
Refresh is the bigger structural win: positions are kept, so 53 386 ms →
70 ms @1 000 and the ≥2 000 timeouts become 119–591 ms.

## Measured layout costs (headless, guarded)

`guardEvents` in the bench JSON prove each cell's finish state —
`done` = natural, `timeout` = watchdog-fired then `grid` fallback.
cose is excluded from the ≥5 000 layout loop of the default matrix (the
watchdog cannot preempt its synchronous frame block — see _Watchdog
bounds_); the two rows beneath the table measure it explicitly via
`BENCH_LAYOUTS=cose`.

| layout       |     50 |      100 |      200 |       500 |      1 000 |                2 000 |                      5 000 |                10 000 |
| ------------ | -----: | -------: | -------: | --------: | ---------: | -------------------: | -------------------------: | --------------------: |
| cose         | 721 ms | 1 091 ms | 2 432 ms | 5 934 ms¹ | 20 210 ms¹ | **timeout @30.1 s²** | **timeout, 73.3 s wall²³** | **>5.5 min, killed³** |
| circle       |   9 ms |    12 ms |    15 ms |     26 ms |      66 ms |               130 ms |                     330 ms |                786 ms |
| concentric   |  17 ms |    13 ms |    23 ms |     40 ms |      88 ms |               183 ms |                     441 ms |              1 474 ms |
| grid         |   8 ms |     5 ms |    14 ms |     34 ms |      70 ms |               126 ms |                     318 ms |                797 ms |
| breadthfirst |  29 ms |    41 ms |   125 ms |    261 ms |     632 ms |             1 254 ms |                   2 837 ms |              6 759 ms |

¹ bounded iterations (300 @1 000) applied — the policy's medium budget;
cose@1 000 drops from 46.6 s unbounded to 20.2 s.
² watchdog killed the run at the 30 s budget boundary + in-flight frame;
`grid` fallback painted ~0.2 s later — bench `guardEvents` show
`timeout → started:grid → done:grid`.
³ separate `BENCH_LAYOUTS=cose` runs: 5 000 = 73 331 ms wall; 10 000
did not finish one cose inside a 330 s process cap — recorded as "does
not finish", not a number.

## Adaptive policy — validated thresholds

`layout-policy.ts` classes and their bench justification:

| class        |   nodes | auto pick                                                          | evidence                                                                                                        |
| ------------ | ------: | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `small`      |   ≤ 250 | `cose` (or `concentric` when density > 14, `grid` when fragmented) | cose 0.7–2.5 s — acceptable force quality at this size                                                          |
| `medium`     | ≤ 1 200 | `concentric`                                                       | cose 5.9 s (500n) → 20.2 s bounded / 46.6 s unbounded (1 000n): viable but visibly slow → `warn` for user picks |
| `large`      | ≤ 6 000 | `grid`                                                             | cose watchdog-killed at 30.1 s (2 000) / 73.3 s (5 000) → `blocked` (confirm required)                          |
| `very-large` | > 6 000 | `grid` + progressive render + cluster advisory                     | cose never finishes (killed @330 s cap); flat canvas needs chunking (60 k elements) and the grouped overview    |

Inputs used by `chooseLayout(stats, {preferred, env})`: node/edge
count, density (`2E/N`, dense small graphs skip cose), connected
components + largest share (fragmented graphs pick `grid` — a
single-root tree reads badly), user preference (explicit pick flips
`source: 'user'` and re-prices the choice), view type (an already-
grouped view suppresses the cluster advisory), environment
(`reducedMotion` is recorded but does not change the pick — animation
is the adapter's concern, not the policy's).

The page exposes the resolved pick as `Auto · <layout>` and persists
`layoutAuto` in the saved view (records written before cycle 3
default to `auto`).

## Layout safety guard — shipped behaviour

- **No concurrent layouts** — a new `layout()` stops the in-flight one
  (`superseded` event); proven in tests and by the bench event stream
  (`s:cose → s:cose` never coexists).
- **Cancellation** — `cancelLayout()` stops async cose mid-run
  (`cancelled` event); the canvas keeps the last stable positions —
  verified by spec (`cancelLayout() stops an in-flight cose …`).
- **Watchdog + fallback** — async layouts arm `layoutTimeoutMs` from
  measured scale (15 s small / 60 s medium / 30 s large+); on expiry the
  run stops, `timeout` emits with the fallback name, and `grid` runs
  immediately. Measured: cose@2 000 stopped at **30 104 ms** + ~2.5 s
  in-flight frame before the fallback settled (32.8 s wall for the
  slot), cose@5 000 wall **73.3 s** (30 s budget + ~43 s block).
- **No silent freezes** — the status strip shows `Applying <layout>…`
  with a cancel control during runs, element-count progress during
  progressive render, and the timeout notice names the fallback.
- **Reduced motion** — cose always runs its async frame loop
  (`animate: true` + `animationThreshold = MAX_SAFE_INTEGER`): positions
  apply once at `layoutstop`, zero visible motion, and the frame gaps
  are exactly what let `stop()` land — the 2.1 reduced-motion freeze is
  structurally gone.

### Watchdog bounds — the honest limit

A timer cannot interrupt synchronous JavaScript. cose's per-frame work
is `refresh: 20` iterations of an O(n²) repulsion step — one frame is a
single synchronous block. The effective bound is therefore
**`budget + the currently executing synchronous block`**: ~2.7 s at
2 000 nodes, ~43 s at 5 000, and at 10 000 the block itself exceeded a
330 s process cap. Cancellation lands at the same granularity —
between blocks, not inside one. This is why the policy `blocked` tier
exists at all: at large scale the only honest protection is to not run
cose (auto) or to require an explicit confirm (user pick, still
bounded iterations + watchdog).

## Initial-render improvements — what shipped and why

Each change below is on the measured hot path:

| optimisation                                                                              | measured effect                                                                                                       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| incremental reconcile (diff/remove/field-sync instead of wipe)                            | same-view `setData` 53 386 ms → **70 ms** @1 000; 229 s+ → **244 ms** @5 000                                          |
| `skipped` layout when ≤ ~10 % of nodes are new + deterministic neighbour-seeded positions | refresh keeps canvas positions; no relayout cost at all                                                               |
| progressive chunked `cy.add` (>8 000 elements, 2 000/chunk, yields between)               | 10 k/50 k first render interactive; `progress` events streamed during the pass (bench events show ~30 progress ticks) |
| policy pre-pick riding `setData` opts                                                     | the layout choice applies to the new elements — no wasted relayout of the outgoing set                                |
| `toggleClass` honesty flags + shallow field diff                                          | per-element restyle only when fields actually changed                                                                 |
| analysis adjacency memo (WeakMap per FedGraph)                                            | chained analyses (impact + components + path) pay the O(E) index once                                                 |
| per-node `norm()` cache (WeakMap per FedNode)                                             | filter typing no longer re-normalizes 10 k ids+labels per keystroke                                                   |

Not shipped — measured first, found wanting:

- **position cache across rebuilds** — unnecessary: the diff path
  already preserves positions for kept elements, and a rebuild of a
  changed model legitimately re-lays out.
- **further label culling** — zoom tiers already gate label cost and the
  measured bottleneck was element creation + cose, not styling.

## Interaction performance (headless, p50 / p95, n=9)

| interaction               |      1 000/4 982 |     5 000/19 992 |        10 000/49 983 |
| ------------------------- | ---------------: | ---------------: | -------------------: |
| select                    |   2.10 / 4.03 ms |  9.38 / 14.23 ms |     23.66 / 27.17 ms |
| highlight (neighbourhood) |   47.4 / 57.7 ms | 177.8 / 188.3 ms |     471.9 / 494.5 ms |
| dimExcept (filter dim)    |   42.5 / 59.9 ms | 197.7 / 219.9 ms |     531.0 / 557.7 ms |
| setViewport (zoom/pan)    |   17.6 / 27.9 ms |     5.4 / 9.0 ms |        9.5 / 15.7 ms |
| zoomTo node               |   0.02 / 0.16 ms |   0.03 / 0.16 ms |       0.02 / 0.17 ms |
| search filter pass        |   0.16 / 0.48 ms |   0.97 / 1.93 ms |       2.07 / 2.98 ms |
| group collapse            | 106.3 / 120.9 ms | 647.3 / 761.8 ms | 1 119.6 / 2 002.8 ms |
| group expand              |   85.5 / 86.9 ms | 414.6 / 421.0 ms | 1 015.9 / 1 056.7 ms |

`setViewport` is _model-space_ cost — raster-zoom cost is the Chromium
probe's job (`hideEdgesOnViewport` + `textureOnViewport` stay on).
Grouping at ≥5 000 is honestly slow (compound restructure + relayout:
21 s @5 000, 105 s @10 000) — the auto-cluster advisory exists because
of this row, and collapse/expand are the measured alternatives.

## Web Worker evaluation — decision: NOT shipped

Measured premise: only pure serializable computations are worker
candidates — BFS / shortest path / connected components / impact over
`FedGraph` (Cytoscape objects stay on the main thread by contract).

- Structured-clone of the canonical `FedGraph`: 14.4 ms @1 000,
  69.2 ms @5 000, **181.8 ms @10 000** — and a worker needs the clone
  **both ways** (~28 ms / ~138 ms / ~364 ms round trip).
- The work itself: full analysis bundle = 48.6 ms @1 000, 81.0 ms
  @5 000, 227.3 ms @10 000; adjacency is now memoized per graph.
- Conclusion: transfer overhead alone is a large fraction of — and at
  1 000 nodes exceeds — the compute at every measured size; a worker
  would add a build seam and latency without a measured win. Per-call
  ops (BFS, path) are even more clearly in the noise. Recorded as a
  measured rejection, re-openable if a future op outgrows ~1 s on the
  main thread.

## Chromium / real-browser figures

`e2e/perf_probe.py` gained a `graph-adaptive-layout` interaction:
toggles the canvas, reads the resolved auto pick off the toolbar and
runs a `grid` switch under CDP metric deltas (JSHeap, LayoutCount,
TaskDuration). The e2e assertion `test_graph_adaptive_layout_and_guard`
checks the auto pill's pressed state + resolved name, status-strip
settle, and that a safe pick raises no warning in real Chromium.

## Reproduce

```bash
node scripts/graph-bench.mjs                        # full auto matrix
BENCH_POLICY=off node scripts/graph-bench.mjs       # unguarded baseline
BENCH_SIZES=5000x20000 BENCH_LAYOUTS=cose node scripts/graph-bench.mjs
BENCH_LAYOUT_TIMEOUT=45000 node scripts/graph-bench.mjs
BENCH_PARTIAL=/tmp/bench.json node scripts/graph-bench.mjs  # crash-safe
.venv/bin/python e2e/perf_probe.py                  # Chromium/CDP probe
.venv/bin/python -m pytest e2e/test_browser_e2e.py -k adaptive
```

## Honest limits

- Headless jsdom numbers bound CPU-side cost only — no rasterizer; real
  paint/zoom cost belongs to the Chromium probe rows. FPS is UNTESTED —
  nothing in this document or the bench JSON claims a frame rate.
- PNG export returns `null` headless (no rasterizer) — SVG projection is
  the measured export path.
- cose wall times vary ±50 %+ between runs (observed: 46.6 s vs 75.8 s
  for the same unguarded 1 000-node graph under different CPU load); the
  _class_ is stable, the digits are not.
- At ≥2 000 nodes an explicit cose still costs a synchronous engine
  block the watchdog cannot preempt — the UI warns and asks, and the
  fallback always lands, but that single block is a hard floor.
- Synthetic graphs are random-uniform; real federated graphs are sparser
  and structured — thresholds are conservative upper bounds.
- Progressive render is per-chunk `cy.add` — between chunks the UI
  breathes; the total wall time is the same as a single add.
