#!/usr/bin/env node
/**
 * Graph Studio 2.1 headless benchmark — bundles the REAL adapter +
 * view-model + analysis modules (esbuild, same TS the app ships) and
 * times model→render→layout→interaction at the required sizes.
 *
 * Usage: node scripts/graph-bench.mjs [--json]
 * Numbers are written to stdout; docs/perf records them verbatim.
 */
import esbuild from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
// inside the repo so require('cytoscape') resolves via node_modules
const out = path.join(here, '.graph-bench.cjs');

esbuild.buildSync({
  entryPoints: [path.join(here, 'graph-bench-entry.js')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  external: ['cytoscape'],
  outfile: out,
  logLevel: 'silent',
});

const require = createRequire(path.join(here, '..', 'package.json'));

// jsdom window/document — cose reads cy.window() even when headless
const { JSDOM } = require('jsdom');
const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator });

const { run } = require(out);
const res = await run();
fs.unlinkSync(out);
console.log(JSON.stringify(res, null, 2));
