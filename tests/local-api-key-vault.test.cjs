const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

class IDBMock {
  constructor() { this.data = new Map([['records', new Map()], ['keyring', new Map()], ['preferences', new Map()]]); this.locks = new Map(); this.connections = 0; }
  open() { const request = {}; setImmediate(() => { request.result = new DBMock(this); request.onupgradeneeded?.({ target: request }); request.onsuccess?.({ target: request }); }); return request; }
  transaction(names, mode) {
    const idb = this; const tx = new TxMock(idb, names, mode); const previous = names.filter(name => mode === 'readwrite').map(name => idb.locks.get(name) || Promise.resolve());
    const gate = Promise.all(previous); tx.ready = gate.then(() => { tx.started = true; });
    if (mode === 'readwrite') names.forEach(name => idb.locks.set(name, tx.finished));
    return tx;
  }
}
class DBMock { constructor(idb) { this.idb = idb; idb.connections++; this.objectStoreNames = { contains: name => idb.data.has(name) }; } createObjectStore(name) { this.idb.data.set(name, new Map()); return {}; } transaction(names, mode) { return this.idb.transaction(names, mode); } close() { this.idb.connections--; } }
class TxMock {
  constructor(idb, names, mode) { this.idb = idb; this.names = names; this.mode = mode; this.pending = 0; this.doneResolve = null; this.doneReject = null; this.finished = new Promise((resolve, reject) => { this.doneResolve = resolve; this.doneReject = reject; }); this.ready = Promise.resolve(); }
  objectStore(name) { const tx = this; const map = this.idb.data.get(name); const req = (fn) => { const r = {}; tx.pending++; tx.ready.then(() => setImmediate(() => { try { r.result = fn(); r.onsuccess?.({ target: r }); tx.pending--; tx.maybeDone(); } catch (e) { r.error = e; r.onerror?.({ target: r }); tx.pending--; tx.abort(); } })); return r; }; return { get: key => req(() => map.get(key)), getAll: () => req(() => [...map.values()]), put: value => req(() => { map.set(value.provider ?? value.id ?? value.name, value); return value; }), add: value => req(() => { const key = value.provider ?? value.id ?? value.name; if (map.has(key)) throw new Error('constraint'); map.set(key, value); return value; }), delete: key => req(() => map.delete(key)), clear: () => req(() => map.clear()) }; }
  maybeDone() { if (!this.pending && this.started) { this.doneResolve(); this.oncomplete?.(); } }
  abort() { this.doneReject(new Error('aborted')); this.onabort?.(); }
}
const source = fs.readFileSync('js/api-key-vault.js', 'utf8');
const appSource = fs.readFileSync('js/app.js', 'utf8');
function load() { const indexedDB = new IDBMock(); const context = { indexedDB, crypto: webcrypto, TextEncoder, TextDecoder, ArrayBuffer, Uint8Array, Promise, setImmediate }; context.window = context; vm.runInNewContext(source, context); return { vault: context.TSBApiKeyVault, indexedDB }; }

test('concurrent saves share one persisted non-extractable key and decrypt independently', async () => {
  const { vault, indexedDB } = load();
  await Promise.all([vault.saveKey('openai', 'openai-secret-123'), vault.saveKey('anthropic', 'anthropic-secret-456')]);
  assert.equal(await vault.readKey('openai'), 'openai-secret-123');
  assert.equal(await vault.readKey('anthropic'), 'anthropic-secret-456');
  assert.equal(indexedDB.data.get('keyring').size, 1);
  const persisted = [...indexedDB.data.get('keyring').values()][0].key;
  await assert.rejects(webcrypto.subtle.exportKey('raw', persisted));
});

test('ciphertext is at rest, tampering fails closed, providers are isolated, and metadata is deterministic', async () => {
  const { vault, indexedDB } = load();
  await vault.saveKey('gemini', 'gemini-secret-789'); await vault.saveKey('openai', 'openai-secret-123');
  const rows = indexedDB.data.get('records');
  for (const row of rows.values()) { assert.equal('gemini-secret-789' in row, false); assert.equal('openai-secret-123' in row, false); }
  assert.deepEqual((await vault.listKeys()).map(row => row.provider), ['openai', 'gemini']);
  const row = rows.get('openai'); const originalIv = row.iv; row.iv = new Uint8Array(12).buffer; await assert.rejects(vault.readKey('openai'));
  row.iv = originalIv; row.ciphertext = new Uint8Array(row.ciphertext).map((x, i) => i ? x : x ^ 1).buffer; await assert.rejects(vault.readKey('openai'));
  assert.equal(await vault.hasKey('anthropic'), false);
});

test('preferences, delete, and storage boundaries are explicit', async () => {
  const { vault } = load();
  await vault.setPreference('selectedProvider', 'anthropic'); await vault.setPreference('selectedModel', ' claude-3 ');
  assert.equal(await vault.getPreference('selectedProvider'), 'anthropic'); assert.equal(await vault.getPreference('selectedModel'), 'claude-3');
  await vault.saveKey('anthropic', 'anthropic-secret-456'); await vault.deleteKey('anthropic'); assert.equal(await vault.hasKey('anthropic'), false);
  await assert.rejects(vault.setPreference('selectedModel', 'bad\nvalue')); await assert.rejects(vault.saveKey('openai', 'short'));
});

test('UI never hydrates the secret into DOM or backup state', () => {
  const vaultUi = appSource.slice(appSource.indexOf('function renderApiKeyVaultHTML'), appSource.indexOf('function renderApiKeyVaultHTML') + 9000);
  assert.doesNotMatch(vaultUi, /readKey\s*\(/); assert.doesNotMatch(vaultUi, /apiKey.*(?:backup|app\.)/i);
  assert.match(vaultUi, /input\.value\s*=\s*''/); assert.match(vaultUi, /type="password"/);
});
