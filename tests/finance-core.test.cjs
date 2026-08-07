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

test('legacy migration preserves reserve as legacy and migrates only completed events',()=>{
  const legacyFinance={
    '2026-08-07':{expenses:[{id:'e1',amount:'250',category:'food',comment:'магазин',time:'17:42',createdAt:'2026-08-07T17:42:00.000Z'}]}
  };
  const legacyContext={
    availableBalance:'1000',reserveBalance:'5000',
    incomes:[
      {id:'i1',amount:'2000',status:'received',title:'зарплата',date:'2026-08-07',completedAt:'2026-08-07T10:10:00.000Z'},
      {id:'i2',amount:'3000',status:'planned',title:'будущее',date:'2026-08-10'}
    ],
    obligations:[
      {id:'o1',amount:'500',status:'paid',title:'связь',date:'2026-08-07',completedAt:'2026-08-07T12:00:00.000Z'},
      {id:'o2',amount:'700',status:'planned',title:'аренда',date:'2026-08-10'}
    ],
    operations:[{id:'adj1',type:'adjustment',amount:'100',date:'2026-08-07',title:'коррекция'}]
  };
  const r=core.migrateLegacyState({finance:legacyFinance,financeContext:legacyContext,archives:{},now:'2026-08-07T18:00:00.000Z',idFactory:(p)=>`${p}_generated`});
  assert.equal(r.migrated,true);
  assert.equal(r.finance.schemaVersion,2);
  assert.equal(r.finance.migration.checkpoint,core.MIGRATION_CHECKPOINT);
  assert.equal(r.finance.accounts.length,1);
  assert.equal(r.financeContext.reserveBalance,'5000');
  assert.equal(r.financeContext.incomes.length,1);
  assert.equal(r.financeContext.incomes[0].id,'i2');
  assert.equal(r.financeContext.obligations.length,1);
  assert.equal(r.financeContext.obligations[0].id,'o2');
  assert.equal(r.finance.transactions.filter(x=>x.type==='INCOME').length,1);
  assert.equal(r.finance.transactions.filter(x=>x.id==='o1'&&x.type==='EXPENSE').length,1);
  assert.ok(r.archives.financeV1MigrationBackup);
  assert.equal(r.archives.financeV1MigrationBackup.financeContext.reserveBalance,'5000');
  const anchor=r.finance.transactions.find(x=>x.systemKind==='MIGRATION_ANCHOR');
  assert.ok(anchor);
  assert.equal(anchor.accountId,'account_main');
  const total=r.finance.transactions.reduce((sum,tx)=>sum+core.accountEffect(tx,'account_main'),0);
  assert.equal(Math.round(total*100)/100,1000);
});

test('migration backup is created once and migration is idempotent',()=>{
  const originalBackup={createdAt:'old',finance:{sentinel:true},financeContext:{reserveBalance:'777'}};
  const first=core.migrateLegacyState({
    finance:{'2026-08-07':{expenses:[{id:'e1',amount:'10',category:'food'}]}},
    financeContext:{availableBalance:'90',reserveBalance:'20',incomes:[],obligations:[],operations:[]},
    archives:{financeV1MigrationBackup:originalBackup},now:'2026-08-07T18:00:00.000Z',idFactory:p=>`${p}_1`
  });
  assert.deepEqual(first.archives.financeV1MigrationBackup,originalBackup);
  const second=core.migrateLegacyState({finance:first.finance,financeContext:first.financeContext,archives:first.archives,now:'2026-08-08T18:00:00.000Z',idFactory:p=>`${p}_2`});
  assert.equal(second.migrated,false);
  assert.equal(second.finance.transactions.length,first.finance.transactions.length);
  assert.deepEqual(second.finance.transactions.map(x=>x.id),first.finance.transactions.map(x=>x.id));
  assert.deepEqual(second.archives.financeV1MigrationBackup,originalBackup);
});


