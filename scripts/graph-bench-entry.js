// Benchmark entry — bundled by graph-bench.mjs via esbuild so the REAL
// adapter + view-model modules are measured, not a reimplementation.
import { toViewModel } from '../src/app/core/graph/view-model';
import { groupingFor } from '../src/app/core/graph/view-model';
import { createCytoscapeRenderer } from '../src/app/core/graph/cytoscape-adapter';
import { impactReport, shortestPath, connectedComponents } from '../src/app/core/graph/analysis';
import { FED_GRAPH_SCHEMA } from '../src/app/core/graph/federated';

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

/** The adapter calls cy.fit() inside its layoutstop handler — counting
 *  fit() calls is the reliable "a layout pass finished" signal that
 *  works for both async layouts and synchronous ones (grid), and is
 *  immune to an old layout's stop() event interleaving. */
function makeFitCounter(cy) {
  const orig = cy.fit.bind(cy);
  const box = { n: 0 };
  cy.fit = (...a) => {
    box.n++;
    return orig(...a);
  };
  return box;
}

async function waitFit(box, from, timeoutMs) {
  const t0 = now();
  while (box.n <= from) {
    if (now() - t0 > timeoutMs) throw new Error('layout timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Run `fn` (an adapter call that triggers a layout) and wait for the
 *  NEW layout's stop→fit. `running` models whether a previous layout
 *  is still in flight — its stop() during fn fires a fit inside the
 *  call, which must not be mistaken for the new layout finishing. */
function makeLayoutTimer(cy) {
  const fits = makeFitCounter(cy);
  let running = false;
  return async function timed(fn, timeoutMs) {
    const pre = fits.n;
    fn();
    const fired = fits.n - pre;
    // old stop(1 when running) + new sync-complete(1) — new done only
    // when more fits fired than a lone old-stop could produce
    if (fired > (running ? 1 : 0)) {
      running = false;
      return;
    }
    running = true;
    try {
      await waitFit(fits, fits.n, timeoutMs);
      running = false;
    } catch (e) {
      /* stays running=true — the next call's stop() will fire its fit */
      throw e;
    }
  };
}

export async function run() {
  // BENCH_SIZES="5000x20000,10000x50000" narrows the run — full matrix
  // is the default. Progress goes to stderr; the JSON result to stdout.
  const all = [
    { n: 100, m: 300 },
    { n: 1000, m: 5000 },
    { n: 5000, m: 20000 },
    { n: 10000, m: 50000 },
  ];
  const wanted = (process.env.BENCH_SIZES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sizes = wanted.length ? all.filter((s) => wanted.includes(`${s.n}x${s.m}`)) : all;
  const out = { env: { node: process.version, cytoscape: 'headless' }, runs: [] };
  for (const { n, m } of sizes) {
    const mark = (s) => console.error(`[bench] ${n}n/${m}e ${s} @${Math.round(now() - t0)}ms`);
    const t0 = now();
    const fed = synthFed(n, m);
    const vm = toViewModel(fed);
    const tVm = now() - t0;
    mark('model built');

    const r = createCytoscapeRenderer({ headless: true, animate: false });
    r.mount(document.createElement('div'));
    mark('renderer mounted');

    const cy = r.nativeHandle();
    const timed = makeLayoutTimer(cy);
    const t1 = now();
    let tSet;
    try {
      // NOTE: r.setData is synchronous element creation — cy.add +
      // style application can block the loop well past the budget on
      // big graphs; the timeout only bounds the async layout wait.
      await timed(() => r.setData(vm), 120000);
      tSet = Math.round(now() - t1);
    } catch {
      tSet = null; // layout never finished inside the budget — record honestly
    }
    mark('setData settled');

    const layouts = {};
    for (const name of ['cose', 'circle', 'concentric', 'grid', 'breadthfirst']) {
      const tl = now();
      try {
        await timed(() => r.layout(name), 120000);
        layouts[name] = Math.round(now() - tl);
      } catch {
        layouts[name] = null; // >120s — a real finding, not a crash
      }
      mark(`layout ${name} → ${layouts[name] === null ? '>120s' : layouts[name] + 'ms'}`);
    }

    // analysis timings on the canonical model
    const ta = now();
    const rep = impactReport(fed, fed.nodes[0].id, 3);
    connectedComponents(fed);
    const p = shortestPath(fed, fed.nodes[0].id, fed.nodes[Math.floor(n / 2)].id, 'both');
    const tAnalysis = now() - ta;
    mark('analysis done');

    // interaction: selection + N-hop highlight set
    const ti = now();
    r.select(fed.nodes[0].id);
    r.highlight(new Set(rep.uses.map((h) => h.id)), new Set(rep.edges.map((e) => e.id)));
    const tInteract = now() - ti;
    mark('interaction done');

    const ts = now();
    const svg = r.exportSvg();
    const tSvg = now() - ts;
    mark('svg done');

    // grouping + collapse on 1k+
    let tGroup = null;
    if (n >= 1000) {
      try {
        const tg = now();
        await timed(
          () => r.setGrouping({ ...groupingFor(fed, 'kind'), collapsed: new Set() }),
          120000,
        );
        tGroup = Math.round(now() - tg);
        await timed(() => r.setGrouping(null), 120000);
      } catch {
        tGroup = null;
      }
      mark('grouping done');
    }

    out.runs.push({
      nodes: n,
      edges: m,
      nodesReal: fed.nodes.length,
      edgesReal: fed.edges.length,
      toViewModelMs: Math.round(tVm * 100) / 100,
      setDataFirstLayoutMs: tSet,
      layoutsMs: layouts,
      analysisMs: Math.round(tAnalysis * 100) / 100,
      impactDepth3: { uses: rep.uses.length, usedBy: rep.usedBy.length },
      pathFound: p.nodes !== null,
      interactionMs: Math.round(tInteract * 100) / 100,
      exportSvgMs: Math.round(tSvg),
      exportSvgKb: svg ? Math.round(svg.length / 1024) : 0,
      groupingLayoutMs: tGroup,
      elements: cy.nodes().length + cy.edges().length,
    });
    console.error(`[bench] ${n}n/${m}e done — layouts ${JSON.stringify(layouts)}`);
    r.destroy();
    if (global.gc) global.gc();
  }
  return out;
}
