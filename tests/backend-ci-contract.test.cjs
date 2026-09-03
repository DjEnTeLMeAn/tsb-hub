const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('CI syntax checker covers recursive backend and browser JavaScript', () => {
  assert.equal(packageJson.type, undefined);
  assert.match(packageJson.scripts.test, /tests\/\*\.test\.cjs/);
  assert.match(packageJson.scripts.lint, /scripts[\\/]check-backend\.mjs/);

  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-backend.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const checked = result.stdout.split(/\r?\n/)
    .filter((line) => line.startsWith('CHECK '))
    .map((line) => line.slice('CHECK '.length));
  assert.ok(!checked.includes('functions/api/v1/providers/[provider]/credential.js'));
  assert.ok(!checked.includes('functions/api/v1/providers/index.js'));
  assert.ok(!checked.includes('functions/api/v1/preferences.js'));
  assert.ok(checked.includes('functions/_lib/repositories.mjs'));
  assert.ok(checked.includes('functions/_lib/crypto.mjs'));
  assert.ok(checked.includes('functions/_lib/rate-limit.mjs'));
  assert.ok(checked.includes('functions/_middleware.js'));
  assert.ok(checked.includes('functions/api/v1/state.js'));
  assert.ok(checked.some((file) => file.startsWith('functions/') && file.endsWith('.mjs')));
  assert.ok(checked.includes('service-worker.js'));
  assert.ok(checked.includes('js/bootstrap.js'));
  assert.ok(checked.includes('js/storage.js'));
  assert.equal(checked.length, new Set(checked).size);
  assert.match(result.stdout, new RegExp(`Syntax check passed: ${checked.length} files`));
});
