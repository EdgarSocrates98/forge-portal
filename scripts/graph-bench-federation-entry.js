// lf-0023 federation benchmark — same measured pipeline as
// graph-bench-entry.js, but the model is the REAL explorer path:
// ForgeGraphView/v1 fixture documents → mergeViews (federated_merge
// semantics) → buildProjectionGraph → toViewModel → renderer.
// Dataset: deterministic fixtures from spark-forge-aws/tests/graph/
// (forge/ForgeGraphView/v1, synthetic provider ids remapped per view
// to model a multi-forge merged bundle).
import fs from 'node:fs';
import path from 'node:path';
import { toViewModel } from '../src/app/core/graph/view-model';
import { createCytoscapeRenderer } from '../src/app/core/graph/cytoscape-adapter';
import {
  boundedIterations,
  chooseLayout,
  graphStats,
  scaleClass,
} from '../src/app/core/graph/layout-policy';
import { impactReport, shortestPath, connectedComponents } from '../src/app/core/graph/analysis';
import { mergeViews, buildProjectionGraph, providerCounts } from '../src/app/core/graph/projection';
import cytoscape from 'cytoscape';

// __dirname is available: the entry is bundled to CJS by the .mjs wrapper
const here = __dirname;
const FIXTURES = process.env.BENCH_FIXTURES
  ? process.env.BENCH_FIXTURES.split(',')
  : [
      'graph_10000_disconnected.json',
      'graph_100_chain.json',
      'graph_100_star.json',
    ];
const FIXDIR =
  process.env.BENCH_FIXDIR ??
  path.resolve(here, '../../spark-forge-aws/tests/graph/fixtures');
const PROVIDERS = (process.env.BENCH_PROVIDERS || 'synthetic-a,synthetic-b,synthetic-c').split(',');

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms

function loadView(name, provider) {
  const doc = JSON.parse(fs.readFileSync(path.join(FIXDIR, name), 'utf8'));
  // remap the synthetic provider so the merged dataset reads like a
  // real multi-forge bundle (descriptor + per-element provenance)
  doc.descriptor = { ...doc.descriptor, provider_id: provider };
  for (const n of doc.nodes) n.source_provider = provider;
  return doc;
}

function makeLayoutTimer(r) {
  let settled = 0;
  r.onLayoutStatus((e) => {
    if (e.type === 'done' || e.type === 'skipped' || e.type === 'cancelled') settled++;
  });
  return async function timed(fn, timeoutMs) {
    const pre = settled;
    fn();
    const t0 = now();
    while (settled === pre) {
      if (now() - t0 > timeoutMs) {
        try {
          r.cancelLayout();
        } catch {
          /* already gone */
        }
        throw new Error('layout timeout');
      }
      await new Promise((r2) => setTimeout(r2, 20));
    }
  };
}

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

function summarize(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    min: Math.round(s[0] * 100) / 100,
    p50: Math.round(pct(s, 50) * 100) / 100,
    p95: Math.round(pct(s, 95) * 100) / 100,
    max: Math.round(s[s.length - 1] * 100) / 100,
  };
}

function sampleOp(k, fn) {
  const out = [];
  for (let i = 0; i < k; i++) {
    const t = now();
    fn(i);
    out.push(now() - t);
  }
  return summarize(out);
}

