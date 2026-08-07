const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../js/finance-core.js');

test('empty finance uses schema v2 and default dictionaries',()=>{
  const f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  assert.equal(f.schemaVersion,2);
  assert.ok(f.categories.some(x=>x.id==='food'));
  assert.ok(f.incomeTypes.some(x=>x.id==='per_diem'));
});

test('EXPENSE contract keeps only accountId + categoryId',()=>{
  const row=core.normalizeTransaction({id:'e1',type:'EXPENSE',amount:'250',accountId:'a1',categoryId:'food',incomeTypeId:'bad',fromAccountId:'bad',toAccountId:'bad',date:'2026-08-07'},'2026-08-07T10:00:00.000Z');
  assert.equal(row.accountId,'a1');
  assert.equal(row.categoryId,'food');
  assert.equal('incomeTypeId' in row,false);
  assert.equal('fromAccountId' in row,false);
  assert.equal('toAccountId' in row,false);
  assert.equal(core.validateTransactionShape(row).ok,true);
});

test('TRANSFER contract has only fromAccountId + toAccountId',()=>{
  const row=core.normalizeTransaction({id:'t1',type:'TRANSFER',amount:5000,accountId:'bad',fromAccountId:'a1',toAccountId:'a2',date:'2026-08-07'},'2026-08-07T10:00:00.000Z');
  assert.equal(row.fromAccountId,'a1');
  assert.equal(row.toAccountId,'a2');
  assert.equal('accountId' in row,false);
  assert.equal(core.validateTransactionShape(row).ok,true);
});

test('ADJUSTMENT preserves systemKind and signed amount',()=>{
  const row=core.normalizeTransaction({id:'a1',type:'ADJUSTMENT',amount:-1200,accountId:'main',systemKind:'MIGRATION_ANCHOR',date:'2026-08-07'},'2026-08-07T10:00:00.000Z');
  assert.equal(row.amount,-1200);
  assert.equal(row.systemKind,'MIGRATION_ANCHOR');
  assert.equal(core.validateTransactionShape(row).ok,true);
});
