'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const vaultSource = fs.readFileSync(path.join(root, 'js/api-key-vault.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const storageSource = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
const serverSource = fs.readdirSync(path.join(root, 'functions'), { recursive: true })
  .filter(file => /\.(?:js|mjs)$/.test(file)).map(file => fs.readFileSync(path.join(root, 'functions', file), 'utf8')).join('\n');
const migrationSource = fs.readdirSync(path.join(root, 'migrations')).map(file => fs.readFileSync(path.join(root, 'migrations', file), 'utf8')).join('\n');

class IDB {
  constructor() { this.data = new Map([['records', new Map()], ['keyring', new Map()], ['preferences', new Map()]]); this.fail = null; this.locks = new Map(); }
  open() { const request = {}; setImmediate(() => { if (this.fail === 'open') return request.onerror?.(); request.result = new DB(this); request.onupgradeneeded?.({ target: request }); request.onsuccess?.({ target: request }); }); return request; }
  transaction(names, mode) {
    if (this.fail === 'transaction') throw new Error('injected IDB transaction failure');
    const tx = new Tx(this, names, mode); const waits = names.filter(n => mode === 'readwrite').map(n => this.locks.get(n) || Promise.resolve());
    tx.ready = Promise.all(waits).then(() => { tx.started = true; });
    if (mode === 'readwrite') names.forEach(n => this.locks.set(n, tx.finished));
    return tx;
  }
}
class DB { constructor(idb) { this.idb = idb; this.objectStoreNames = { contains: n => idb.data.has(n) }; } createObjectStore(n) { this.idb.data.set(n, new Map()); return {}; } transaction(n, m) { return this.idb.transaction(n, m); } close() {} }
class Tx {
  constructor(idb, names, mode) { this.idb = idb; this.names = names; this.mode = mode; this.pending = 0; this.started = false; this.doneResolve = null; this.doneReject = null; this.finished = new Promise((res, rej) => { this.doneResolve = res; this.doneReject = rej; }); this.ready = Promise.resolve(); }
  objectStore(name) { const tx = this; const map = this.idb.data.get(name); const request = fn => { const r = {}; tx.pending++; tx.ready.then(() => setImmediate(() => { try { if (tx.idb.fail === 'request') throw new Error('injected IDB request failure'); r.result = fn(); r.onsuccess?.({ target: r }); } catch (e) { r.error = e; r.onerror?.({ target: r }); tx.abort(); } finally { tx.pending--; tx.maybeDone(); } })); return r; }; return { get:k=>request(()=>map.get(k)), getAll:()=>request(()=>[...map.values()]), put:v=>request(()=>{map.set(v.provider ?? v.id ?? v.name,v);return v;}), add:v=>request(()=>{const k=v.provider ?? v.id ?? v.name;if(map.has(k))throw new Error('constraint');map.set(k,v);return v;}), delete:k=>request(()=>map.delete(k)), clear:()=>request(()=>map.clear()) }; }
  maybeDone() { if (!this.pending && this.started) { this.doneResolve(); this.oncomplete?.(); } }
  abort() { if (this.doneReject) { const reject = this.doneReject; this.doneReject = null; reject(new Error('aborted')); this.onabort?.(); } }
}

function load(options = {}) {
  const indexedDB = new IDB(); Object.assign(indexedDB, options);
  const context = { indexedDB, crypto: options.crypto || webcrypto, TextEncoder, TextDecoder, ArrayBuffer, Uint8Array, Promise, setImmediate };
  context.window = context; vm.runInNewContext(vaultSource, context); return { vault: context.TSBApiKeyVault, indexedDB };
}
const rejectsClosed = promise => assert.rejects(promise, /Private vault|Vault|aborted|decrypt|operation/i);

test('first-save race creates exactly one device key and never substitutes an extractable key', async () => {
  const { vault, indexedDB } = load();
  await Promise.all(['openai', 'anthropic', 'gemini', 'qwen'].map((p, i) => vault.saveKey(p, `${p}-secret-${i}123`)));
  assert.equal(indexedDB.data.get('keyring').size, 1);
  const key = [...indexedDB.data.get('keyring').values()][0].key;
  assert.equal(key.type, 'secret'); assert.equal(key.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey('raw', key));
  const persistedText = JSON.stringify([...indexedDB.data.values()].map(store => [...store.values()]));
  for (const secret of ['openai-secret-0123', 'anthropic-secret-1123', 'gemini-secret-2123', 'qwen-secret-3123']) assert.equal(persistedText.includes(secret), false);
  for (const p of ['openai', 'anthropic', 'gemini', 'qwen']) assert.equal(await vault.readKey(p), `${p}-secret-${['openai','anthropic','gemini','qwen'].indexOf(p)}123`);
});

