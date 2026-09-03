'use strict';
const assert = require('node:assert/strict'); const test = require('node:test'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const read = file => fs.readFileSync(path.join(root, file), 'utf8');
test('backend surface contains only account/state/audit persistence and no provider fetch', () => {
  const schema = `${read('migrations/0001_backend.sql')}\n${read('migrations/0002_rate_limits.sql')}`;
  assert.deepEqual([...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/gi)].map(x => x[1]), ['users', 'user_state', 'audit_events', 'rate_limits']); assert.doesNotMatch(schema, /provider_credentials|provider_preferences|ciphertext|\biv\b|key_version/i);
  for (const file of ['functions/_lib/repositories.mjs', 'functions/_lib/crypto.mjs', 'functions/_lib/rate-limit.mjs', 'functions/_middleware.js']) assert.doesNotMatch(read(file), /AI_CREDENTIAL_KEK|AI_KEY_VERSION|provider_credentials|provider_preferences|credential_mutation|encryptCredential|decryptCredential/i, file);
  assert.doesNotMatch(read('.dev.vars.example'), /AI_CREDENTIAL|AI_KEY_VERSION/i);
});
test('rate limiter retains state, mutation and read policies only', async () => { const { RATE_LIMITS, rateLimitScope } = await import(pathToFileURL(path.join(root, 'functions/_lib/rate-limit.mjs')).href); assert.deepEqual(Object.keys(RATE_LIMITS).sort(), ['mutation', 'read', 'state_put']); assert.equal(rateLimitScope({ method: 'PUT', url: 'https://app.test/api/v1/state' }), 'state_put'); assert.equal(rateLimitScope({ method: 'GET', url: 'https://app.test/api/v1/providers/openai/credential' }), 'read'); });
function pathToFileURL(file) { return require('node:url').pathToFileURL(file); }
