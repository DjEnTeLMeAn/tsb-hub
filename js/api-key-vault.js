(function (global) {
  'use strict';

  const DB_NAME = 'tsb_hub_private_vault_v1';
  const DB_VERSION = 1;
  const SCHEMA = 'tsb-hub-private-vault-v1';
  const KEYRING_ID = 'device-encryption-key';
  const PROVIDERS = Object.freeze(['openai', 'anthropic', 'gemini']);
  const STORES = Object.freeze({ records: 'records', keyring: 'keyring', preferences: 'preferences' });
  const subtle = global.crypto?.subtle;
  const encoder = typeof global.TextEncoder === 'function' ? new global.TextEncoder() : null;

  function providerOK(provider) { return PROVIDERS.includes(provider); }
  function requireProvider(provider) { if (!providerOK(provider)) throw new Error('Unsupported provider'); }
  function failClosed() { throw new Error('Private vault unavailable'); }
  function request(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('Vault request failed')); }); }
  function transactionDone(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(new Error('Vault transaction aborted')); tx.onerror = () => reject(new Error('Vault transaction failed')); }); }
  function bytes(value) { return value instanceof ArrayBuffer ? value : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength); }
  function aad(provider) { return encoder.encode(`${SCHEMA}:${provider}`); }
  function keyText(key) { return typeof key === 'string' && key.length >= 8 && key.length <= 4096 && /^[\x21-\x7e]+$/.test(key); }
  function canonicalTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    try { return new Date(value).toISOString() === value; } catch (error) { return false; }
  }
  function validDeviceKey(key) {
    const authentic = typeof global.CryptoKey === 'function'
      ? key instanceof global.CryptoKey
      : Object.prototype.toString.call(key) === '[object CryptoKey]';
    if (!authentic || key.type !== 'secret' || key.extractable !== false) return false;
    if (key.algorithm?.name !== 'AES-GCM' || key.algorithm?.length !== 256) return false;
    if (!Array.isArray(key.usages) || key.usages.length !== 2) return false;
    return key.usages.includes('encrypt') && key.usages.includes('decrypt');
  }
  function requireDeviceKey(key) { if (!validDeviceKey(key)) failClosed(); return key; }
  function openDB() {
    if (!global.indexedDB || !subtle || !encoder) return Promise.reject(new Error('Private vault unavailable'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORES.records)) db.createObjectStore(STORES.records, { keyPath: 'provider' });
        if (!db.objectStoreNames.contains(STORES.keyring)) db.createObjectStore(STORES.keyring, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORES.preferences)) db.createObjectStore(STORES.preferences, { keyPath: 'name' });
      };
      req.onblocked = () => { if (!settled) { settled = true; reject(new Error('Private vault blocked')); } };
      req.onerror = () => { if (!settled) { settled = true; reject(new Error('Private vault unavailable')); } };
      req.onsuccess = () => {
        if (settled) { try { req.result?.close(); } catch (error) { /* closed or unavailable */ } return; }
        settled = true; resolve(req.result);
      };
    });
  }
  async function withTx(storeNames, mode, fn) {
    const db = await openDB();
    let tx;
    try {
      tx = db.transaction(storeNames, mode);
      const done = transactionDone(tx);
      let result;
      try { result = await fn(tx); }
      catch (error) {
        try { tx.abort(); } catch (abortError) { /* already finished */ }
        try { await done; } catch (abortError) { /* expected abort */ }
        throw error;
      }
      await done;
      return result;
    } finally { db.close(); }
  }
  async function getDeviceKey(mode = 'readwrite') {
    if (mode === 'readonly') {
      return withTx([STORES.keyring], 'readonly', async tx => {
        const existing = await request(tx.objectStore(STORES.keyring).get(KEYRING_ID));
        if (!existing) failClosed();
        return requireDeviceKey(existing.key);
      });
    }
    if (mode !== 'readwrite') failClosed();
    const candidate = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    requireDeviceKey(candidate);
    return withTx([STORES.keyring], 'readwrite', async tx => {
      const store = tx.objectStore(STORES.keyring);
      const existing = await request(store.get(KEYRING_ID));
      if (existing) return requireDeviceKey(existing.key);
      store.add({ id: KEYRING_ID, key: candidate });
      return candidate;
    });
  }
  async function saveKey(provider, apiKey) {
    requireProvider(provider); if (!keyText(apiKey)) throw new Error('Invalid API key');
    const key = await getDeviceKey();
    const iv = global.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(provider) }, key, encoder.encode(apiKey));
    return withTx([STORES.records], 'readwrite', async tx => {
      tx.objectStore(STORES.records).put({ provider, ciphertext, iv: bytes(iv), lastFour: apiKey.slice(-4), updatedAt: new Date().toISOString() });
      return { provider, lastFour: apiKey.slice(-4) };
    });
  }
  async function listKeys() { return withTx([STORES.records], 'readonly', async tx => {
    const rows = await request(tx.objectStore(STORES.records).getAll());
    return rows.filter(row => providerOK(row?.provider) && typeof row.lastFour === 'string' && /^[\x21-\x7e]{4}$/.test(row.lastFour) && canonicalTimestamp(row.updatedAt))
      .map(row => ({ provider: row.provider, lastFour: row.lastFour, updatedAt: row.updatedAt }))
      .sort((a, b) => PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider));
  }); }
  async function hasKey(provider) { requireProvider(provider); return (await listKeys()).some(item => item.provider === provider); }
  async function readKey(provider) {
    requireProvider(provider); const key = await getDeviceKey('readonly');
    return withTx([STORES.records], 'readonly', async tx => {
      const row = await request(tx.objectStore(STORES.records).get(provider));
      if (!row || !(row.ciphertext instanceof ArrayBuffer) || !(row.iv instanceof ArrayBuffer)) failClosed();
      const plaintext = await subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(row.iv), additionalData: aad(provider) }, key, row.ciphertext);
      const value = new global.TextDecoder('utf-8', { fatal: true }).decode(plaintext);
      if (!keyText(value)) failClosed();
      return value;
    });
  }
  async function deleteKey(provider) { requireProvider(provider); return withTx([STORES.records], 'readwrite', async tx => { tx.objectStore(STORES.records).delete(provider); return true; }); }
  async function getPreference(name) { if (name !== 'selectedProvider' && name !== 'selectedModel') throw new Error('Unsupported preference'); return withTx([STORES.preferences], 'readonly', async tx => { const row = await request(tx.objectStore(STORES.preferences).get(name)); return row?.value ?? null; }); }
  async function setPreference(name, value) {
    if (name !== 'selectedProvider' && name !== 'selectedModel') throw new Error('Unsupported preference');
    if (value === null && name === 'selectedProvider') return withTx([STORES.preferences], 'readwrite', async tx => { tx.objectStore(STORES.preferences).delete(name); return null; });
    if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Invalid preference');
    value = value.trim();
    if (name === 'selectedProvider') requireProvider(value);
    if (name === 'selectedModel' && value.length > 200) throw new Error('Invalid preference');
    return withTx([STORES.preferences], 'readwrite', async tx => { tx.objectStore(STORES.preferences).put({ name, value }); return value; });
  }
  async function clearVault() { return withTx([STORES.records, STORES.keyring, STORES.preferences], 'readwrite', async tx => { Object.values(STORES).forEach(name => tx.objectStore(name).clear()); return true; }); }
  global.TSBApiKeyVault = Object.freeze({ DB_NAME, PROVIDERS, saveKey, hasKey, listKeys, readKey, deleteKey, getPreference, setPreference, clearVault });
})(window);
