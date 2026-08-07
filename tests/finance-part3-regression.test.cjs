const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../js/finance-core.js');

function baseFinance(){
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'card',name:'Card',isDefault:true},{now:'2026-08-07T00:00:00.000Z'}).finance;
  const income=core.createTransaction(f,{type:'INCOME',amount:1000,accountId:'card',incomeTypeId:'personal',date:'2026-08-07'},{now:'2026-08-07T09:00:00.000Z',idFactory:()=> 'income'});
  assert.equal(income.ok,true);return income.finance;
}

test('Finance v2 complete keeps schema v3 and derived collections after JSON roundtrip',()=>{
  let f=baseFinance();
  f=core.createReserve(f,{name:'Подушка',amount:100},{now:'2026-08-07T10:00:00.000Z',idFactory:()=> 'reserve'}).finance;
  f=core.createObligation(f,{name:'Интернет',amount:200,dueDate:'2026-08-20',recurrence:'NONE'},{now:'2026-08-07T10:05:00.000Z',idFactory:()=> 'obligation'}).finance;
  const normalized=core.normalizeFinance(JSON.parse(JSON.stringify(f)),'2026-08-07T11:00:00.000Z');
  assert.equal(normalized.schemaVersion,3);assert.equal(normalized.reserves.length,1);assert.equal(normalized.obligations.length,1);
  assert.equal(core.getTotalBalance(normalized),1000);assert.equal(core.getFreeMoney(normalized,{today:'2026-08-07'}),700);
  const analytics=core.getAnalyticsSummary(normalized,{dateFrom:'2026-08-01',dateTo:'2026-08-31'});
  assert.deepEqual({income:analytics.income,expense:analytics.expense,difference:analytics.difference},{income:1000,expense:0,difference:1000});
});

test('reconciliation is reversible and never becomes user income or expense',()=>{
  const f=baseFinance();
  const r=core.reconcileAccount(f,'card',875,{date:'2026-08-07',now:'2026-08-07T12:00:00.000Z',idFactory:()=> 'reconcile'});
  assert.equal(r.ok,true);assert.equal(core.getAccountBalance(r.finance,'card'),875);
  const analytics=core.getAnalyticsSummary(r.finance,{dateFrom:'2026-08-07',dateTo:'2026-08-07'});
  assert.equal(analytics.income,1000);assert.equal(analytics.expense,0);
  const deleted=core.deleteTransaction(r.finance,'reconcile');assert.equal(deleted.ok,true);assert.equal(core.getAccountBalance(deleted.finance,'card'),1000);
});

test('custom income type can be archived without breaking historical INCOME reference',()=>{
  let f=baseFinance();
  const type=core.createOrUpdateIncomeType(f,{name:'Подработка'},{now:'2026-08-07T13:00:00.000Z',idFactory:()=> 'side_job'});assert.equal(type.ok,true);f=type.finance;
  const income=core.createTransaction(f,{type:'INCOME',amount:250,accountId:'card',incomeTypeId:'side_job',date:'2026-08-07'},{now:'2026-08-07T13:05:00.000Z',idFactory:()=> 'side_income'});assert.equal(income.ok,true);f=income.finance;
  const archived=core.archiveIncomeType(f,'side_job',{now:'2026-08-07T13:10:00.000Z'});assert.equal(archived.ok,true);
  const tx=archived.finance.transactions.find(x=>x.id==='side_income');assert.equal(tx.incomeTypeId,'side_job');
  const item=archived.finance.incomeTypes.find(x=>x.id==='side_job');assert.equal(item.archived,true);
  assert.equal(core.getAnalyticsSummary(archived.finance,{dateFrom:'2026-08-07',dateTo:'2026-08-07'}).income,1250);
});

test('Part1 transfer and Part2 reserve semantics remain intact with Part3 analytics',()=>{
  let f=baseFinance();f=core.createAccount(f,{id:'cash',name:'Cash'},{now:'2026-08-07T14:00:00.000Z'}).finance;
  const tr=core.createTransaction(f,{type:'TRANSFER',amount:300,fromAccountId:'card',toAccountId:'cash',date:'2026-08-07'},{now:'2026-08-07T14:05:00.000Z',idFactory:()=> 'transfer'});assert.equal(tr.ok,true);f=tr.finance;
  const before=core.getTotalBalance(f);const reserve=core.createReserve(f,{name:'Машина',amount:200},{now:'2026-08-07T14:10:00.000Z',idFactory:()=> 'car'});assert.equal(reserve.ok,true);f=reserve.finance;
  assert.equal(core.getTotalBalance(f),before);
  const a=core.getAnalyticsSummary(f,{dateFrom:'2026-08-07',dateTo:'2026-08-07'});assert.equal(a.income,1000);assert.equal(a.expense,0);assert.equal(a.difference,1000);
});
