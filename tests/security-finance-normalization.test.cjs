const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('js/finance-core.js', 'utf8');

function loadCore() {
  const context = {
    Math,
    Uint8Array,
    crypto: {
      randomUUID: (() => {
        let counter = 0;
        return () => `11111111-2222-4333-8444-${String(++counter).padStart(12, '0')}`;
      })()
    },
    module: { exports: {} },
    globalThis: null
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.module.exports;
}

const safeIdPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
const validId = id => safeIdPattern.test(id) && !forbidden.has(id);

test('safe IDs reject forbidden and malformed values', () => {
  const core = loadCore();
  for (const bad of ['__proto__', 'constructor', 'prototype', '', 'has space', '<script>', 'x/'.repeat(70)]) {
    const id = core.safeId(bad, 'test');
    assert.equal(validId(id), true, bad);
    assert.notEqual(id, bad);
  }
  assert.equal(core.safeId('legacy.account-1', 'acct'), 'legacy.account-1');
});

test('normalizeFinance makes every collection ID unique and keeps system defaults', () => {
  const core = loadCore();
  const input = {
    accounts: [{ id: 'same' }, { id: 'same' }, { id: '__proto__' }],
    categories: [{ id: 'same', name: 'one' }, { id: 'same', name: 'two' }, { id: 'constructor' }],
    incomeTypes: [{ id: 'same', name: 'one' }, { id: 'same', name: 'two' }, { id: 'prototype' }],
    transactions: [
      { id: 'same', type: 'ADJUSTMENT', amount: 1, accountId: 'a1' },
      { id: 'same', type: 'ADJUSTMENT', amount: 2, accountId: 'a1' },
      { id: 'constructor', type: 'ADJUSTMENT', amount: 3, accountId: 'a1' }
    ],
    reserves: [{ id: 'same' }, { id: 'same' }, { id: 'prototype' }],
    obligations: [{ id: 'same', name: 'one', amount: 1, dueDate: '2026-08-01' }, { id: 'same', name: 'two', amount: 2, dueDate: '2026-08-02' }, { id: '__proto__', amount: 3 }]
  };
  const finance = core.normalizeFinance(input, '2026-08-01T00:00:00.000Z');
  for (const collection of ['accounts', 'categories', 'incomeTypes', 'transactions', 'reserves', 'obligations']) {
    const ids = finance[collection].map(item => item.id);
    assert.equal(new Set(ids).size, ids.length, collection);
    assert.ok(ids.every(validId), collection);
  }
  assert.ok(finance.categories.some(item => item.id === 'food' && item.system));
  assert.ok(finance.incomeTypes.some(item => item.id === 'personal' && item.system));
});

test('normalizeFinance accepts only real calendar dates for finance entities', () => {
  const core = loadCore();
  const createdAt = '2026-08-01T00:00:00.000Z';
  const invalidDates = ['2026-02-29', '2026-02-31', '2026-13-01', '2026-00-10', '2026-04-31'];
  const finance = core.normalizeFinance({
    transactions: invalidDates.map((date, index) => ({ id: `bad-tx-${index}`, type: 'ADJUSTMENT', amount: 1, accountId: 'a1', date })),
    obligations: invalidDates.map((dueDate, index) => ({ id: `bad-ob-${index}`, amount: 1, dueDate }))
      .concat([
        { id: 'leap-ob', amount: 1, dueDate: '2024-02-29' },
        { id: 'regular-ob', amount: 1, dueDate: '2026-04-30' }
      ])
  }, createdAt);

  assert.equal(finance.transactions.length, invalidDates.length);
  assert.ok(finance.transactions.every(transaction => transaction.date === '2026-08-01'));
  assert.ok(finance.obligations.slice(0, invalidDates.length).every(obligation => obligation.dueDate === ''));
  assert.deepEqual(finance.obligations.slice(-2).map(obligation => obligation.dueDate), ['2024-02-29', '2026-04-30']);
});

test('normalization bounds collections, text, money, references, and top-level shape', () => {
  const core = loadCore();
  const long = 'x'.repeat(20000);
  const repeated = (count, factory) => Array.from({ length: count }, (_, index) => factory(index));
  const finance = core.normalizeFinance({
    attacker: { shouldNotSurvive: true },
    schemaVersion: 999,
    accounts: repeated(1100, index => ({ id: `a${index}` })),
    categories: repeated(1100, index => ({ id: `c${index}` })),
    incomeTypes: repeated(1100, index => ({ id: `i${index}` })),
    transactions: repeated(10100, index => ({ id: `t${index}`, type: 'ADJUSTMENT', amount: '1e99', accountId: 'a0', description: long })),
    reserves: repeated(5100, index => ({ id: `r${index}`, name: long, amount: '1e99' })),
    obligations: repeated(5100, index => ({ id: `o${index}`, name: long, amount: '1e99', dueDate: '2026-08-01', linkedTransactionId: '<bad>' })),
    migration: { legacyReserveBalanceTransactionId: 'constructor' }
  });
  assert.deepEqual(Object.keys(finance).sort(), ['accounts', 'categories', 'incomeTypes', 'migration', 'obligations', 'reserves', 'schemaVersion', 'transactions']);
  assert.equal(finance.schemaVersion, 3);
  assert.equal(finance.accounts.length, 1000);
  assert.equal(finance.categories.length, 1000);
  assert.equal(finance.incomeTypes.length, 1000);
  assert.equal(finance.transactions.length, 10000);
  assert.equal(finance.reserves.length, 5000);
  assert.equal(finance.obligations.length, 5000);
  assert.ok(finance.transactions.every(item => item.description.length <= 10000 && Math.abs(item.amount) <= 1e12));
  assert.ok(finance.reserves.every(item => item.name.length <= 10000 && item.amount <= 1e12));
  assert.ok(finance.obligations.every(item => item.name.length <= 10000 && item.linkedTransactionId === null));
  assert.equal(finance.migration.legacyReserveBalanceTransactionId, '');
});

test('mandatory defaults survive capped all-system named collections', () => {
  const core = loadCore();
  const categories = Array.from({ length: 1100 }, (_, index) => ({ id: `custom-category-${index}`, name: `Category ${index}`, system: true }));
  const incomeTypes = Array.from({ length: 1100 }, (_, index) => ({ id: `custom-income-${index}`, name: `Income ${index}`, system: true }));
  const finance = core.normalizeFinance({ categories, incomeTypes });
  const categoryIds = new Set(finance.categories.map(item => item.id));
  const incomeTypeIds = new Set(finance.incomeTypes.map(item => item.id));
  assert.equal(finance.categories.length, 1000);
  assert.equal(finance.incomeTypes.length, 1000);
  for (const id of ['food', 'transport', 'home', 'health', 'other', 'subscriptions', 'fun']) assert.ok(categoryIds.has(id), id);
  for (const id of ['personal', 'per_diem', 'car', 'refund', 'gift', 'other']) assert.ok(incomeTypeIds.has(id), id);
});

test('reference normalization keeps valid legacy IDs and removes unsafe references', () => {
  const core = loadCore();
  const transaction = core.normalizeTransaction({
    id: 'legacy-tx', type: 'TRANSFER', amount: 10,
    fromAccountId: 'legacy-account', toAccountId: '__proto__'
  });
  assert.equal(transaction.id, 'legacy-tx');
  assert.equal(transaction.fromAccountId, 'legacy-account');
  assert.equal(transaction.toAccountId, '');
  const obligation = core.normalizeObligation({ id: 'legacy-ob', amount: 1, dueDate: '2026-08-01', linkedTransactionId: 'legacy-tx', recurrenceParentId: 'constructor', nextObligationId: 'next-1' });
  assert.equal(obligation.linkedTransactionId, 'legacy-tx');
  assert.equal(obligation.recurrenceParentId, null);
  assert.equal(obligation.nextObligationId, 'next-1');
});
