# Graph Studio — scale & performance report (Portal 2.2, Cycle 3)

Measured 2026-10-18 on `portal-2.2/cycle3-graph-perf`. Every number below
comes from a real run — headless figures from
`node scripts/graph-bench.mjs` (bundles the real adapter, view-model,
analysis and layout-policy modules through esbuild and times them under
jsdom headless, Node v22.23.2, Cytoscape 3.34.3), raster/interaction
figures from the Chromium/CDP probe (`e2e/perf_probe.py`). No estimates,
no invented rows.

## Pipeline audit — where the time goes

Canonical path: `FedGraph → toViewModel → setData (element defs +
cy.add/remove/diff) → layout (guarded) → render → interaction`.

Measured phases, cycle-3 adapter, policy `auto`:

| phase | 100/286 | 1 000/4 982 | 5 000/19 992 | 10 000/49 983 |
| ----- | ------: | ----------: | -----------: | ------------: |
| `toViewModel` | 0.19 ms | 3.09 ms | 15.7 ms | 49.3 ms |
| `structuredClone(FedGraph)` | 0.85 ms | 12.9 ms | 66.2 ms | 206 ms |
| policy `chooseLayout` | 0.46 ms | 2.83 ms | 22.3 ms | 60.2 ms |
| isolated `cy.add` (all elements) | 6.9 ms | 117 ms | 577 ms | 1 812 ms |
| **setData + first layout** | **1 114 ms** | **253 ms** | **1 133 ms** | **3 056 ms** |
| setData refresh (same view) | 5 ms | 52 ms | 366 ms | 577 ms |
| analysis (impact d3 + components + path) | 1.63 ms | 23.1 ms | 123 ms | 240.5 ms |
| SVG export | 4 ms | 39 ms | 167 ms | 423 ms (7.4 MB) |
| peak RSS | 190 MB | 380 MB | 887 MB | 1 526 MB |

`setData + first layout` includes the policy-resolved layout. Before
(2.1 baseline, first render always ran cose, full element wipe every
refresh): 1 196 ms @100, **44 270 ms @1 000, >120 s @5 000
(~60 s synchronous) and @10 000 (~280 s synchronous)**. The after
column is ~175× faster at 1 000 and turns the two frozen rows into
~1–3 s interactive mounts.

## Measured layout costs (headless, guarded)

`guardEvents` in the bench JSON prove each cell's finish state —
`done` = natural, `t:` = watchdog-fired timeout.

| layout | 50 | 100 | 200 | 300 | 500 | 1 000 | 2 000 | 5 000 | 10 000 |
| ------ | --: | --: | --: | --: | --: | ----: | ----: | ----: | ------: |
| cose | 708 ms | 1 116 ms | 2 622 ms | 2 342 ms¹ | 5 698 ms¹ | 23 007 ms¹ | **timeout @35.3 s²** | **timeout @71.9 s²** | **>8 min, killed³** |
| circle | 8 ms | 6 ms | 10 ms | 28 ms | 40 ms | 60 ms | 129 ms | 353 ms | 848 ms |
| concentric | 8 ms | 9 ms | 16 ms | 28 ms | 35 ms | 94 ms | 185 ms | 444 ms | 1 163 ms |
| grid | 5 ms | 6 ms | 8 ms | 19 ms | 25 ms | 62 ms | 172 ms | 383 ms | 798 ms |
| breadthfirst | 23 ms | 40 ms | 91 ms | 154 ms | 219 ms | 738 ms | 1 069 ms | 2 938 ms | 6 834 ms |

¹ bounded iterations (300) applied — the policy's medium budget.
² watchdog killed the run; grid fallback painted in <0.5 s after.
³ the run was killed at ~8 min while still inside cose — see
*Watchdog bounds* below; recorded as "does not finish", not a number.

## Adaptive policy — validated thresholds

`layout-policy.ts` classes and their bench justification:

| class | nodes | auto pick | evidence |
| ----- | ----: | --------- | -------- |
| `small` | ≤ 250 | `cose` (or `concentric` when density > 14, `grid` when fragmented) | cose 0.7–2.6 s — acceptable force quality at this size |
| `medium` | ≤ 1 200 | `concentric` | cose 2.3 s (300n) → 23 s (1 000n): viable but visibly slow → `warn` for user picks |
| `large` | ≤ 6 000 | `grid` | cose watchdog-killed at 35–72 s → `blocked` (confirm required) |
| `very-large` | > 6 000 | `grid` + progressive render + cluster advisory | cose catastrophic; flat canvas needs chunking (60 k elements) and the grouped overview |

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
  immediately. Measured: cose@2 000 stopped at **35 326 ms** (30 s
  budget + ~5 s in-flight frame), cose@5 000 at **71 880 ms**.
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
**`budget + the currently executing synchronous block`**: ~5 s at 2 000
nodes, ~42 s at 5 000, and at 10 000 the block itself exceeded the bench
patience (~8 min, killed). Cancellation lands at the same granularity —
between blocks, not inside one. This is why the policy `blocked` tier
exists at all: at large scale the only honest protection is to not run
cose (auto) or to require an explicit confirm (user pick, still
bounded iterations + watchdog).

