// Benchmark entry — bundled by graph-bench.mjs via esbuild so the REAL
// adapter + view-model + layout-policy modules are measured, not a
// reimplementation.
//
// BENCH_POLICY=off  → pre-cycle-3 behaviour: no policy consult, the
//                     adapter's historical default (cose) runs first,
//                     no watchdog — reproduces the 2.1 measurements.
// BENCH_POLICY=auto → cycle-3 behaviour (default): the policy picks the
//                     first layout, every layout run is guarded by the
//                     measured watchdog + fallback, and cose runs with
//                     bounded iterations where the policy says so.
import fs from 'node:fs';
import { toViewModel } from '../src/app/core/graph/view-model';
import { groupingFor } from '../src/app/core/graph/view-model';
import { createCytoscapeRenderer } from '../src/app/core/graph/cytoscape-adapter';
import {
  FALLBACK_LAYOUT,
  boundedIterations,
  chooseLayout,
  graphStats,
  layoutTimeoutMs,
  scaleClass,
} from '../src/app/core/graph/layout-policy';
import { impactReport, shortestPath, connectedComponents } from '../src/app/core/graph/analysis';
import { FED_GRAPH_SCHEMA } from '../src/app/core/graph/federated';
import cytoscape from 'cytoscape';

const KINDS = ['forge', 'capability', 'skill', 'agent', 'mcp', 'host', 'operation'];

