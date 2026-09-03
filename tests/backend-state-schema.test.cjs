'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const nodeCrypto = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = nodeCrypto.webcrypto;

const load = () => import('../functions/_lib/state-schema.mjs');
const base = () => ({ backupType: 'full', formatVersion: 1 });
const isoDate = n => new Date(Date.UTC(2020, 0, 1 + n)).toISOString().slice(0, 10);
const validFinance = () => ({ schemaVersion: 3, migration: {}, accounts: [], transactions: [], categories: [], incomeTypes: [], reserves: [], obligations: [] });
const migration = () => ({ checkpoint: '', completedAt: '', part2Checkpoint: '', part2CompletedAt: '', legacyReserveStatus: '', legacyReserveAmount: 0, legacyReserveBalanceStatus: '', legacyReserveBalanceTransactionId: '', legacyReserveBalanceRestoredAt: '', legacyObligationsMigrated: 0, legacyObligationsSkipped: 0 });
const context = () => ({ availableBalance: '', reserveBalance: '', savingGoal: '', financeV2Legacy: false, incomes: [{ id: 'income-1', amount: '', date: '', title: '', comment: '', status: 'planned', completedAt: '', createdAt: '' }], obligations: [{ id: 'plan-1', amount: '', date: '', title: '', comment: '', status: 'paid', completedAt: '', createdAt: '' }], operations: [{ id: 'op-1', type: 'expense', amount: '', date: '2026-01-01', title: '', comment: '', sourceId: '', createdAt: '' }] });

test('returns canonical frozen state and deterministic SHA-256', async () => {
  const { validateAndCanonicalizeState } = await load();
  const a = base(); a.meta = { lastExported: '', createdAt: '', lastModified: '', appVersion: 'x' };
  const b = base(); b.meta = { appVersion: 'x', lastModified: '', lastExported: '', createdAt: '' };
  const one = await validateAndCanonicalizeState(a); const two = await validateAndCanonicalizeState(b);
  assert.equal(one.payloadJson, two.payloadJson); assert.equal(one.payloadSha256, two.payloadSha256);
  assert.equal(Object.getPrototypeOf(one.state), null); assert.ok(Object.isFrozen(one.state));
  assert.throws(() => { one.state.meta.appVersion = 'changed'; }, TypeError);
  assert.equal(one.payloadJson.includes('changed'), false);
});

test('accepts a representative current client full-backup fixture', async () => {
  const { validateAndCanonicalizeState } = await load();
  const finance = validFinance(); finance.migration = migration();
  finance.accounts = [{ id: 'account-1', name: 'Main', type: 'cash', active: true, archived: false, isDefault: true, sortOrder: 0, createdAt: '', updatedAt: '' }];
  finance.categories = [{ id: 'category-1', name: 'Food', active: true, archived: false, system: false, sortOrder: 0, createdAt: '', updatedAt: '' }];
  finance.incomeTypes = [{ id: 'income-type-1', name: 'Salary', active: true, archived: false, system: false, sortOrder: 0, createdAt: '', updatedAt: '' }];
  finance.transactions = [{ id: 'tx-1', type: 'EXPENSE', amount: 10, date: '2026-01-01', time: '12:00', description: 'Lunch', createdAt: '', updatedAt: '', accountId: 'account-1', categoryId: 'category-1' }];
  finance.reserves = [{ id: 'reserve-1', name: 'Rainy day', amount: 0, targetAmount: 100, active: true, archived: false, sortOrder: 0, createdAt: '', updatedAt: '' }];
  finance.obligations = [{ id: 'obligation-1', name: 'Rent', amount: 500, dueDate: '2026-01-01', recurrence: 'MONTHLY', status: 'ACTIVE', note: '', createdAt: '', updatedAt: '' }];
  const state = { backupType: 'full', formatVersion: 1, meta: { appVersion: '0.13.3', dataVersion: 3, createdAt: '', lastModified: '', lastExported: '', deviceId: 'device-1', changeCounter: 1 }, tasks: { '2026-01-01': [{ id: 'same-domain', text: 'Task', done: false, failed: false, dismissed: false, priority: 'important', subtasks: [], note: '', createdAt: '', source: '' }] }, health: { '2026-01-01': { meals: [{ id: 'same-domain', type: 'meal', name: 'Lunch', amount: '', time: '', comment: '', calories: 0, protein: 0, fat: 0, carbs: 0, createdAt: '' }], weight: '', activityNote: '', note: '' } }, dailyReports: { '2026-01-01': { selfScore: '75', driveScore: '50', text: 'fine', updatedAt: '' } }, finance, financeContext: context(), gptPlans: { '2026-01-01': { text: 'Plan', createdAt: '', updatedAt: '' } }, importantDates: [{ id: 'important-1', title: 'Event', date: '2026-01-01', description: '', status: 'active', createdAt: '', source: '' }], settings: { hideDone: false, showSelectedDayOnly: false, showOverdueOnToday: true, pastTasksWindowDays: 30, theme: 'light', migratedFromOldStorage: false }, archives: { financeV1MigrationBackup: { createdAt: '', finance, financeContext: context() } } };
  const result = await validateAndCanonicalizeState(state);
  assert.equal(result.byteLength, new TextEncoder().encode(result.payloadJson).byteLength);
  assert.match(result.payloadSha256, /^[0-9a-f]{64}$/);
});

