# Graph Studio 2.1 — Cycle 2 architecture audit & decisions

Status: implemented on `feat/portal-2.1-cycle2`. This document is the
audit-first record: what Cycle 1 already did, what Cycle 2 added,
where the honesty boundaries are, and what is explicitly UNVERIFIED.

## 1. Audit of the Cycle 1 baseline

Read first, before any change:

| Surface            | File                                      | Finding                                                                                                            |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Renderer contract  | `src/app/core/graph/renderer.ts`          | Engine-agnostic `GraphRenderer` (mount/setData/select/highlight/dim/layout/zoomTo/fit/export + events). 4 layouts. |
| Renderer adapter   | `src/app/core/graph/cytoscape-adapter.ts` | Sole cytoscape importer; lazy-loaded; headless-capable; own SVG projection export; PNG honestly `null` headless.   |
| Canonical model    | `src/app/core/graph/federated.ts`         | `forge/FederatedGraph/v1` — nodes/edges only from descriptor-declared fields or endpoint data. No inferred edges.  |
| View model         | `src/app/core/graph/view-model.ts`        | Pure `FedGraph → GraphViewModel` map: label, kind, unverified, absent.                                             |
| Page               | `src/app/pages/graph/graph.page.ts`       | Sources strip, search + kind filters, list/canvas toggle, inspectors, impact list, layout pills, export.           |
| Entity links       | `src/app/core/graph/entity-link.ts`       | Real routes only; `null` for kinds with no owning page.                                                            |
| Selection/search   | page + adapter                            | Shared `selected`/`selectedEdge` signals; canvas taps map back to the same signals.                                |
| Layouts            | adapter                                   | `cose`, `concentric`, `grid`, `breadthfirst` (4 — cycle required ≥5).                                              |
| Export             | adapter + page                            | `ForgeFederatedGraph/v1` JSON, real SVG projection, PNG only when a rasterizer exists.                             |
| Accessibility      | page + `a11y.spec` + axe e2e              | List view is the AT path; canvas `role="application"`; AA contrast fixed by opaque node surfaces.                  |
| Lazy loading       | page (`import()` in `mountCanvas`)        | cytoscape chunk stays out of initial bundle.                                                                       |
| Input sanitization | `view-model`/`adapter`                    | SVG export escapes labels via `esc()`; ids never injected into markup.                                             |

### Gaps found (all real, none assumed)

1. View model carried only `id/label/kind/unverified/absent` — real
   fields the model already knew (`state`, `origin`, `version`,
   `meta`, descriptor categories) never reached the canvas or the
   inspector.
2. Edges had no evidence-tier styling — `unverified`/`absent` existed
   on nodes only; edge evidence availability was invisible.
3. Impact panel was a flat direct-neighbor list — no depth, no paths,
   no cycles, no coverage statement.
4. Four layouts, no grouping, no cluster collapse.
5. No saved views, no snapshot/diff, no viewport persistence.
6. No zoom-tiered labels, no node icons on canvas (canvas showed dots
   while the app vocabulary is iconographic).
7. No failure signal for nodes whose descriptor state reports
   FAILED/DEGRADED/BLOCKED or a nonzero task exit code.

## 2. Decisions

- **Keep cytoscape 3.34.3**, keep it the only renderer behind
  `GraphRenderer`. Business code never imports it (lint-visible:
  `cytoscape` appears only in the adapter + its spec + the bench).
- **Canonical analysis in `src/app/core/graph/analysis.ts`** — pure
  functions over `FedGraph`: `bfs`, `shortestPath`, `connectedComponents`,
  `findCycles` (SCC via iterative Tarjan), `dependencies`, `dependents`,
  `reachable`, `orphans`, `impactReport`. The adapter knows nothing
  about them; the page composes reports and pushes highlight sets.
- **Rich nodes show real fields only.** `FedNode` gained optional
  `state/category/origin/version/meta` — all copied verbatim from
  descriptors (`federated.ts`); the view model derives `degree`,
  `failed` (state ∈ {FAILED, DEGRADED, BLOCKED, failed, error} or
  `meta.exit_code` ≠ 0) and `absent` — derived display flags, never
  domain facts.
- **Zoom tiers**: far < 0.6 = label only; mid < 1.35 adds
  `state · category · origin · version` (present fields only);
  near adds a `{degree} rel` line. Tier churn is skipped over
  `TIER_MAX_NODES` (4000) — far labels stay; measured below.
- **Edges**: `EDGE_LINE` maps evidence availability → solid/dashed/
  dotted; kind mapped to color; labels appear mid+. No simulated
  traffic animation — the model carries no temporal edge data, so
  none is drawn.
- **Layouts**: five — `cose` (force), `circle` (radial), `concentric`,
  `grid`, `breadthfirst` (BFS/hierarchical). `circle` added; the rest
  retuned (`animate` only when motion allowed).
