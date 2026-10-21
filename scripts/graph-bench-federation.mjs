#!/usr/bin/env node
/**
 * lf-0023 — Graph Explorer federation benchmark. Bundles the REAL
 * adapter + projection + view-model modules (esbuild, same TS the app
 * ships) and times model→render→layout→interaction over a multi-forge
 * merged dataset built from deterministic ForgeGraphView/v1 fixtures.
 *
 * Usage: node scripts/graph-bench-federation.mjs
 * Numbers are written to stdout; docs/perf records them verbatim.
 */
import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '.graph-bench-fed.cjs');

esbuild.buildSync({
  entryPoints: [path.join(here, 'graph-bench-federation-entry.js')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['cytoscape'],
  outfile: out,
  logLevel: 'silent',
});

const require = createRequire(path.join(here, '..', 'package.json'));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator });

const { run } = require(out);
const res = await run();
fs.unlinkSync(out);
console.log(JSON.stringify(res, null, 2));
