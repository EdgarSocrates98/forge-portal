# Forge Portal 2.2 Cycle 4 — execution & observability rendering

Measured optimization of `/observe`, `/execution`, `/tasks`, `/lab`
under synthetic event scale (50 → 10 000 `forge/PortalEvent/1`
records). Every number below comes from the real instrument —
Chromium + CDP against the production `dist/` bundle served by the
real `PortalServer`; nothing is estimated.

## Method (§7.1)

Instrument: `e2e/exec_render_probe.py` (new this cycle).

- Boots `portal_core.forge_portal.PortalServer` with `ScaleAdapter`, a
  probe-only adapter that synthesizes N events (`operation.*`,
  `task.*`, `receipt.*`, `span.*`, `hook.*`), `min(250, N/4)` task
  records and `min(400, N/5)` lab rows through the real telemetry
  recorder — same code path real events take. **Production retention
  (`DEFAULT_CAPACITY = 500`) is untouched**; the probe's adapter asks
  the recorder for a larger test buffer — that's the sanctioned stress
  path, not a limit change.
- Serves the real `ng build` output (`dist/forge-portal-app/browser`),
  drives real Chromium via Playwright + CDP.
- Per route `/observe` `/execution` `/tasks` `/lab`:
  - DOM audit in-page: `document.querySelectorAll('*').length`,
    recursive `max_depth`, per-section subtree sizes, `tbody tr`,
    `.tl__row`, `.tl__tick`, `.rp__step` counts, elements-per-event.
  - CDP `Performance.getMetrics`: `Nodes`, `JSEventListeners`,
    `JSHeapUsedSize`, `LayoutCount`, `RecalcStyleCount`,
    `TaskDuration`/`ScriptDuration`/`LayoutDuration` deltas bracketed
    around each navigation.
- Interactions bracketed the same way: free-text filter, execution
  selection, inspector open, replay step, observe correlation filter.
- Leak probe (§7.4): in-app router cycles `/execution → /dashboard →
/execution` (×3) with `HeapProfiler.collectGarbage` between cycles —
  forced GC separates real retention from GC lag. `Nodes`,
  `JSEventListeners`, `JSHeapUsedSize` sampled per cycle.
- Endpoints (§7.6): `GET /api/v1/events` (full, filtered,
  `?limit=25`) and `/api/v1/metrics` — wall ms + payload bytes via
  urllib on the same server.

Artifacts: `e2e/artifacts/exec-render-cycle4-baseline.json`
(pre-change, all 5 scales) and `e2e/artifacts/exec-render-cycle4.json`
(post-change, all 5 scales, same probe). Single-run numbers, ±20 %
run-to-run noise observed — read as orders of magnitude.

## What changed

1. **Bounded rendering via pagination** (`src/app/shared/pager.ts` —
   new `UiPager` + pure `pageSlice()`). Chosen over virtual scroll:
   every row stays keyboard- and AT-reachable (a virtual scroll would
   pull unrendered rows out of tab order and the a11y tree), the
   "X–Y of N" range text keeps the bounded view honest, and the math
   is a pure function with direct Vitest coverage. Lists keep their
   semantics via `aria-setsize`/`aria-posinset` (lists) and
   `aria-rowcount`/`aria-rowindex` (tables) — position in the real
   data is preserved, not per-page.
   - `/execution` events table ≤ 100 rows, replay steps ≤ 100,
     timeline groups ≤ 50.
   - `/observe` events table ≤ 100 rows.
   - `/tasks` history ≤ 50 rows, timeline ≤ 50 rows, detail replay
     ≤ 50 steps (page auto-follows `replayIdx`; manual paging
     possible, transport resets it).
   - `/lab` **not** paged: measured DOM is bounded by the real lab
     matrix (~400 rows → 2 493 elements) and does not scale with
     event volume — paging would add chrome without a proven win.
2. **Timeline ticks → one CSS gradient layer**
   (`buildTickGradient` in `execution.data.ts`). Placed events draw
   as hard-stop stripes in a single `background-image` on the track —
   one element total instead of one `<span class="tl__tick">` per
   event (10 000 events had produced 9 232 decorative nodes). The
   authoritative count is advertised on `data-ticks`; per-event
   records remain fully selectable/inspectable in the events table
   (the required structured alternative). Duration-backed span
   underlays (`.tl__span`) are unchanged — they're real geometry, not
   decoration.
