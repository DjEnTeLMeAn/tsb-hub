const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

test('D1 config has separate non-real placeholders', () => {
  const s = read('wrangler.example.toml');
  assert.equal((s.match(/binding\s*=\s*"TSB_DB"/g) || []).length, 2);
  assert.match(s, /\[\[env\.preview\.d1_databases\]\]/);
  assert.match(s, /\[\[env\.production\.d1_databases\]\]/);
  assert.match(s, /__REPLACE_ME_PREVIEW_D1_DATABASE_ID__/);
  assert.match(s, /__REPLACE_ME_PRODUCTION_D1_DATABASE_ID__/);
  assert.doesNotMatch(s, uuid);
  assert.match(s, /invalid.*IDs|never deploy/i);
});

test('dev vars contain only safe required placeholders', () => {
  const s = read('.dev.vars.example');
  const names = s.split(/\r?\n/).filter((x) => /^[A-Z0-9_]+=/.test(x)).map((x) => x.split('=', 1)[0]);
  assert.deepEqual(names, ['CF_ACCESS_TEAM_NAME', 'CF_ACCESS_AUD', 'APP_ORIGIN', 'ENVIRONMENT', 'CSRF_HMAC_KEY']);
  assert.doesNotMatch(s, uuid);
  assert.doesNotMatch(s, /(sk-[A-Za-z0-9]|-----BEGIN|AIza|xox[baprs]-)/);
  assert.match(s, /CF_ACCESS_AUD=__REPLACE_ME_ACCESS_AUD_TAG__/);
  assert.doesNotMatch(s, /CF_ACCESS_AUD=https?:\/\//i);
  assert.match(s, /CSRF_HMAC_KEY.*Cloudflare Secret/i);
  assert.doesNotMatch(s, /AI_CREDENTIAL_KEK|AI_KEY_VERSION/i);
});

test('routes include only the sensitive prefixes', () => {
  const r = JSON.parse(read('_routes.json'));
  assert.deepEqual(r.include, ['/api', '/api/*', '/auth', '/auth/*', '/session', '/session/*']);
  assert.deepEqual(r.exclude, []);
  assert.equal(r.include.includes('/*'), false);
  assert.deepEqual(r.include.filter((route) => !/^\/(api|auth|session)(\/\*)?$/.test(route)), []);
});

test('architecture documents required invariants and contracts', () => {
  const s = read('docs/BACKEND_ARCHITECTURE.md');
  for (const term of ['Cloudflare Access is the account authority', 'no application', 'signature', 'issuer (`iss`)', 'audience', 'expiry', 'IDOR', 'exact allowlisted `Origin`', 'HMAC CSRF', 'GET /session` returns', 'validated', 'no-store', 'optimistic concurrency', 'whole-state', 'server-side proxy', 'arbitrary base URL', 'SSRF', 'IndexedDB', 'backup bombs', 'log leaks', 'Secret rotation', '`GET /session`', '`GET /api/v1/state`', '`PUT /api/v1/state`', 'credential', 'migrations', 'Cloudflare Access team', 'application AUD', 'wrangler secret put', 'deploy preview', 'verified configuration for production', 'client remains disconnected']) {
    assert.match(s, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), term);
  }
  assert.match(s, /Gemini and Qwen Food photo are implemented via direct browser requests[\s\S]*Keys remain local[\s\S]*photo is sent to the selected provider/i);
  assert.match(s, /backend provider proxy is not implemented/i);
  assert.match(s, /local vault[\s\S]*IndexedDB/i);
  assert.doesNotMatch(s, /\/api\/v1\/preferences/i);
  assert.doesNotMatch(s, /CSRF[^\n]*(?:reused|single-use|one-time)|(?:reused|single-use|one-time)[^\n]*CSRF/i);
});
