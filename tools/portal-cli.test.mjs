import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'tools', 'portal-cli.mjs');
const pkg = createRequire(import.meta.url)('../package.json');

test('status is portable and machine-readable without a TTY', () => {
  const raw = execFileSync(process.execPath, [cli, '--json', 'status'], {
    cwd: root,
    encoding: 'utf8',
  });
  const result = JSON.parse(raw);
  assert.equal(result.schema, 'forge-portal/cli/v1');
  assert.equal(result.forge, 'forge-portal');
  assert.deepEqual(result.commands, ['status', 'start', 'wizard']);
  assert.equal(result.surface.wizard, true);
});

test('version is available at the CLI root and tracks package.json', () => {
  const raw = execFileSync(process.execPath, [cli, '--version'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(raw.trim(), `forge-portal ${pkg.version}`);
});

test('status payload carries the package version — single version track', () => {
  const raw = execFileSync(process.execPath, [cli, '--json', 'status'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(raw).version, pkg.version);
});

test('wizard degrades honestly when no TTY is available', () => {
  const raw = execFileSync(process.execPath, [cli, 'wizard'], {
    cwd: root,
    encoding: 'utf8',
  });
  const result = JSON.parse(raw);
  assert.equal(result.state, 'non_interactive');
  assert.equal(result.next, 'run forge-portal start');
});