3. **Precomputed view models + indexes** (`execution.data.ts`):
   - `buildEventRows`/`buildStepRows` — timestamps, durations, short
     ids, tones formatted once per data change, not per change-detection
     pass.
   - `buildSearchIndex` — lowercased haystack (type/status/id/
     correlation + flattened `key:value` metadata) computed once per
     buffer change; filter cost no longer re-serializes JSON per
     keystroke.
   - `buildRelationIndex` — correlation/span/parent-span maps;
     inspector `related`/`caused-by` is a map lookup instead of an
     O(N) scan per selection.
   - `observe.page.ts` gets an equivalent `ObserveRow` view model
     (formatted timestamp/duration/correlation resolved once).
4. **Lifecycle (§7.4)**: replay `setTimeout` is now registered with
   `DestroyRef.onDestroy`; page-change effects reset pager state when
   data changes; the e2e suite gained
   `test_route_changes_do_not_retain_dom_or_listeners`, which asserts
   flat Nodes/listeners slope across router cycles under forced GC.
5. **Backend (§7.6): unchanged.** Endpoints already stream a bounded
   buffer; measured cost is serialization+transfer (see below) with
   `limit=`/`?type=`/`?status=`/`?correlation_id=` filters working.
   No measured win justified touching `portal_core/telemetry.py` —
   contracts `forge/PortalEvent/1` / `forge/PortalEventReport/1`
   untouched.

## Results — DOM scale (elements / CDP Nodes / heap)