// Deterministic PRNG — same graph every run, no network.
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function synthFed(n, m, seed = 7) {
  const rnd = lcg(seed);
  const nodes = [];
  for (let i = 0; i < n; i++) {
    const kind = KINDS[i % KINDS.length];
    nodes.push({
      id: `${kind}:${i}`,
      kind,
      label: `${kind}-${i}`,
      evidence: ['agents'],
      unverified: i % 13 === 0,
      state: i % 29 === 0 ? 'FAILED' : i % 5 === 0 ? 'available' : null,
      origin: i % 3 === 0 ? `forge:${(i % Math.max(1, Math.floor(n / 97))) * KINDS.length}` : null,
      version: i % 7 === 0 ? '1.0.0' : null,
      meta: null,
    });
  }
  const edges = [];
  const seen = new Set();
  for (let i = 0; i < m; i++) {
    const a = Math.floor(rnd() * n);
    const b = Math.floor(rnd() * n);
    if (a === b) continue;
    const id = `e${i}`;
    const key = `${a}->${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id,
      source: nodes[a].id,
      target: nodes[b].id,
      kind: 'associated',
      evidence: 'agents',
    });
  }
  return {
    schema: FED_GRAPH_SCHEMA,
    nodes,
    edges,
    counts: {},
    sources: {
      bootstrap: { state: 'loaded', endpoint: 'GET /api/v1/bootstrap' },
      graphs: { state: 'loaded', endpoint: 'GET /api/v1/graphs' },
      capabilities: { state: 'loaded', endpoint: 'GET /api/v1/capabilities' },
      skills: { state: 'loaded', endpoint: 'GET /api/v1/skills' },
      agents: { state: 'loaded', endpoint: 'GET /api/v1/agents' },
      mcp: { state: 'loaded', endpoint: 'GET /api/v1/mcp/servers' },
      hosts: { state: 'loaded', endpoint: 'GET /api/v1/hosts' },
      tasks: { state: 'loaded', endpoint: 'GET /api/v1/tasks' },
    },
  };
}

const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms

/** The adapter's layout-status stream IS the completion signal:
 *  `done`/`skipped`/`cancelled` are terminal; `superseded` is followed
 *  by the next run's own terminal event; `timeout` is followed by the
 *  fallback's `done`. Counting settles makes the timer immune to a
 *  previous layout's stop interleaving AND to no-op renders (skipped
 *  emits no fit, so the old fit-counter would wait out the timeout). */
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
        // Do not let a runaway layout contaminate the next measurement:
        // cancel lands between synchronous engine blocks, never inside.
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

/** `times` rounds of `fn` — every sample is the wall time of one full
 *  call, i.e. the longest synchronous block the op produces (the
 *  long-frame equivalent in a headless host). */
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
  // BENCH_SIZES="5000x20000,750x3750" narrows the run — presets are the
  // cycle-3 matrix (the 2.1 anchors 1k/5k, 5k/20k, 10k/50k included);
  // arbitrary NxM pairs are accepted for calibration. Each preset may
  // pin `layouts`: cose is dropped from the ≥5k defaults because the
  // watchdog cannot preempt its synchronous O(n²) frame block (measured
  // >8 min at 10k) — BENCH_LAYOUTS=cose still measures it explicitly.
  const presets = [
    { n: 50, m: 150 },
    { n: 100, m: 300 },
    { n: 200, m: 800 },
    { n: 500, m: 2000 },
    { n: 1000, m: 5000 },
    { n: 2000, m: 9000 }, // cose kept: proves the watchdog+fallback path
    { n: 5000, m: 20000, layouts: ['circle', 'concentric', 'grid', 'breadthfirst'] },
    { n: 10000, m: 50000, layouts: ['circle', 'concentric', 'grid', 'breadthfirst'] },
  ];
  const wanted = (process.env.BENCH_SIZES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [n, m] = s.split('x').map(Number);
      return { n, m };
    });
  const sizes = wanted.length ? wanted : presets;
  const ALL_LAYOUTS = ['cose', 'circle', 'concentric', 'grid', 'breadthfirst'];
  const layoutOverride = (process.env.BENCH_LAYOUTS || '').split(',').filter(Boolean);
  const POLICY = process.env.BENCH_POLICY || 'auto'; // 'auto' | 'off'
  const LAYOUT_TIMEOUT = Number(process.env.BENCH_LAYOUT_TIMEOUT || 120000);
  const SAMPLES = Number(process.env.BENCH_SAMPLES || 9);
  const out = {
    env: {
      node: process.version,
      cytoscape: cytoscape.version ?? 'unknown',
      host: 'headless (jsdom — no rasterizer; FPS/raster UNTESTED)',
      policy: POLICY,
      layoutTimeoutMs: LAYOUT_TIMEOUT,
      samples: SAMPLES,
    },
    runs: [],
  };
  // BENCH_PARTIAL=<path> rewrites the whole result document after every
  // size — a crash mid-run (an unbounded layout OOMing the baseline is a
  // REAL finding, not a script bug) still leaves every completed size
  // on disk instead of losing the run to a buffered stdout.
  const partial = process.env.BENCH_PARTIAL || null;
  const dump = () => {
    if (partial) fs.writeFileSync(partial, JSON.stringify(out, null, 2));
  };
  for (const { n, m, layouts: presetLayouts } of sizes) {
    const layoutNames = layoutOverride.length ? layoutOverride : (presetLayouts ?? ALL_LAYOUTS);
    const t0 = now();
    const mark = (s) => console.error(`[bench] ${n}n/${m}e ${s} @${Math.round(now() - t0)}ms`);
    // peak RSS sampler — memory claim per size comes from this, not the
    // end-of-run reading alone
    let peakRss = 0;
    const memTimer = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }, 100);

    try {
      const fed = synthFed(n, m);
      const tSynth = now() - t0;
      const tv = now();
      const vm = toViewModel(fed);
      const tVm = now() - tv;
      mark('model built');

      // -- pipeline split ------------------------------------------------
      // Element creation isolated from layout: a throwaway headless core
      // receives the SAME element defs the adapter would build — the
      // cy.add cost separated from the layout the adapter always runs.
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

      // structured-clone cost of the canonical model — the transfer a
      // worker-based analysis would pay per call (worker-strategy input).
      const tc = now();
      const clone = structuredClone(fed);
      const tClone = now() - tc;
      mark(`clone done (${Math.round(JSON.stringify(clone).length / 1024)}KB)`);

      // policy decision (measured — it's on the mount path in the page)
      const tp = now();
      const stats = graphStats(vm.nodes, vm.edges);
      const policy = chooseLayout(stats, { preferred: null });
      const tPolicy = now() - tp;

      const guardEvents = [];
      const r =
        POLICY === 'auto'
          ? createCytoscapeRenderer({ headless: true, animate: false })
          : // 'off' = the shipped 2.1 pipeline: no watchdog, no bounded
            // iterations, full rebuild + unconditional relayout on refresh.
            createCytoscapeRenderer({
              headless: true,
              animate: false,
              guard: false,
              incremental: false,
            });
      r.onLayoutStatus((e) => guardEvents.push(e));
      const tm = now();
      r.mount(document.createElement('div'));
      const tMount = now() - tm;
      mark('renderer mounted');

      const cy = r.nativeHandle();
      const timed = makeLayoutTimer(r);
      // the page resolves the layout BEFORE setData — 'auto' pre-selects
      // the policy pick; 'off' keeps the adapter's historical default
      // (cose), reproducing the 2.1 first render.
      if (POLICY === 'auto') r.layout(policy.layout);
      const t1 = now();
      let tSet;
      try {
        // NOTE: r.setData is synchronous element creation — cy.add +
        // style application can block the loop well past the budget on
        // big graphs; the timeout only bounds the async layout wait.
        await timed(() => r.setData(vm), LAYOUT_TIMEOUT);
        tSet = Math.round(now() - t1);
      } catch {
        tSet = null; // layout never finished inside the budget — record honestly
      }
      mark('setData settled');

      // second setData of the SAME view — the refresh/round-trip path
      const t2 = now();
      let tSet2;
      try {
        await timed(() => r.setData(vm), LAYOUT_TIMEOUT);
        tSet2 = Math.round(now() - t2);
      } catch {
        tSet2 = null;
      }
      mark('setData refresh settled');

      const layouts = {};
      for (const name of layoutNames) {
        const tl = now();
        try {
          await timed(() => r.layout(name), LAYOUT_TIMEOUT);
          layouts[name] = Math.round(now() - tl);
        } catch {
          layouts[name] = null; // >budget — a real finding, not a crash
        }
        mark(
          `layout ${name} → ${
            layouts[name] === null ? `>${LAYOUT_TIMEOUT / 1000}s` : layouts[name] + 'ms'
          }`,
        );
      }

      // analysis timings on the canonical model
      const tA = now();
      const rep = impactReport(fed, fed.nodes[0].id, 3);
      connectedComponents(fed);
      const p = shortestPath(fed, fed.nodes[0].id, fed.nodes[Math.floor(n / 2)].id, 'both');
      const tAnalysis = now() - tA;
      mark('analysis done');

      // -- interaction sampling (p50/p95 over BENCH_SAMPLES rounds) ------
      const ids = fed.nodes.filter((_, i) => i % Math.max(1, Math.floor(n / SAMPLES)) === 0);
      const needle = 'forge:1';
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
        // the list-mode search path — substring over id+label, the same
        // predicate the page's `filtered` applies per keystroke
        search: sampleOp(SAMPLES, () =>
          vm.nodes.filter((x) => x.id.includes(needle) || x.label.includes(needle)),
        ),
      };
      mark('interaction samples done');

      const ts = now();
      const svg = r.exportSvg();
      const tSvg = now() - ts;
      mark('svg done');

      // grouping + collapse on 1k+
      let tGroup = null;
      let groupInteract = null;
      if (n >= 1000) {
        try {
          const spec = groupingFor(fed, 'kind');
          const tg = now();
          await timed(() => r.setGrouping({ ...spec, collapsed: new Set() }), LAYOUT_TIMEOUT);
          tGroup = Math.round(now() - tg);
          const gids = spec.groups.map((x) => x.id);
          groupInteract = {
            collapse: sampleOp(Math.min(SAMPLES, gids.length), (i) =>
              r.setGrouping({ ...spec, collapsed: new Set([gids[i % gids.length]]) }),
            ),
            expand: sampleOp(Math.min(SAMPLES, gids.length), (i) =>
              r.setGrouping({ ...spec, collapsed: new Set() }),
            ),
          };
          await timed(() => r.setGrouping(null), LAYOUT_TIMEOUT);
        } catch {
          tGroup = null;
        }
        mark('grouping done');
      }

      const td = now();
      r.destroy();
      const tDestroy = now() - td;

      const mem = process.memoryUsage();
      peakRss = Math.max(peakRss, mem.rss);
      clearInterval(memTimer);
      out.runs.push({
        nodes: n,
        edges: m,
        nodesReal: fed.nodes.length,
        edgesReal: fed.edges.length,
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
        policyEvalMs: Math.round(tPolicy * 100) / 100,
        synthMs: Math.round(tSynth * 100) / 100,
        toViewModelMs: Math.round(tVm * 100) / 100,
        structuredCloneMs: Math.round(tClone * 100) / 100,
        cyAddIsolatedMs: Math.round(tAdd * 100) / 100,
        mountMs: Math.round(tMount * 100) / 100,
        firstLayout: POLICY === 'auto' ? policy.layout : 'cose',
        setDataFirstLayoutMs: tSet,
        setDataRefreshMs: tSet2,
        layoutsMs: layouts,
        guardEvents: POLICY === 'auto' ? guardEvents : [],
        analysisMs: Math.round(tAnalysis * 100) / 100,
        impactDepth3: { uses: rep.uses.length, usedBy: rep.usedBy.length },
        pathFound: p.nodes !== null,
        interactionMs: tInteract,
        exportSvgMs: Math.round(tSvg),
        exportSvgKb: svg ? Math.round(svg.length / 1024) : 0,
        groupingLayoutMs: tGroup,
        groupingInteractMs: groupInteract,
        destroyMs: Math.round(tDestroy * 100) / 100,
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        rssMb: Math.round(mem.rss / 1048576),
        peakRssMb: Math.round(peakRss / 1048576),
        elements: cy.nodes().length + cy.edges().length,
      });
      console.error(`[bench] ${n}n/${m}e done — layouts ${JSON.stringify(layouts)}`);
    } catch (e) {
      // a size that crashes the harness (heap OOM on an unbounded
      // layout is a REAL data point) is recorded, not hidden
      clearInterval(memTimer);
      out.runs.push({
        nodes: n,
        edges: m,
        crashed: String((e && e.message) || e),
        peakRssMb: Math.round(peakRss / 1048576),
      });
      console.error(`[bench] ${n}n/${m}e CRASHED — ${String((e && e.message) || e)}`);
    }
    dump();
    if (global.gc) global.gc();
  }
  return out;
}
