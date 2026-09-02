const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const storageSource = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'storage.js'),
  'utf8'
);

function createStorage(initial = {}, { failRemove = [] } = {}) {
  const values = new Map(Object.entries(initial));
  const failures = new Set(failRemove);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      if (failures.has(key)) throw new Error(`remove failed: ${key}`);
      values.delete(key);
    },
    has(key) {
      return values.has(key);
    }
  };
}

function loadStorage(localStorage) {
  const context = { window: { localStorage } };
  vm.runInNewContext(storageSource, context, { filename: 'js/storage.js' });
  return context.window.TSBStorage;
}

const managedKeys = [
  'tsb_hub_data_v1',
  'tsb_hub_data_v1_recovery',
  'tsb_hub_device_id',
  'tasks_v043',
  'healthData',
  'healthSettings'
];

test('clearAllData removes every known TSB Hub key but preserves unrelated data', () => {
  const localStorage = createStorage(
    Object.fromEntries([...managedKeys, 'other_app_key'].map(key => [key, 'value']))
  );
  const storage = loadStorage(localStorage);

  const result = storage.clearAllData();

  assert.equal(result.ok, true);
  assert.deepStrictEqual(Array.from(result.failedKeys), []);
  for (const key of managedKeys) assert.equal(localStorage.has(key), false, key);
  assert.equal(localStorage.getItem('other_app_key'), 'value');
});

test('clearAllData reports a remove failure and remains fail-closed', () => {
  const localStorage = createStorage(
    Object.fromEntries(managedKeys.map(key => [key, 'value'])),
    { failRemove: ['healthData'] }
  );
  const storage = loadStorage(localStorage);

  const result = storage.clearAllData();

  assert.equal(result.ok, false);
  assert.deepStrictEqual(Array.from(result.failedKeys), ['healthData']);
  assert.equal(localStorage.has('healthData'), true);
  assert.equal(localStorage.has('tsb_hub_data_v1'), false);
});

test('clearing primary and recovery prevents recovery from resurrecting old data', () => {
  const localStorage = createStorage({
    tsb_hub_data_v1: '{not-json',
    tsb_hub_data_v1_recovery: JSON.stringify({ old: true })
  });
  const storage = loadStorage(localStorage);

  const result = storage.clearAllData();

  assert.equal(result.ok, true);
  assert.equal(storage.get('tsb_hub_data_v1'), null);
  assert.equal(localStorage.has('tsb_hub_data_v1_recovery'), false);
});

test('preserveDeviceId keeps only the device ID', () => {
  const localStorage = createStorage(
    Object.fromEntries(managedKeys.map(key => [key, 'value']))
  );
  const storage = loadStorage(localStorage);

  const result = storage.clearAllData({ preserveDeviceId: true });

  assert.equal(result.ok, true);
  assert.deepStrictEqual(Array.from(result.failedKeys), []);
  assert.equal(localStorage.getItem('tsb_hub_device_id'), 'value');
  for (const key of managedKeys.filter(key => key !== 'tsb_hub_device_id')) {
    assert.equal(localStorage.has(key), false, key);
  }
});
