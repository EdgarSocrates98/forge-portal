#!/usr/bin/env node

/**
 * Forge Portal's portable terminal companion.
 *
 * The browser remains the primary surface, but every Forge needs a small,
 * useful terminal entry point for discovery, diagnostics and installation.
 * This file intentionally uses only Node built-ins so it works after a plain
 * `npm install`, in a workspace checkout, or through `npm link`.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORTAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_ROOT = path.join(PORTAL_ROOT, 'dist', 'forge-portal-app', 'browser');
const TTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const VERSION = '1.1.1';

const status = () => ({
  schema: 'forge-portal/cli/v1',
  forge: 'forge-portal',
  version: VERSION,
  surface: { browser: true, tui: TTY, tty: TTY, wizard: true },
  workspace: process.cwd(),
  commands: ['status', 'start', 'wizard'],
  state: 'ready',
});

function json(value) {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

function banner() {
  output.write('\x1b[36m╭─ Forge Portal ─────────────────────────────╮\x1b[0m\n');
  output.write('\x1b[36m│\x1b[0m Visual workspace for the Forge ecosystem \x1b[36m│\x1b[0m\n');
  output.write('\x1b[36m╰────────────────────────────────────────────╯\x1b[0m\n');
}

function usage() {
  output.write('forge-portal — Portal command center\n\n');
  output.write('  forge-portal                 open the interactive TUI\n');
  output.write('  forge-portal wizard          guided local startup\n');
  output.write('  forge-portal start           start Angular dev server\n');
  output.write('  forge-portal status          inspect the local CLI contract\n');
  output.write('  forge-portal --json status   machine-readable output\n');
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function contentType(file) {
  return {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

async function startStaticServer({ host = '127.0.0.1', port = '4200' } = {}) {
  const index = path.join(STATIC_ROOT, 'index.html');
  try {
    await stat(index);
  } catch {
    output.write('Portal build not found. Run `npm run build` in the checkout first.\n');
    process.exitCode = 1;
    return;
  }
  const server = createServer(async (request, response) => {
    let requestPath;
    try {
      requestPath = decodeURIComponent((request.url || '/').split('?', 1)[0]);
    } catch {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Malformed Portal asset path.\n');
      return;
    }
    const relative = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const candidate = path.resolve(STATIC_ROOT, relative);
    const insideRoot = candidate === STATIC_ROOT || candidate.startsWith(`${STATIC_ROOT}${path.sep}`);
    let file = insideRoot ? candidate : index;
    try {
      const info = await stat(file);
      if (!info.isFile()) file = index;
    } catch {
      file = index;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-cache' });
      response.end(body);
    } catch {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Portal static server could not read the requested asset.\n');
    }
  });
  server.on('error', (error) => {
    output.write(`Unable to start Portal: ${error.message}\n`);
    process.exitCode = 1;
  });
  server.listen(Number(port), host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    output.write(`Portal ready at http://${host}:${actualPort}/ (packaged static build)\n`);
  });
  const close = () => server.close(() => process.exit(0));
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

function startServer({ host = '127.0.0.1', port = '4200' } = {}) {
  output.write(`Starting Portal at http://${host}:${port}/\n`);
  const angularCli = path.join(PORTAL_ROOT, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  if (!existsSync(angularCli)) {
    void startStaticServer({ host, port });
    return;
  }
  const child = spawn(npmCommand(), ['run', 'start', '--', '--host', host, '--port', port], {
    cwd: PORTAL_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('error', (error) => {
    output.write(`Unable to start Portal: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) output.write(`Portal stopped by ${signal}\n`);
    else if (code) process.exitCode = code;
  });
}

async function run_wizard() {
  if (!TTY) {
    json({ ...status(), state: 'non_interactive', next: 'run forge-portal start' });
    return;
  }
  banner();
  const rl = createInterface({ input, output });
  try {
    const host = (await rl.question('Host [127.0.0.1]: ')).trim() || '127.0.0.1';
    const port = (await rl.question('Port [4200]: ')).trim() || '4200';
    const confirm = (await rl.question(`Start Portal on ${host}:${port}? [Y/n] `)).trim().toLowerCase();
    if (confirm && confirm !== 'y' && confirm !== 'yes') {
      output.write('Safe cancellation — nothing was changed.\n');
      return;
    }
    startServer({ host, port });
  } finally {
    rl.close();
  }
}

async function run_tui() {
  if (!TTY) {
    json({ ...status(), state: 'non_interactive', next: 'run forge-portal --json status' });
    return;
  }
  banner();
  const rl = createInterface({ input, output });
  try {
    output.write('\n  1  Start Portal\n  2  Guided wizard\n  3  Status\n  q  Exit\n\n');
    const choice = (await rl.question('Choose an action: ')).trim().toLowerCase();
    if (choice === '1') startServer();
    else if (choice === '2') {
      rl.close();
      await run_wizard();
    } else if (choice === '3') json(status());
    else output.write('Goodbye.\n');
  } finally {
    rl.close();
  }
}

async function run_home() {
  await run_tui();
}

const args = process.argv.slice(2);
const machine = args.includes('--json') || !TTY;
const command = args.find((arg) => !arg.startsWith('-')) || 'home';

if (args.includes('--version')) {
  if (args.includes('--json')) json(status());
  else output.write(`forge-portal ${VERSION}\n`);
}
else if (args.includes('--help') || args.includes('-h')) usage();
else if (command === 'status') machine ? json(status()) : json(status());
else if (command === 'start') startServer();
else if (command === 'wizard') await run_wizard();
else await run_home();