## Initial-render improvements — what shipped and why

Each change below is on the measured hot path:

| optimisation | measured effect |
| ------------ | --------------- |
| incremental reconcile (diff/remove/field-sync instead of wipe) | same-view `setData` 44 270 ms → **52 ms** @1 000; >120 s → **366 ms** @5 000 |
| `skipped` layout when ≤ ~10 % of nodes are new + deterministic neighbour-seeded positions | refresh keeps canvas positions; no relayout cost at all |
| progressive chunked `cy.add` (>8 000 elements, 2 000/chunk, yields between) | 10 k/50 k first render interactive; `progress` events streamed during the pass (bench events show 30 progress ticks) |
| policy pre-pick riding `setData` opts | the layout choice applies to the new elements — no wasted relayout of the outgoing set |
| `toggleClass` honesty flags + shallow field diff | per-element restyle only when fields actually changed |
| analysis adjacency memo (WeakMap per FedGraph) | chained analyses (impact + components + path) pay the O(E) index once |
| per-node `norm()` cache (WeakMap per FedNode) | filter typing no longer re-normalizes 10 k ids+labels per keystroke |

Not shipped — measured first, found wanting:

- **position cache across rebuilds** — unnecessary: the diff path
  already preserves positions for kept elements, and a rebuild of a
  changed model legitimately re-lays out.
- **further label culling** — zoom tiers already gate label cost and the
  measured bottleneck was element creation + cose, not styling.

## Interaction performance (headless, p50 / p95, n=9)

| interaction | 1 000/4 982 | 5 000/19 992 | 10 000/49 983 |
| ----------- | ----------: | -----------: | ------------: |
| select | 2.42 / 2.94 ms | 9.91 / 15.19 ms | 22.84 / 28.46 ms |
| highlight (neighbourhood) | 38.6 / 47.8 ms | 232.8 / 249.5 ms | 499.7 / 675.7 ms |
| dimExcept (filter dim) | 42.2 / 48.2 ms | 209.4 / 256.3 ms | 541.7 / 595.7 ms |
| setViewport (zoom/pan) | 14.7 / 21.8 ms | 3.6 / 4.6 ms | 9.8 / 13.2 ms |
| zoomTo node | 0.02 / 0.16 ms | 0.02 / 0.15 ms | 0.05 / 0.99 ms |
| search filter pass | 0.14 / 0.48 ms | 0.32 / 1.41 ms | 0.88 / 2.75 ms |
| group collapse | 100.5 / 107.7 ms | 469.5 / 845.4 ms | 2 471.7 / 3 873.2 ms |
| group expand | 83.7 / 93.4 ms | 418.6 / 457.4 ms | 929.6 / 1 187.4 ms |

`setViewport` is *model-space* cost — raster-zoom cost is the Chromium
probe's job (`hideEdgesOnViewport` + `textureOnViewport` stay on).
Collapse/expand at 10 k is honestly slow (compound restructure) — the
auto-cluster advisory exists because of this row.

## Web Worker evaluation — decision: NOT shipped

Measured premise: only pure serializable computations are worker
candidates — BFS / shortest path / connected components / impact over
`FedGraph` (Cytoscape objects stay on the main thread by contract).

- Structured-clone of the canonical `FedGraph`: 12.9 ms @1 000,
  66 ms @5 000, **206 ms @10 000** — and a worker needs the clone
  **both ways** (~132 ms / ~412 ms at the two large sizes).
- The work itself: full analysis bundle = 23 ms @1 000, 123 ms @5 000,
  241 ms @10 000; adjacency is now memoized per graph.
- Conclusion: transfer overhead alone ≈ or exceeds the compute at every
  measured size — a worker would make the operation *slower* while
  adding a worker-build seam. Per-call ops (BFS, path) are even more
  clearly in the noise. Recorded as a measured rejection, re-openable
  if a future op outgrows ~1 s on the main thread.

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
BENCH_SIZES=2000x9000 BENCH_LAYOUTS=cose node scripts/graph-bench.mjs
BENCH_LAYOUT_TIMEOUT=45000 node scripts/graph-bench.mjs
.venv/bin/python e2e/perf_probe.py                  # Chromium/CDP probe
.venv/bin/python -m pytest e2e/test_browser_e2e.py -k adaptive
```

## Honest limits

- Headless jsdom numbers bound CPU-side cost only — no rasterizer; real
  paint/zoom cost belongs to the Chromium probe rows.
- cose wall times vary ±20 %+ between runs (observed: 95 s vs 235 s for
  the same guarded 5 k run under different CPU load); the *class* is
  stable, the digits are not.
- At ≥2 000 nodes an explicit cose still costs a synchronous engine
  block the watchdog cannot preempt — the UI warns and asks, and the
  fallback always lands, but that single block is a hard floor.
- Synthetic graphs are random-uniform; real federated graphs are sparser
  and structured — thresholds are conservative upper bounds.
- Progressive render is per-chunk `cy.add` — between chunks the UI
  breathes; the total wall time is the same as a single add.
