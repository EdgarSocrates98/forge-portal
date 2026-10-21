# CLI `graph ui` ↔ Portal `/graph` — feature parity matrix (lf-0023)

Counterpart to `forge-cli/docs/graph/modes-verification.md`. Both surfaces
render the **same `forge/ForgeGraphView/v1` documents** — parity is proven
at contract level by:

- `spark-forge-aws/tests/test_portal_graph_parity.py` — builds a real
  code-intel SQLite index, runs `graph view` (the projection the CLI studio
  opens) and `SparkForgePortal._graphs()` (the `/api/v1/graphs` endpoint),
  normalizes both to the JSON wire form and asserts identical documents,
  node-id sets and edge-id sets; also asserts the no-graph refusal is
  consistent.
- `the-forge/tests/test_portal_graph_parity.py` — captures the merged view
  passed to `open_studio()` by `_cmd_graph_view --federated --ui` and
  compares it with `TheForgePortal._graphs()`. `federation_notes` is
  excluded from the document compare: it is a portal-side transport
  diagnostic that the CLI reports on stderr — same information, different
  channel, **not graph data**.

## Navigation matrix

| Capability | CLI `graph ui` (graphstudio) | Portal `/graph` (Graph Studio) | Parity |
|---|---|---|---|
| Data source | `graphview.build_view()` / `federated_views()` + `federated_merge()` | `GET /api/v1/graphs` per registered forge → `projection.ts` `mergeViews()` + `buildProjectionGraph()` | ✅ same contract, byte-identical docs |
| Overview (large graphs) | `computeClusters()` ≤ 250 clusters, drill-down | layout-policy `cluster` overview on `very-large` scale | ✅ equivalent bounded overview |
| Explore / neighborhood | BFS `depth`/`cap` + `expandNode` | neighborhood expand on node + impact/blast report | ✅ |
| Full mode | `FULL_BUDGET` 10k nodes / 30k edges, visible truncation notice | deterministic node window + `setData`, no silent drop (windowed data labelled) | ✅ truncation never silent on either side |
| Search | `/` substring id/label, highlight + fit | search box, substring id/label, select + `zoomTo` | ✅ |
| Kind filters | node-kind & edge-kind checkboxes | kind filter chips + edge-kind filter | ✅ |
| Pan / zoom | arrows, `+`/`-`, minimap click | Cytoscape pan/zoom + `setViewport`, `zoomTo`, fit | ✅ (no minimap — known gap below) |
| Inspector | id/kind/label/attrs/degree/neighbors/evidence + edge endpoints, provenance, epistemic_state, confidence, temporal | inspector panel: same fields + `meta`, `prov`, per-edge provenance row | ✅ plus portal shows provider chip |
| Provenance / epistemic | `provenance`, `epistemic_state`, `evidence_refs` in inspector; cluster edges marked `cluster-rollup` | preserved verbatim through `projection.ts`; unknown engine kinds keep their kind string (deterministic fallback style, never remapped) | ✅ honest semantics |
| Federation | `graph --federated --ui`: provider-namespaced ids, notes → stderr | view scope `federation`: provider chips, per-provider counts, notes as source banners; scope `engine`: per-view single-forge projection | ✅ parity test green |
| Isolated components | components counted/rendered; no cross-forge edges inferred | `connectedComponents` counted in stats; components preserved (402/402 in 10k bench) | ✅ |
| Layouts | seeded mulberry32 layout, deterministic | deterministic layout policy: `grid`/COSE by scale class | ⚠ different engines, both deterministic & bounded |
| Path / blast analysis | BFS path ≤12 hops, blast ≤6 hops ≤800 | `shortestPath`, `impactReport` depth-N | ✅ bounded both sides |
| Snapshots / export | browser localStorage prefs | saved views, PNG/SVG export | Portal extra |
| No-graph state | CLI refusal message | empty state + source availability banners | ✅ consistent |

## Known differences (honest)

- **Renderer**: CLI studio is the vendored `_graphstudio.py` script (custom
  canvas sim); Portal uses Cytoscape under `cytoscape-adapter.ts`. Both are
  deterministic; pixel parity is not claimed — **projection parity is**.
- **Minimap**: CLI has one; Portal relies on fit/`zoomTo`/viewport.
- **Time-slice physics**: CLI sims run in RAF slices; Portal's progressive
  layout is policy-driven. Not a data-parity concern.
- **`federation_notes`**: embedded in the portal `/graphs` payload vs.
  stderr lines in the CLI. Diagnostics, not graph data.
- **Persistence**: CLI saves prefs per `graph_id` in localStorage; Portal
  uses its saved-view service.

## Scale evidence

- Portal 10k federation (10,200 n / 9,798 e / 402 components / 3
  providers): `docs/perf/graph-federation-report.md` — first layout 5.6 s,
  viewport ops ≤ 25 ms, select 18 ms, search 4.7 ms.
- Portal single-forge 10k: `docs/perf/graph-scale-report.md`.
- CLI studio 10k/25k overview: `forge-cli/docs/graph/modes-verification.md`
  (250-cluster overview stable in 8.1 s / 10.5 s headless).