- **Grouping**: `groupingFor(fed, 'kind' | 'forge' | 'host')` builds
  compound parents from _declared_ fields only (`node.origin`,
  `mcp → host` bound edges for host grouping). Nodes without a
  declared parent stay ungrouped — no fake bucket. Collapse hides
  members + their incident edges and counts them on the parent label.
- **Saved views**: `forge-portal/graph-view/v1` in localStorage —
  mode, layout, query, kind, selection, viewport, grouping, collapsed
  set. `loadViewState` validates the schema and returns `null` on
  anything malformed (never partially restores garbage). Reset-view
  clears it.
- **Snapshots/diff**: no backend snapshot API exists, so the honest
  feature is user-captured: `captureSnapshot` stores a canonical copy
  under `forge-portal/graph-snapshot/v1`; `diffSnapshots` produces
  added/removed/changed nodes+edges; the canvas marks still-present
  elements (`diff-added`/`diff-changed` classes). Removed elements are
  listed in the diff panel (they no longer exist to highlight —
  listing is the honest rendering).
- **Motion**: `animate` option gates layout animation + selection
  transitions; the page passes
  `!matchMedia('(prefers-reduced-motion: reduce)')`. Headless forces
  instant regardless.
- **Perf hints on by default**: `hideEdgesOnViewport` +
  `textureOnViewport` + `pixelRatio:'auto'` — raster-time only, data
  untouched; edges reappear when the camera settles.
- **Icons**: `iconPath()` moved to `src/app/shared/icon-paths.ts`
  (DOM-free) so the adapter inlines the same lucide paths as
  `<ui-icon>` as SVG data URIs — one icon set, two painters.

## 3. Honesty boundaries (hard rules enforced)

- No inferred edges: every `FedEdge` still comes from a declared field
  (`declares`, `origin`, `associated`, `bound_to`) or a real endpoint
  row.
- `unverified`/`absent` semantics unchanged: unverified = no loaded
  endpoint confirmed the entity; absent = unverified ∧ all evidence
  unavailable.
- The impact panel is labelled _topological_ in both locales; it
  cannot claim runtime/operational impact — it states what the
  declared topology connects, plus coverage (`loaded/total` sources)
  and the names of missing sources.
- Snapshot diff compares only user-captured snapshots with the live
  model — no synthetic history.
- Timestamps shown only when real (`Source.loadedAt`, bootstrap
  `refreshedAt`, snapshot `capturedAt`).

## 4. Accessibility

- List view remains the accessible path — canvas pixels are not
  screen-readable; selection is shared list↔canvas.
- Every new interactive control has a real label (depth pills,
  direction pills, group chips, toolbar) — `a11y.spec.ts` static audit
  - axe e2e cover them.
- Evidence states use line _style_ (not color alone) — solid/dashed/
  dotted are perceivable without hue; the legend documents them.
- `role="group"` regions carry `aria-label`; hover status line is a
  polite live region substitute for canvas tooltips.

## 5. Bundle & performance

- `npm run build` clean (no warnings on this branch).
- Lazy chunks: `cytoscape-adapter` 452.98 kB raw / 122.89 kB transfer;
  `graph-page` 52.52 kB raw / 12.74 kB transfer; initial 366.58 kB /
  95.55 kB. (Cycle 1 baseline: adapter 448.51/121.45, page 24.12/6.29,
  initial 352.35/92.98 — the page grew with the studio surface; the
  adapter grew +4 kB with tiers/groups/diff.)
- Measured render/layout/analysis numbers live in
  `docs/perf/portal-2.1-benchmarks.md` — real headless runs, including
  the honest cose ≥5k timeout. Two engine bugs were found by that
  benchmark and fixed in the adapter: synchronous cose freezing the
  event loop for reduced-motion users, and `destroy()` racing a queued
  layout frame into a cytoscape `endBatch` crash.

## 6. UNVERIFIED / skipped

- **PNG export in headless hosts** — `exportPng()` returns `null`;
  real raster only in Chromium (e2e verifies painted pixels, not the
  file).
- **Edge tooltips** — canvas has no DOM tooltips; the hover status
  line + edge inspector are the accessible substitutes.
- **Operational impact** — deliberately not implemented: topology is
  not runtime evidence.
- **Derived edge tier** — the model has no derived relations today;
  the visual vocabulary reserves no style for them (solid/dashed/
  dotted already encode evidence availability).
- **cose at 10k** — exceeded the 120 s budget headless; `circle`,
  `concentric`, `grid`, `breadthfirst` remain instant at that size
  (numbers in the benchmark doc). The app default stays `cose` for
  real-world graph sizes (hundreds of nodes); at 5k+ the toolbar
  offers the scalable layouts.
