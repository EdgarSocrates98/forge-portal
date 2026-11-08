import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('portable installer exposes all shell entrypoints', () => {
  for (const name of ['install.sh', 'install.windows.sh', 'install.ps1']) {
    const source = readFileSync(resolve(root, name), 'utf8');
    assert.ok(source.includes('scripts/install_portable.mjs'), name);
    assert.ok(!source.includes('\r\n'), `${name} must use LF`);
  }
});

test('portable installer dry-run is deterministic and non-mutating', () => {
  const output = execFileSync(process.execPath, ['scripts/install_portable.mjs', '--dry-run', '--no-link'], {
    cwd: root,
    encoding: 'utf8',
  });
  const plan = JSON.parse(output);
  assert.equal(plan.schema, 'forge/node-install/v1');
  assert.equal(plan.dry_run, true);
  assert.equal(plan.mutates, false);
  assert.deepEqual(plan.steps.map((step) => step.args), [['ci'], ['run', 'build']]);
});