export async function run() {
  const LAYOUT_TIMEOUT = Number(process.env.BENCH_LAYOUT_TIMEOUT || 120000);
  const SAMPLES = Number(process.env.BENCH_SAMPLES || 9);
  const out = {
    env: {
      node: process.version,
      cytoscape: cytoscape.version ?? 'unknown',
      host: 'headless (jsdom — no rasterizer; FPS/raster UNTESTED)',
      layoutTimeoutMs: LAYOUT_TIMEOUT,
      samples: SAMPLES,
      fixtures: FIXTURES,
      providers: PROVIDERS,
    },
    runs: [],
  };

  const views = FIXTURES.map((f, i) => loadView(f, PROVIDERS[i % PROVIDERS.length]));

  const t0 = now();
  let peakRss = 0;
  const memTimer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 100);
  const mark = (s) => console.error(`[fedbench] ${s} @${Math.round(now() - t0)}ms`);

  try {
    // -- model build: the explorer's real path ------------------------
    const tm = now();
    const merged = mergeViews(views);
    const tMerge = now() - tm;
    mark('mergeViews done');

    const tb = now();
    const fed = buildProjectionGraph(merged, 'loaded');
    const tBuild = now() - tb;
    mark('buildProjectionGraph done');

    const tp0 = now();
    const providers = providerCounts(fed);
    const comps = connectedComponents(fed);
    const tComps = now() - tp0;
    mark(`components=${comps.length} providers=${providers.length}`);

    const tv = now();
    const vm = toViewModel(fed);
    const tVm = now() - tv;
    mark('toViewModel done');

    // isolated cy.add on the same element defs the adapter produces
    const defs = [
      ...vm.nodes.map((x) => ({
        data: { id: x.id, label: x.label, dlabel: x.label, kind: x.kind },
      })),
      ...vm.edges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, kind: e.kind },
      })),
    ];
    const probe = cytoscape({ headless: true, elements: [] });
    const ta = now();
    probe.add(defs);
    const tAdd = now() - ta;
    probe.destroy();
    mark('isolated cy.add done');

    const tp = now();
    const stats = graphStats(vm.nodes, vm.edges);
    const policy = chooseLayout(stats, { preferred: null });
    const tPolicy = now() - tp;

    const guardEvents = [];
    const r = createCytoscapeRenderer({ headless: true, animate: false });
    r.onLayoutStatus((e) => guardEvents.push(e));
    const tmn = now();
    r.mount(document.createElement('div'));
    const tMount = now() - tmn;
    mark('renderer mounted');

    const timed = makeLayoutTimer(r);
    r.layout(policy.layout);
    const t1 = now();
    let tSet;
    try {
      await timed(() => r.setData(vm), LAYOUT_TIMEOUT);
      tSet = Math.round(now() - t1);
    } catch {
      tSet = null;
    }
    mark('setData settled');

    const t2 = now();
    let tSet2;
    try {
      await timed(() => r.setData(vm), LAYOUT_TIMEOUT);
      tSet2 = Math.round(now() - t2);
    } catch {
      tSet2 = null;
    }
    mark('setData refresh settled');

    const n = fed.nodes.length;
    const tA = now();
    const rep = impactReport(fed, fed.nodes[0].id, 3);
    const p = shortestPath(fed, fed.nodes[0].id, fed.nodes[Math.floor(n / 2)].id, 'both');
    const tAnalysis = now() - tA;
    mark('analysis done');

    const ids = fed.nodes.filter((_, i) => i % Math.max(1, Math.floor(n / SAMPLES)) === 0);
    const needle = fed.nodes[Math.floor(n / 3)].id;
    const tInteract = {
      select: sampleOp(SAMPLES, (i) => r.select(ids[i % ids.length].id)),
      highlight: sampleOp(SAMPLES, () =>
        r.highlight(new Set(rep.uses.map((h) => h.id)), new Set(rep.edges.map((e) => e.id))),
      ),
      dimExcept: sampleOp(SAMPLES, (i) =>
        r.dimExcept(i % 2 === 0 ? new Set(ids.map((x) => x.id)) : null),
      ),
      setViewport: sampleOp(SAMPLES, (i) =>
        r.setViewport({ zoom: 0.5 + (i % 5) * 0.3, panX: i * 40, panY: -i * 25 }),
      ),
      zoomTo: sampleOp(SAMPLES, (i) => r.zoomTo(ids[i % ids.length].id)),
      search: sampleOp(SAMPLES, () =>
        vm.nodes.filter((x) => x.id.includes(needle) || x.label.includes(needle)),
      ),
    };
    mark('interaction samples done');

    const td = now();
    r.destroy();
    const tDestroy = now() - td;

    const mem = process.memoryUsage();
    peakRss = Math.max(peakRss, mem.rss);
    clearInterval(memTimer);
    out.runs.push({
      nodes: fed.nodes.length,
      edges: fed.edges.length,
      components: comps.length,
      providers,
      stats,
      policy: {
        scale: scaleClass(stats),
        layout: policy.layout,
        expensive: policy.expensive,
        timeoutMs: policy.timeoutMs,
        progressive: policy.progressive,
        cluster: policy.cluster,
        coseNumIter: boundedIterations(stats),
      },
      mergeViewsMs: Math.round(tMerge * 100) / 100,
      buildProjectionMs: Math.round(tBuild * 100) / 100,
      componentsMs: Math.round(tComps * 100) / 100,
      policyEvalMs: Math.round(tPolicy * 100) / 100,
      toViewModelMs: Math.round(tVm * 100) / 100,
      cyAddIsolatedMs: Math.round(tAdd * 100) / 100,
      mountMs: Math.round(tMount * 100) / 100,
      firstLayout: policy.layout,
      setDataFirstLayoutMs: tSet,
      setDataRefreshMs: tSet2,
      analysisMs: Math.round(tAnalysis * 100) / 100,
      impactDepth3: { uses: rep.uses.length, usedBy: rep.usedBy.length },
      pathFound: p.nodes !== null,
      interactionMs: tInteract,
      destroyMs: Math.round(tDestroy * 100) / 100,
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      rssMb: Math.round(mem.rss / 1048576),
      peakRssMb: Math.round(peakRss / 1048576),
      elements: r.nativeHandle()
        ? r.nativeHandle().nodes().length + r.nativeHandle().edges().length
        : fed.nodes.length + fed.edges.length,
    });
    console.error(`[fedbench] done — ${fed.nodes.length}n/${fed.edges.length}e`);
  } catch (e) {
    clearInterval(memTimer);
    out.runs.push({ crashed: String((e && e.message) || e), peakRssMb: Math.round(peakRss / 1048576) });
    console.error(`[fedbench] CRASHED — ${String((e && e.message) || e)}`);
  }
  return out;
}
