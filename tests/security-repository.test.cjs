const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const workflowPath = '.github/workflows/security-ci.yml';
const rulesetPath = '.github/rulesets/main-protection.json';

test('security workflow has the expected triggers, permissions, pins, and commands', () => {
  const workflow = read(workflowPath);

  assert.match(workflow, /^on:\r?\n/m);
  assert.match(workflow, /^  pull_request:\s*$/m);
  assert.match(workflow, /^  push:\r?\n    branches:\r?\n      - main$/m);
  assert.match(workflow, /^permissions:\r?\n  contents: read$/m);
  assert.doesNotMatch(workflow, /^\s{2,}\w[\w-]*:\s*(write|read-all|write-all)\s*$/m);
  assert.match(workflow, /^  security-tests:\r?\n    name: security-tests$/m);
  assert.match(workflow, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
  assert.match(workflow, /uses: actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.deepEqual([...workflow.matchAll(/^  ([a-z0-9-]+):\r?$/gm)].map(match => match[1]).filter(name => name === 'security-tests'), ['security-tests']);
  assert.match(workflow, /node-version: 20/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run lint/);
  assert.match(workflow, /run: npm run build/);
});

test('main ruleset protects the default branch without bypasses', () => {
  const ruleset = JSON.parse(read(rulesetPath));
  assert.equal(ruleset.target, 'branch');
  for (const field of ['source', 'source_type', 'id', 'node_id', '_links', 'created_at', 'updated_at']) {
    assert.equal(Object.prototype.hasOwnProperty.call(ruleset, field), false, `response-only field present: ${field}`);
  }
  assert.equal(ruleset.enforcement, 'active');
  assert.deepEqual(ruleset.bypass_actors, []);
  assert.deepEqual(ruleset.conditions.ref_name.include, ['refs/heads/main']);
  assert.deepEqual(ruleset.conditions.ref_name.exclude, []);

  const rules = new Map(ruleset.rules.map(rule => [rule.type, rule]));
  for (const type of ['deletion', 'non_fast_forward', 'required_linear_history']) {
    assert.ok(rules.has(type), `missing ${type} rule`);
  }
  assert.equal(rules.get('pull_request').parameters.required_approving_review_count, 0);
  assert.equal(rules.get('pull_request').parameters.required_review_thread_resolution, true);
  assert.equal(rules.get('required_status_checks').parameters.required_status_checks[0].context, 'security-tests');
  assert.equal(rules.get('required_status_checks').parameters.strict_required_status_checks_policy, true);
  assert.equal(rules.has('required_signatures'), false);
});