test('ciphertext, IV, and provider transfer all fail closed; malformed rows are never accepted', async () => {
  const { vault, indexedDB } = load(); await vault.saveKey('openai', 'openai-secret-123');
  const records = indexedDB.data.get('records'); const original = records.get('openai');
  for (const mutation of [
    row => { row.ciphertext = new Uint8Array(row.ciphertext).map((x, i) => i === 0 ? x ^ 1 : x).buffer; },
    row => { row.iv = new Uint8Array(12).fill(7).buffer; },
    row => { records.set('openai', { ...row, ciphertext: 'not-an-array-buffer' }); },
    row => { records.set('openai', { ...row, iv: new Uint8Array(11).buffer }); }
  ]) { records.clear(); records.set('openai', structuredClone(original)); mutation(records.get('openai')); await rejectsClosed(vault.readKey('openai')); }
  records.clear(); records.set('anthropic', { ...structuredClone(original), provider: 'anthropic' }); await rejectsClosed(vault.readKey('anthropic'));
  records.clear(); records.set('openai', { provider: 'openai', lastFour: '1234', updatedAt: 'bad' });
  assert.deepEqual(await vault.listKeys(), []); await rejectsClosed(vault.readKey('openai'));
});

test('read rejects a malformed/extractable keyring entry instead of trusting IDB shape', async () => {
  const { vault, indexedDB } = load();
  const extractable = await webcrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('tsb-hub-private-vault-v1:openai') }, extractable, new TextEncoder().encode('openai-secret-123'));
  indexedDB.data.get('keyring').set('device-encryption-key', { id: 'device-encryption-key', key: extractable });
  indexedDB.data.get('records').set('openai', { provider: 'openai', iv: iv.buffer, ciphertext, lastFour: '1234', updatedAt: new Date().toISOString() });
  await rejectsClosed(vault.readKey('openai'));
});

test('IndexedDB and WebCrypto failures do not fall back to plaintext', async () => {
  const idb = load(); idb.indexedDB.fail = 'open'; await rejectsClosed(idb.vault.saveKey('openai', 'openai-secret-123')); assert.equal(idb.indexedDB.data.get('records').size, 0);
  const crypto = { ...webcrypto, subtle: { ...webcrypto.subtle, generateKey: async () => { throw new Error('crypto failure'); } }, getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const broken = load({ crypto }); await assert.rejects(broken.vault.saveKey('openai', 'openai-secret-123'), /crypto failure/); assert.equal(broken.indexedDB.data.get('records').size, 0);
});

test('clearVault removes records, preferences, and the device key; delete removes only the selected provider', async () => {
  const { vault, indexedDB } = load(); await vault.saveKey('openai', 'openai-secret-123'); await vault.saveKey('anthropic', 'anthropic-secret-456'); await vault.setPreference('selectedProvider', 'anthropic');
  await vault.deleteKey('openai'); assert.equal(await vault.hasKey('openai'), false); assert.equal(await vault.hasKey('anthropic'), true);
  await vault.clearVault(); for (const name of ['records', 'keyring', 'preferences']) assert.equal(indexedDB.data.get(name).size, 0); await assert.rejects(vault.readKey('anthropic'));
});

test('UI clears the input on success and failure, never hydrates the secret, and app state/backup/reset exclude vault data', () => {
  const ui = appSource.slice(appSource.indexOf('function renderApiKeyVaultHTML'), appSource.indexOf('function renderApiKeyVaultHTML') + 11000);
  assert.doesNotMatch(ui, /TSBApiKeyVault\.readKey\s*\(/); assert.match(ui, /input\.value\s*=\s*''/g); assert.match(ui, /catch[\s\S]*?input\.value\s*=\s*''/);
  assert.doesNotMatch(appSource.slice(appSource.indexOf('function buildFullBackupObject'), appSource.indexOf('function importData')), /TSBApiKeyVault|apiKeyInput|ciphertext|keyring/);
  assert.match(appSource, /TSBStorage\.clearAllData\(\{ preserveDeviceId: false \}\)/); assert.doesNotMatch(storageSource, /tsb_hub_private_vault_v1|keyring|ciphertext/);
});

test('server routes, persistence, migrations, and environment contain no API-key vault path', () => {
  assert.doesNotMatch(serverSource, /provider_credentials|provider_preferences|ciphertext|keyring|AI_CREDENTIAL_KEK|AI_KEY_VERSION/i);
  assert.doesNotMatch(migrationSource, /provider_credentials|provider_preferences|ciphertext|keyring|api[_-]?key/i);
  for (const file of ['functions/api/v1/providers/index.js', 'functions/api/v1/providers/[provider]/credential.js', 'functions/api/v1/preferences.js']) assert.equal(fs.existsSync(path.join(root, file)), false);
  assert.doesNotMatch(fs.readFileSync(path.join(root, '.dev.vars.example'), 'utf8'), /AI_CREDENTIAL_KEK|AI_KEY_VERSION/);
});