`/execution` — the audit target (~53 k nodes at 500 events in the
2.1 report, 222 k elements at 10 k in this cycle's baseline):

| events | elements before | after | Nodes before | after | heap before |   after |
| -----: | --------------: | ----: | -----------: | ----: | ----------: | ------: |
|     50 |           1 526 | 1 482 |        5 320 | 5 269 |      7.1 MB |  7.2 MB |
|    500 |          11 507 | 2 838 |       38 678 | 9 395 |     14.4 MB |  9.9 MB |
|  1 000 |          22 602 | 2 848 |       75 661 | 9 405 |     20.5 MB |  9.0 MB |
|  5 000 |         111 332 | 2 925 |      367 076 | 9 483 |     52.1 MB | 15.0 MB |
| 10 000 |         222 247 | 3 013 |      722 749 | 5 954 |     99.5 MB | 11.9 MB |

Section detail at 10 000 (before → after): events table subtree
116 708 → 1 215 elements; replay subtree 84 127 → 859; timeline
subtree 21 134 → 660; `.tl__tick` nodes 9 232 → 0 (gradient —
`data-ticks` still advertises the real placed-tick count, 886).

`/observe` (events table paged at 100):

| events | elements before | after |
| -----: | --------------: | ----: |
|    500 |           6 703 | 1 642 |
|  1 000 |          13 036 | 1 642 |
|  5 000 |          63 703 | 1 643 |
| 10 000 |         127 036 | 1 642 |

`/tasks` (history + timeline + replay paged at 50): 4 800 → 1 211
elements at ≥ 1 000 events (its table is adapter-bounded at 250 task
records; paging keeps it flat as the log grows).

`/lab`: unchanged — 2 493 elements at ≥ 1 000 events before and
after; bounded by the real matrix, not by event volume.

Elements-per-event on `/execution`: 22–30 → 0.3 at 10 000 events.
Max tree depth: 14 before and after (pagers add no depth).

## Results — interactions (wall ms, bracketed incl. 300 ms settle)

| scenario | exec filter before | after | select before | after | observe filter before | after |
| -------- | -----------------: | ----: | ------------: | ----: | --------------------: | ----: |
| 500      |                447 |   387 |           396 |   363 |                   413 |   355 |
| 5 000    |              4 176 |   380 |           954 |   374 |                   775 |   351 |
| 10 000   |              6 852 |   389 |         1 423 |   374 |                   897 |   378 |

At real scale (≤ 500 events in the live buffer) interactions were
already sub-second; the change removes the cliff, not a regression
anyone felt at 50 events.

## Results — lifecycle (§7.4)

Nodes/listeners growth over 3 router cycles `/execution ↔ /dashboard`
with forced GC per cycle:

| events | Nodes growth before |   after | listeners before | after | heap growth before |    after |
| -----: | ------------------: | ------: | ---------------: | ----: | -----------------: | -------: |
|    500 |             +53 106 | **−13** |           +2 485 | **0** |           +25.2 MB | +0.42 MB |
| 10 000 |            +167 944 |   **0** |          +21 322 | **0** |           +37.9 MB | +0.36 MB |

Methodology caveat, stated honestly: the baseline run measured the
cycles as full `page.goto` reloads (the leak probe's original form),
so its numbers conflate the giant unbounded page's retention with
renderer/GC lag across reloads. The after run measures **in-app
router navigation** (`.nav__item` clicks — the Angular destroy path)
with `HeapProfiler.collectGarbage` between cycles, which is the
metric §7.4 actually asks for. The post-change slope is flat at
every scale (per-cycle sequences in the artifact: Nodes
`[5792, 5789, 5779]` @ 500, `[5973, 5979, 5973]` @ 10 k; listeners
constant at 319). Residual heap delta (≤0.5 MB) is normal engine
noise. New e2e test
`test_route_changes_do_not_retain_dom_or_listeners` codifies the
in-app slope bound (Nodes < 500/cycle, listeners < 200/cycle under
forced GC).

## Results — endpoints (§7.6)

Unchanged backend; measured for the record (probe `ScaleAdapter`,
synthetic volumes — production buffer stays 500):

| events | GET /events |     bytes | filtered | limit=25 | GET /metrics |     bytes |
| -----: | ----------: | --------: | -------: | -------: | -----------: | --------: |
|     50 |       45 ms |    16 314 |     3 ms |     3 ms |         4 ms |    10 242 |
|    500 |       24 ms |   157 697 |     4 ms |     3 ms |        18 ms |    97 116 |
|  1 000 |       46 ms |   315 055 |     7 ms |     4 ms |        27 ms |   193 739 |
|  5 000 |      206 ms | 1 585 215 |    25 ms |     4 ms |       170 ms |   970 364 |
| 10 000 |      371 ms | 3 173 002 |    36 ms |     5 ms |       237 ms | 1 941 169 |

`limit=25` stays ~5 ms at every scale — the endpoint already serves
windowed reads; **no pagination work needed server-side** for real
traffic (500-event buffer ≈ 158 kB ≈ 24 ms on loopback). Recorded as
a known stress-boundary, not a gap.

## Results — bundle size deltas (`npm run build`)

"Before" is the pre-change production build recorded in this cycle's
log; "after" is the build in `dist/` measured by the probe run.

| chunk                 |    before |     after |        Δ |
| --------------------- | --------: | --------: | -------: |
| initial total         | 369.09 kB | 369.33 kB | +0.24 kB |
| execution-page (lazy) |  34.25 kB |  36.88 kB | +2.63 kB |
| tasks-page (lazy)     |  38.14 kB |  40.18 kB | +2.04 kB |

(observe-page chunk exists in both builds; its delta is within the
shared-chunk +0.24 kB.) No dependencies added.

## What was NOT virtualized — and why

- **Virtual scrolling / CDK**: rejected. The measured surfaces are
  lists/tables where full keyboard + AT reachability is a requirement;
  slicing keeps every record one page-turn away with native semantics,
  and CDK isn't an installed dependency — none was added.
- **`/lab` tables**: no paging — measured 2 493 elements at the
  largest synthetic matrix; bounded by real lab data, not events.
- **Backend buffer/filters**: no changes — `limit`/`type`/`status`/
  `correlation_id` already exist; at the real 500-event retention the
  endpoint is ~40 ms/158 kB. The 10 k numbers describe a probe-only
  adapter, not production.
- **Decorative vs structured**: ticks moved to a gradient only
  because the events table remains the per-record accessible path —
  the list/table alternative required by the task stays authoritative.

## Tests

- `npx ng test` (vitest via `@angular/build:unit-test`): **514 passing**
  — 493 baseline + 21 new (`pageSlice`/`UiPager` ×7, gradient/indexes/
  view-models in `execution.data.spec.ts`, pagination behaviour specs
  on `/execution` ×3, `/observe` ×1, `/tasks` ×2, plus the destroy-path
  timer test).
- `npx prettier --check`: clean.
- `python3 scripts/check_i18n.py`: 961/961 keys en + pt-BR.
- `.venv/bin/python -m pytest tests/ e2e/ -q`: e2e suite incl. the new
  route-cycle leak test (see run in cycle log).
- e2e selector updates: `.tl__tick` count assertions now read
  `data-ticks`; replay/table assertions unchanged (paged rows are
  still real rows).

## Deviations & remaining gaps

- The 10 k-event scenario exercises a probe adapter buffer, not the
  production cap — production `/events` never exceeds 500 records.
  Stress numbers document headroom, not a live exposure.
- The pre-change "leak" metric conflated huge-page DOM with GC lag;
  the post-change slope is the trustworthy signal (≈0). The e2e test
  bounds the slope going forward.
- `/observe` filter search and `/execution` interactions still scan
  the full record set in memory (index-accelerated for /execution);
  at production scale (≤ 500) this is sub-400 ms including settle
  time. If a future cycle raises retention, server-side filtering is
  the next lever — the `?limit=` path is already proven.
- Replay transport still steps through the full in-memory step list
  (by design — honest order); only the rendered window is paged.
