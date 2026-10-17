# Graph Studio 2.0 — renderer decision

Date: 2026-10-17 · Branch: `feat/graph-studio-canvas`

## Requirement

§5.6 canvas: pan/zoom/drag, node and edge selection, neighborhood
highlight, ≥3 switchable layouts, PNG/SVG export, per-kind shape+color,
honesty states (unverified → dashed, absent → dimmed). The engine must
stay behind the `GraphRenderer` contract
(`src/app/core/graph/renderer.ts`) so business code never imports it,
and it must not enter the initial JS bundle.

## Candidates compared

| | **Cytoscape.js 3.34** | **Sigma.js 3** | plain D3/SVG |
|---|---|---|---|
| Integration | single `cytoscape()` factory, headless mode for tests | needs `graphology` as data model + event wiring | hand-rolled everything |
| Perf at our scale (≤ a few hundred nodes) | canvas renderer, fine | WebGL — overkill, adds ctx dep | SVG DOM, fine but manual |
| Bundle | ~448 kB lazy chunk (measured `ng build`) | ~140 kB + graphology ~120 kB, still lazy | 0 |
| Built-in layouts | cose, concentric, grid, circle, breadthfirst, random — ≥3 free | none — requires `graphology-layout` + own tick loop | none |
| Export | `cy.png()` raster; SVG projected deterministically from positions | png via canvas snapshot; no svg | trivial SVG, no PNG |
| Headless testing | `headless: true` — layouts, selection, classes all run in jsdom | needs WebGL context — jsdom can't | trivial |
| a11y | canvas is not screen-readable — mitigated by keeping the list view (same selection state) | same | SVG is DOM, best a11y |
| License / maintenance | MIT, active (3.34.3 pinned — published 2026-09-07, >7 days before install) | MIT, active | — |

## Decision: Cytoscape.js

Two blockers decided it:

1. **Layouts are required by the spec** (≥3 switchable). Cytoscape
   ships them built-in; Sigma and D3 both push layout to extra
   packages or hand-rolled code.
2. **Headless mode** (`headless: true`) runs the full element model —
   layout positions, selection, classes — under vitest/jsdom, so the
   adapter is testable end-to-end minus raster. Sigma needs a real
   WebGL context.

Cost accepted: ~448 kB lazy chunk, loaded only when the user opens
Canvas view (`await import('../../core/graph/cytoscape-adapter')` in
`graph.page.ts`). Initial bundle unchanged — verified in `ng build`
output. Sigma would be smaller but lacks built-in layouts and
jsdom-testable headless mode.

## What did not make it

- **Canvas a11y**: canvas pixels are invisible to screen readers. The
  list view stays as the default, accessible surface — the toggle
  preserves selection both ways, and the canvas container carries
  `role="application"` + `aria-label`.
- **PNG in tests**: jsdom has no 2D rasterizer, so `exportPng()`
  honestly returns `null` there (adapter catches cytoscape's "headless
  instance can not render images"). SVG export is a deterministic
  position projection, so it is fully testable.
- **"absent" vs "unverified"**: `FedNode` carries a single honesty
  flag. The view model derives `absent` only from existing data —
  `unverified && every evidence source stayed 'unavailable'` — mapped
  to a stronger opacity. No model field was invented.
