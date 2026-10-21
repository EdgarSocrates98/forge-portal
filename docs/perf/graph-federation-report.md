# Graph Explorer — federation scale report (lf-0023)

Measured run of `scripts/graph-bench-federation.mjs` (real `projection.ts` +
`view-model.ts` + `cytoscape-adapter.ts`, bundled by esbuild — same TS the app
ships). Dataset: deterministic `forge/ForgeGraphView/v1` fixtures from
`spark-forge-aws/tests/graph/fixtures/`, remapped to three provider ids and
merged through `mergeViews()` — the exact explorer path for a multi-forge
bundle. Headless jsdom + Cytoscape 3.34.3 on Node v22.23.2 (no rasterizer:
**FPS/paint untested**; numbers cover model→render→layout→interaction).

## Dataset

| Fixture (real) | Provider (remapped) | Nodes | Edges |
|---|---|---:|---:|
| `graph_10000_disconnected.json` | `synthetic-a` | 10,000 | 9,600 |
| `graph_100_chain.json` | `synthetic-b` | 100 | 99 |
| `graph_100_star.json` | `synthetic-c` | 100 | 99 |
| **merged** | — | **10,200** | **9,798** |

Connected components after merge: **402** (isolated-component handling is
exercised, not elided). Layout policy classifies the merged set as
`very-large` → `grid` (progressive, cluster overview).

## Measured results

| Phase | ms |
|---|---:|
| `mergeViews()` (3 views → namespaced `FederatedGraph`-shaped view) | 152.9 |
| `buildProjectionGraph()` (view → `FedGraph` with provenance/meta) | 516.8 |
| `connectedComponents()` | 145.7 |
| layout policy eval | 142.7 |
| `toViewModel()` | 108.2 |
| isolated `cy.add` (19,998 elements) | 2,444.1 |
| `mount()` | 32.4 |
| **`setData` + first layout (grid)** | **5,616** |
| `setData` refresh (same data again) | 1,872 |
| analysis: `impactReport` depth-3 + `shortestPath` | 402.0 |
| `destroy()` | 27.4 |

Memory: heap 316 MB, RSS 429 MB, peak RSS 429 MB.

## Interaction samples (n = 9, p50 / p95 ms)

| Op | p50 | p95 | max |
|---|---:|---:|---:|
| `select(node)` | 18.1 | 33.8 | 33.8 |
| `highlight(set)` | 820.2 | 878.4 | 878.4 |
| `dimExcept(set|null)` | 994.3 | 1,104.5 | 1,104.5 |
| `setViewport(zoom,pan)` | 21.8 | 24.5 | 24.5 |
| `zoomTo(node)` | 0.3 | 4.4 | 4.4 |
| search (label/id substring over view-model) | 4.7 | 10.4 | 10.4 |

## Reading

- **"10k-node federation renders interactive" — met within the harness.**
  First paint of the merged 10.2k-node federation settles in ~5.6 s under the
  progressive grid policy; the overview then serves as the navigation surface
  (cluster=on). Pan/zoom (`setViewport` p50 21.8 ms, `zoomTo` p50 0.3 ms),
  search (4.7 ms) and select (18.1 ms) are all comfortably inside interactive
  budgets. `highlight`/`dimExcept` restyle ~20k elements per call (~0.8–1.0 s)
  — used deliberately on selection, not continuous.
- Federation cost is additive over the single-view 10k numbers in
  `graph-scale-report.md`: merge+projection adds ≈0.82 s once per bundle
  load; per-element provenance/meta scalarization is ~0.5 s of that and is
  what makes every node/edge inspectable back to `source_provider`,
  `provenance`, `epistemic_state` and `evidence_refs`.
- `pathFound: false` is data, not a failure: node 0 and the mid-index node
  sit in different components (402-component dataset) — `shortestPath`
  honestly reports no path across isolated components.
- Caveats: headless — no paint/FPS measurement; grid is a deterministic
  placement, not force simulation (policy correctly refuses COSE at this
  scale). Browser numbers will differ; treat these as the contract-path
  bound, reproduce with `node scripts/graph-bench-federation.mjs`.
