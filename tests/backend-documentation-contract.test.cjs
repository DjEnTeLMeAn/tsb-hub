const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const docs = ['README.md', 'SECURITY.md', 'docs/CLOUDFLARE_SECURITY.md', 'docs/BACKEND_ARCHITECTURE.md'].map(read).join('\n');
const architecture = read('docs/BACKEND_ARCHITECTURE.md');

test('documentation distinguishes implemented foundation from deployment and client status', () => {
  assert.doesNotMatch(docs, /Backend\s+(?:не\s+добавлялся|не\s+добавлен)|currently\s+(?:static|only)|does not claim to contain a backend/i);
  assert.match(docs, /implemented locally|локально реализован/i);
  assert.match(docs, /not (?:been )?(?:provisioned|deployed)|не (?:создан|развёрнут)/i);
  assert.match(docs, /client (?:is )?not connected|клиент.*не подключ/i);
  assert.match(docs, /continues to use [`']?localStorage/i);
  assert.doesNotMatch(docs, /localStorage.*(?:API key|key storage).*(?:implemented|mode)/i);
  assert.match(docs, /local vault.*IndexedDB.*(?:non-extractable|nonextractable).*Web Crypto.*AES-GCM/is);
  assert.match(docs, /plaintext.*never persistent|never persistent.*plaintext/i);
  for (const excluded of ['repository', 'GitHub', 'build', 'service[- ]worker cache', 'app backup', 'state sync', 'D1', 'server logs']) assert.match(docs, new RegExp(`(?:never|not|excluded|exclude|no)[^\\n]{0,120}${excluded}`, 'i'), excluded);
  assert.match(docs, /local-only.*(?:openai.*anthropic.*gemini|provider.*preference)/is);
  assert.match(docs, /active same-origin XSS.*(?:compromised JavaScript).*malicious device|same-origin XSS.*скомпрометированного JavaScript.*вредоносного устройства/is);
  assert.match(docs, /application code can call decrypt|app code can call decrypt/i);
  for (const route of ['/session', '/auth/logout', '/api/v1/state']) assert.match(docs, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(docs, /\/api\/v1\/preferences|credential metadata/i);
  assert.match(docs, /Gemini and Qwen Food photo are implemented[\s\S]*direct browser/i);
  assert.match(docs, /photo is sent only to the provider selected by the user|photo is sent to the selected provider/i);
  for (const provider of ['openai', 'anthropic', 'gemini']) assert.match(docs, new RegExp(provider, 'i'));
  assert.match(docs, /AES-256-GCM|AES-GCM/i); assert.match(docs, /provider proxy.*(?:not|no).*implemented|no provider proxy/i);
  assert.doesNotMatch(docs, /D1\s+(?:stores?|хранит)[^\n]*(?:provider|API)\s*key/i);
  assert.doesNotMatch(docs, /(?:active|implemented|deployed|configured)[^\n]*(?:server encrypted credential vault|AI_CREDENTIAL_KEK)|(?:server encrypted credential vault|AI_CREDENTIAL_KEK)[^\n]*(?:active|implemented|deployed|configured)/i);
  assert.match(docs, /(?:removed|удалён|removed legacy)[^\n]*(?:server encrypted credential vault|AI_CREDENTIAL_KEK)|(?:server encrypted credential vault|AI_CREDENTIAL_KEK)[^\n]*(?:removed|удалён)/is);
  assert.match(docs, /fixed-window|fixed window/i); assert.match(docs, /unauthenticated.*session.*(?:edge|perimeter)/is);
  assert.match(docs, /1 MiB/i); assert.match(docs, /optimistic concurrency/i); assert.match(docs, /canonical.*(?:schema|hash)/is);
});

test('documentation has the ordered no-fake-secret deployment runbook', () => {
  for (const term of ['preview', 'production', '0001', '0002', 'Cloudflare Secrets', 'Access', 'AUD', 'origin', 'adversarial audit', 'client']) assert.match(docs, new RegExp(term, 'i'), term);
  assert.match(docs, /wrangler\.example\.toml|private Wrangler/i);
  assert.match(docs, /no (?:fake|real) IDs|never commit real IDs|never commit IDs/i);
  assert.match(docs, /no credential KEK|without credential KEK|без credential KEK/i);
});

test('documentation removes the server credential vault and KEK from the active model', () => {
  assert.match(architecture, /legacy server encrypted credential vault.*AI_CREDENTIAL_KEK.*removed/is);
  assert.match(architecture, /no server-side provider-key storage/i);
  assert.match(architecture, /no credential KEK.*no provider credential migrations/is);
  assert.doesNotMatch(architecture, /D1 stores account-scoped records and an encrypted per-user AI provider vault/i);
});