test('rejects pollution, accessors, toJSON, sparse arrays, dates, and non-finite numbers', async () => {
  const { validateAndCanonicalizeState } = await load(); const reject = async value => assert.rejects(() => validateAndCanonicalizeState(value));
  await reject({ ...base(), meta: { ['__proto__']: { polluted: true } } });
  const getter = base(); Object.defineProperty(getter, 'meta', { enumerable: true, get() { throw new Error('executed'); } }); await reject(getter);
  const json = base(); json.toJSON = () => { throw new Error('executed'); }; await reject(json);
  const sparse = base(); sparse.importantDates = []; sparse.importantDates.length = 2; sparse.importantDates[1] = {}; await reject(sparse);
  await reject({ ...base(), importantDates: [{ id: 'x', title: 'x', date: '2026-02-29', status: 'active', createdAt: '' }] });
  await reject({ ...base(), importantDates: [{ id: 'x', title: 'x', date: '2026-01-01', status: 'active', createdAt: '2026-01-01T00:00:00.00Z' }] });
  await reject({ ...base(), meta: { appVersion: 'x', changeCounter: NaN } }); await reject({ ...base(), meta: { appVersion: 'x', changeCounter: Infinity } });
  await reject({ ...base(), importantDates: [{ id: 'x', title: 'x', date: '1000-02-29', status: 'active', createdAt: '1000-01-01T00:00:00.000Z' }] });
  await reject({ ...base(), importantDates: [{ id: 'x', title: 'x', date: '9999-12-31', status: 'active', createdAt: '10000-01-01T00:00:00.000Z' }] });
});

test('rejects unknown fields, duplicate IDs, secrets, and structural bounds', async () => {
  const { validateAndCanonicalizeState } = await load(); const reject = async value => assert.rejects(() => validateAndCanonicalizeState(value));
  await reject({ ...base(), settings: { unknown: true } });
  await reject({ ...base(), importantDates: [{ id: 'same', title: 'a', date: '2026-01-01', status: 'active', createdAt: '' }, { id: 'same', title: 'b', date: '2026-01-02', status: 'active', createdAt: '' }] });
  await reject({ ...base(), settings: { apiToken: 'x' } });
  const deep = base(); let cursor = deep; for (let i = 0; i < 13; i++) { cursor.meta = {}; cursor = cursor.meta; } await reject(deep);
  const wide = base(); wide.gptPlans = {}; for (let i = 0; i < 1001; i++) wide.gptPlans[isoDate(i)] = { createdAt: '', updatedAt: '', text: '' }; await reject(wide);
  const huge = base(); huge.gptPlans = {}; for (let i = 0; i < 1000; i++) huge.gptPlans[isoDate(i)] = { createdAt: '', updatedAt: '', text: 'x'.repeat(10000) }; await reject(huge);
});

test('checks finance references, transfers, and obligation links', async () => {
  const { validateAndCanonicalizeState } = await load(); const reject = async value => assert.rejects(() => validateAndCanonicalizeState(value));
  const f = validFinance(); f.accounts = [{ id: 'a', name: 'A', createdAt: '', updatedAt: '' }];
  f.transactions = [{ id: 't', type: 'EXPENSE', amount: 1, date: '2026-01-01', createdAt: '', updatedAt: '', accountId: 'missing' }]; await reject({ ...base(), finance: f });
  f.transactions = [{ id: 't', type: 'TRANSFER', amount: 1, date: '2026-01-01', createdAt: '', updatedAt: '', fromAccountId: 'a', toAccountId: 'a' }]; await reject({ ...base(), finance: f });
  f.transactions = []; f.obligations = [{ id: 'o', name: 'O', amount: 1, dueDate: '2026-01-01', recurrence: 'NONE', status: 'ACTIVE', createdAt: '', updatedAt: '', linkedTransactionId: 'missing' }]; await reject({ ...base(), finance: f });
});

test('enforces exact 1 MiB canonical UTF-8 sync limit', async () => {
  const { validateAndCanonicalizeState } = await load();
  const make = n => { const x = base(); x.gptPlans = {}; for (let i = 0; i < 1000; i++) x.gptPlans[isoDate(i)] = { createdAt: '', updatedAt: '', text: 'x'.repeat(n) }; return x; };
  const near = make(980); const measured = await validateAndCanonicalizeState(near); assert.ok(measured.byteLength < 1024 * 1024);
  const exact = make(980); const extra = 1024 * 1024 - measured.byteLength - 1; const each = Math.floor(extra / 1000); const rest = extra - each * 1000;
  for (let i = 0; i < 1000; i++) exact.gptPlans[isoDate(i)].text += 'x'.repeat(each + (i === 0 ? rest : 0));
  const under = await validateAndCanonicalizeState(exact);
  assert.equal(under.byteLength, 1024 * 1024 - 1); exact.gptPlans[isoDate(0)].text += 'xx'; await assert.rejects(() => validateAndCanonicalizeState(exact));
});