test('balances are derived from expense, income and transfer operations',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true},{now:'2026-08-07T00:00:00.000Z'}).finance;
  f=core.createAccount(f,{id:'a2',name:'Наличные'},{now:'2026-08-07T00:00:00.000Z'}).finance;
  f=core.createTransaction(f,{id:'in',type:'INCOME',amount:10000,accountId:'a1',incomeTypeId:'personal',date:'2026-08-07'},{now:'2026-08-07T10:00:00.000Z'}).finance;
  f=core.createTransaction(f,{id:'out',type:'EXPENSE',amount:2000,accountId:'a1',categoryId:'food',date:'2026-08-07'},{now:'2026-08-07T11:00:00.000Z'}).finance;
  f=core.createTransaction(f,{id:'move',type:'TRANSFER',amount:3000,fromAccountId:'a1',toAccountId:'a2',date:'2026-08-07'},{now:'2026-08-07T12:00:00.000Z'}).finance;
  assert.equal(core.getAccountBalance(f,'a1'),5000);
  assert.equal(core.getAccountBalance(f,'a2'),3000);
  assert.equal(core.getTotalBalance(f),8000);
});

test('editing and deleting transactions recalculate balances without double effects',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true},{now:'2026-08-07T00:00:00.000Z'}).finance;
  f=core.createTransaction(f,{id:'anchor',type:'ADJUSTMENT',amount:1000,accountId:'a1',date:'2026-08-07'}).finance;
  f=core.createTransaction(f,{id:'e1',type:'EXPENSE',amount:100,accountId:'a1',categoryId:'food',date:'2026-08-07'}).finance;
  assert.equal(core.getAccountBalance(f,'a1'),900);
  const edited=core.updateTransaction(f,'e1',{amount:150});assert.equal(edited.ok,true);f=edited.finance;
  assert.equal(core.getAccountBalance(f,'a1'),850);
  const deleted=core.deleteTransaction(f,'e1');assert.equal(deleted.ok,true);f=deleted.finance;
  assert.equal(core.getAccountBalance(f,'a1'),1000);
});

test('migration anchors are hidden and cannot be edited or deleted',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f.accounts=[{id:'a1',name:'Карта',active:true,archived:false,isDefault:true,createdAt:'2026-08-07T00:00:00.000Z'}];
  f.transactions=[core.normalizeTransaction({id:'m1',type:'ADJUSTMENT',amount:1000,accountId:'a1',systemKind:'MIGRATION_ANCHOR',date:'2026-08-07'},'2026-08-07T00:00:00.000Z')];
  assert.equal(core.getTransactions(f).length,0);
  assert.equal(core.getTransactions(f,{includeSystem:true}).length,1);
  assert.equal(core.updateTransaction(f,'m1',{amount:5}).error,'SYSTEM_LOCKED');
  assert.equal(core.deleteTransaction(f,'m1').error,'SYSTEM_LOCKED');
});

test('transaction filters use the same source of truth',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;
  f=core.createTransaction(f,{id:'e1',type:'EXPENSE',amount:100,accountId:'a1',categoryId:'food',description:'магазин',date:'2026-08-06'}).finance;
  f=core.createTransaction(f,{id:'e2',type:'EXPENSE',amount:200,accountId:'a1',categoryId:'transport',description:'бензин',date:'2026-08-07'}).finance;
  f=core.createTransaction(f,{id:'i1',type:'INCOME',amount:500,accountId:'a1',incomeTypeId:'personal',description:'работа',date:'2026-08-07'}).finance;
  assert.deepEqual(core.getTransactions(f,{type:'EXPENSE',dateFrom:'2026-08-07'}).map(x=>x.id),['e2']);
  assert.deepEqual(core.getTransactions(f,{categoryId:'food'}).map(x=>x.id),['e1']);
  assert.deepEqual(core.getTransactions(f,{search:'бенз'}).map(x=>x.id),['e2']);
});
