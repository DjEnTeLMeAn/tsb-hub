const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../js/finance-core.js');

test('empty finance uses schema v3 with Part 2 collections and default dictionaries',()=>{
  const f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  assert.equal(f.schemaVersion,3);
  assert.deepEqual(f.reserves,[]);
  assert.deepEqual(f.obligations,[]);
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

test('transaction mutations reject missing or inactive account references',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;
  const missing=core.createTransaction(f,{id:'missing',type:'EXPENSE',amount:100,accountId:'unknown',categoryId:'food',date:'2026-08-07'});
  assert.equal(missing.ok,false);
  assert.equal(missing.error,'ACCOUNT_NOT_FOUND');
  assert.equal(missing.finance.transactions.length,0);

  f=core.createAccount(f,{id:'a2',name:'Наличные'}).finance;
  const archived=core.archiveAccount(f,'a2');
  assert.equal(archived.ok,true);
  f=archived.finance;
  const inactive=core.createTransaction(f,{id:'inactive',type:'TRANSFER',amount:100,fromAccountId:'a1',toAccountId:'a2',date:'2026-08-07'});
  assert.equal(inactive.ok,false);
  assert.equal(inactive.error,'ACCOUNT_NOT_FOUND');

  f=core.createTransaction(f,{id:'e1',type:'EXPENSE',amount:100,accountId:'a1',categoryId:'food',date:'2026-08-07'}).finance;
  const edited=core.updateTransaction(f,'e1',{accountId:'unknown'});
  assert.equal(edited.ok,false);
  assert.equal(edited.error,'ACCOUNT_NOT_FOUND');
  assert.equal(edited.finance.transactions.find(x=>x.id==='e1').accountId,'a1');
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
  assert.equal(r.finance.schemaVersion,3);
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


test('serialization keeps balances stable after reload normalization',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;
  f=core.createAccount(f,{id:'a2',name:'Наличные'}).finance;
  f=core.createTransaction(f,{id:'i1',type:'INCOME',amount:5000,accountId:'a1',incomeTypeId:'personal',date:'2026-08-07'}).finance;
  f=core.createTransaction(f,{id:'e1',type:'EXPENSE',amount:700,accountId:'a1',categoryId:'food',date:'2026-08-07'}).finance;
  f=core.createTransaction(f,{id:'t1',type:'TRANSFER',amount:1000,fromAccountId:'a1',toAccountId:'a2',date:'2026-08-07'}).finance;
  const before=[core.getAccountBalance(f,'a1'),core.getAccountBalance(f,'a2'),core.getTotalBalance(f)];
  const afterReload=core.normalizeFinance(JSON.parse(JSON.stringify(f)));
  assert.deepEqual([core.getAccountBalance(afterReload,'a1'),core.getAccountBalance(afterReload,'a2'),core.getTotalBalance(afterReload)],before);
});

test('non-empty account cannot be archived and total balance stays intact',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;
  f=core.createAccount(f,{id:'a2',name:'Наличные'}).finance;
  f=core.createTransaction(f,{id:'i1',type:'INCOME',amount:100,accountId:'a2',incomeTypeId:'other',date:'2026-08-07'}).finance;
  const result=core.archiveAccount(f,'a2');
  assert.equal(result.ok,false);assert.equal(result.error,'ACCOUNT_NOT_EMPTY');assert.equal(core.getTotalBalance(result.finance),100);
});


test('Part 2 migration preserves ambiguous legacy reserve for review and does not create money movements',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;
  f=core.createTransaction(f,{id:'anchor2',type:'ADJUSTMENT',amount:50000,accountId:'a1',date:'2026-08-07'}).finance;
  const before=core.getTotalBalance(f);
  const context={reserveBalance:'15000',incomes:[{id:'pi1',amount:'10000',status:'planned',date:'2026-08-20'}],obligations:[]};
  const r=core.migratePart2State({finance:f,financeContext:context,now:'2026-08-07T20:00:00.000Z'});
  assert.equal(r.migrated,true);
  assert.equal(r.finance.migration.legacyReserveStatus,'REVIEW_REQUIRED');
  assert.equal(r.finance.migration.legacyReserveAmount,15000);
  assert.equal(r.finance.reserves.length,0);
  assert.equal(r.finance.transactions.length,f.transactions.length);
  assert.equal(core.getTotalBalance(r.finance),before);
  assert.deepEqual(r.financeContext.incomes,context.incomes);
});

test('Part 2 migration moves only planned legacy obligations once and keeps balances unchanged',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;
  f=core.createTransaction(f,{id:'anchor3',type:'ADJUSTMENT',amount:20000,accountId:'a1',date:'2026-08-07'}).finance;
  const context={reserveBalance:'',incomes:[{id:'income-plan',amount:'9000',status:'planned',date:'2026-08-25'}],obligations:[
    {id:'legacy-o1',title:'Интернет',amount:'850',date:'2026-08-12',status:'planned',comment:'дом'},
    {id:'legacy-paid',title:'Оплачено раньше',amount:'500',date:'2026-08-01',status:'paid'},
    {id:'legacy-bad',title:'Без даты',amount:'100',date:'',status:'planned'}
  ]};
  const before=core.getTotalBalance(f);
  const first=core.migratePart2State({finance:f,financeContext:context,now:'2026-08-07T20:00:00.000Z',idFactory:p=>`${p}_x`});
  assert.equal(first.finance.obligations.length,1);
  assert.equal(first.finance.obligations[0].id,'legacy-o1');
  assert.equal(first.finance.obligations[0].status,'ACTIVE');
  assert.equal(first.finance.migration.legacyObligationsMigrated,1);
  assert.equal(first.finance.migration.legacyObligationsSkipped,1);
  assert.equal(core.getTotalBalance(first.finance),before);
  const second=core.migratePart2State({finance:first.finance,financeContext:context,now:'2026-08-08T20:00:00.000Z'});
  assert.equal(second.migrated,false);
  assert.equal(second.finance.obligations.length,1);
  assert.equal(core.getTotalBalance(second.finance),before);
  assert.deepEqual(second.financeContext.incomes,context.incomes);
});

test('reserve and obligation normalization enforces non-negative reserve and valid basic fields',()=>{
  const reserve=core.normalizeReserve({id:'r1',name:'Машина',amount:-50,targetAmount:'110000'},0,'2026-08-07T00:00:00.000Z');
  assert.equal(reserve.amount,0);
  assert.equal(reserve.targetAmount,110000);
  const obligation=core.normalizeObligation({id:'o1',name:'Связь',amount:'350',dueDate:'2026-08-21',recurrence:'monthly',status:'active'},0,'2026-08-07T00:00:00.000Z');
  assert.equal(obligation.amount,350);
  assert.equal(obligation.dueDate,'2026-08-21');
  assert.equal(obligation.recurrence,'MONTHLY');
  assert.equal(obligation.status,'ACTIVE');
});


test('reserve API changes allocation but never account balances',()=>{
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;
  f=core.createTransaction(f,{id:'money-r',type:'ADJUSTMENT',amount:50000,accountId:'a1',date:'2026-08-07'}).finance;
  const total=core.getTotalBalance(f);const free0=core.getFreeMoney(f,{fromDate:'2026-08-07'});
  let r=core.createReserve(f,{id:'r1',name:'Машина',amount:10000,targetAmount:110000},{now:'2026-08-07T10:00:00.000Z',fromDate:'2026-08-07'});assert.equal(r.ok,true);f=r.finance;
  assert.equal(core.getTotalBalance(f),total);assert.equal(core.getTotalReservedAmount(f),10000);assert.equal(core.getFreeMoney(f,{fromDate:'2026-08-07'}),free0-10000);
  r=core.adjustReserveAmount(f,'r1',5000,{now:'2026-08-07T11:00:00.000Z',fromDate:'2026-08-07'});assert.equal(r.ok,true);f=r.finance;assert.equal(core.getTotalReservedAmount(f),15000);
  r=core.adjustReserveAmount(f,'r1',-3000,{now:'2026-08-07T12:00:00.000Z',fromDate:'2026-08-07'});assert.equal(r.ok,true);f=r.finance;assert.equal(core.getTotalReservedAmount(f),12000);
  r=core.archiveReserve(f,'r1');assert.equal(r.ok,true);f=r.finance;assert.equal(core.getTotalReservedAmount(f),0);assert.equal(core.getTotalBalance(f),total);
});

test('reserve API rejects negative amounts but allows planning over-allocation',()=>{
  let f=core.createEmptyFinance();f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;f=core.createTransaction(f,{id:'m',type:'ADJUSTMENT',amount:1000,accountId:'a1',date:'2026-08-07'}).finance;
  assert.equal(core.createReserve(f,{name:'bad',amount:-1},{fromDate:'2026-08-07'}).error,'INVALID_RESERVE_AMOUNT');
  const planned=core.createReserve(f,{name:'too much',amount:1500},{fromDate:'2026-08-07'});
  assert.equal(planned.ok,true);assert.equal(planned.freeMoney,-500);assert.equal(planned.hasShortfall,true);
  let r=core.createReserve(f,{id:'r',name:'ok',amount:500},{fromDate:'2026-08-07'});f=r.finance;
  assert.equal(core.adjustReserveAmount(f,'r',-600,{fromDate:'2026-08-07'}).error,'INVALID_RESERVE_AMOUNT');
});

test('legacy reserve explicit import is idempotent and creates no transaction',()=>{
  let f=core.createEmptyFinance();f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;f=core.createTransaction(f,{id:'m',type:'ADJUSTMENT',amount:10000,accountId:'a1',date:'2026-08-07'}).finance;
  f.migration={...f.migration,part2Checkpoint:core.PART2_MIGRATION_CHECKPOINT,legacyReserveStatus:'REVIEW_REQUIRED',legacyReserveAmount:15000};
  const txCount=f.transactions.length;const total=core.getTotalBalance(f);let r=core.importLegacyReserve(f,{now:'2026-08-07T10:00:00.000Z'});assert.equal(r.ok,true);assert.equal(r.imported,true);f=r.finance;
  assert.equal(f.transactions.length,txCount);assert.equal(core.getTotalBalance(f),total);assert.equal(core.getTotalReservedAmount(f),15000);assert.equal(f.migration.legacyReserveStatus,'MIGRATED');
  r=core.importLegacyReserve(f,{now:'2026-08-08T10:00:00.000Z'});assert.equal(r.ok,true);assert.equal(r.imported,false);assert.equal(r.finance.reserves.length,1);
});

test('active obligation affects free money but not account balance',()=>{
  let f=core.createEmptyFinance();f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;f=core.createTransaction(f,{id:'m',type:'ADJUSTMENT',amount:10000,accountId:'a1',date:'2026-08-07'}).finance;
  const total=core.getTotalBalance(f);let r=core.createObligation(f,{id:'o1',name:'Интернет',amount:850,dueDate:'2026-08-12',recurrence:'NONE'},{now:'2026-08-07T10:00:00.000Z',fromDate:'2026-08-07'});assert.equal(r.ok,true);f=r.finance;
  assert.equal(core.getTotalBalance(f),total);assert.equal(core.getUpcomingObligationsTotal(f,{fromDate:'2026-08-07'}),850);assert.equal(core.getFreeMoney(f,{fromDate:'2026-08-07'}),9150);
});

test('payObligation creates exactly one EXPENSE and avoids double subtraction',()=>{
  let f=core.createEmptyFinance();f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;f=core.createTransaction(f,{id:'m',type:'ADJUSTMENT',amount:10000,accountId:'a1',date:'2026-08-07'}).finance;
  f=core.createObligation(f,{id:'o1',name:'Интернет',amount:850,dueDate:'2026-08-12'},{fromDate:'2026-08-07'}).finance;const freeBefore=core.getFreeMoney(f,{fromDate:'2026-08-07'});const txBefore=f.transactions.length;
  const r=core.payObligation(f,'o1',{accountId:'a1',categoryId:'home',date:'2026-08-12',now:'2026-08-12T09:00:00.000Z',idFactory:p=>`${p}_paid`});assert.equal(r.ok,true);f=r.finance;
  assert.equal(f.transactions.length,txBefore+1);assert.equal(f.transactions.filter(x=>x.type==='EXPENSE').length,1);assert.equal(core.getAccountBalance(f,'a1'),9150);
  assert.equal(f.obligations.find(x=>x.id==='o1').status,'PAID');assert.equal(core.getUpcomingObligationsTotal(f,{fromDate:'2026-08-07'}),0);assert.equal(core.getFreeMoney(f,{fromDate:'2026-08-07'}),freeBefore);
});

test('linking existing expense creates no second expense and deletion reactivates obligation',()=>{
  let f=core.createEmptyFinance();f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;f=core.createTransaction(f,{id:'m',type:'ADJUSTMENT',amount:10000,accountId:'a1',date:'2026-08-07'}).finance;
  f=core.createObligation(f,{id:'o1',name:'Связь',amount:350,dueDate:'2026-08-21'},{fromDate:'2026-08-07'}).finance;f=core.createTransaction(f,{id:'e-existing',type:'EXPENSE',amount:400,accountId:'a1',categoryId:'home',date:'2026-08-20'}).finance;const txCount=f.transactions.length;
  let r=core.linkObligationToTransaction(f,'o1','e-existing',{now:'2026-08-20T10:00:00.000Z'});assert.equal(r.ok,true);f=r.finance;assert.equal(f.transactions.length,txCount);assert.equal(f.obligations.find(x=>x.id==='o1').status,'PAID');assert.equal(f.obligations.find(x=>x.id==='o1').amount,350);
  r=core.updateTransaction(f,'e-existing',{amount:450},{now:'2026-08-20T11:00:00.000Z'});assert.equal(r.ok,true);f=r.finance;assert.equal(f.obligations.find(x=>x.id==='o1').amount,350);assert.equal(f.transactions.length,txCount);
  r=core.deleteTransaction(f,'e-existing',{now:'2026-08-20T12:00:00.000Z'});assert.equal(r.ok,true);f=r.finance;assert.equal(f.obligations.find(x=>x.id==='o1').status,'ACTIVE');assert.equal(f.obligations.find(x=>x.id==='o1').linkedTransactionId,null);
});

test('monthly obligation creates only next instance and rolls it back if payment expense is deleted',()=>{
  let f=core.createEmptyFinance();f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;f=core.createTransaction(f,{id:'m',type:'ADJUSTMENT',amount:20000,accountId:'a1',date:'2026-08-07'}).finance;
  f=core.createObligation(f,{id:'monthly',name:'Интернет',amount:850,dueDate:'2026-08-31',recurrence:'MONTHLY'},{fromDate:'2026-08-07'}).finance;
  let r=core.payObligation(f,'monthly',{accountId:'a1',categoryId:'home',date:'2026-08-31',now:'2026-08-31T10:00:00.000Z',idFactory:p=>p==='txn'?'paid-monthly':'next-monthly'});assert.equal(r.ok,true);f=r.finance;
  const old=f.obligations.find(x=>x.id==='monthly');assert.equal(old.status,'PAID');assert.equal(f.obligations.length,2);const next=f.obligations.find(x=>x.recurrenceParentId==='monthly');assert.equal(next.dueDate,'2026-09-30');assert.equal(next.status,'ACTIVE');
  r=core.deleteTransaction(f,old.linkedTransactionId,{now:'2026-08-31T11:00:00.000Z'});assert.equal(r.ok,true);f=r.finance;assert.equal(f.obligations.length,1);assert.equal(f.obligations[0].status,'ACTIVE');assert.equal(f.obligations[0].nextObligationId,null);
});

test('coverage selector uses the same free-money calculation',()=>{
  let f=core.createEmptyFinance();f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;f=core.createTransaction(f,{id:'m',type:'ADJUSTMENT',amount:5000,accountId:'a1',date:'2026-08-07'}).finance;
  f=core.createReserve(f,{id:'r1',name:'Подушка',amount:2000},{fromDate:'2026-08-07'}).finance;f=core.createObligation(f,{id:'o1',name:'Коммуналка',amount:2500,dueDate:'2026-08-20'},{fromDate:'2026-08-07'}).finance;
  const c=core.getObligationCoverage(f,{fromDate:'2026-08-07'});assert.equal(c.free,core.getFreeMoney(f,{fromDate:'2026-08-07'}));assert.equal(c.covered,true);assert.equal(c.shortfall,0);
});


test('Part3 analytics uses only INCOME and EXPENSE inside the selected period',()=>{
  let f=core.createEmptyFinance('2026-08-01T00:00:00.000Z');
  f=core.createAccount(f,{id:'cash',name:'Cash',isDefault:true},{now:'2026-08-01T00:00:00.000Z'}).finance;
  f=core.createAccount(f,{id:'cash2',name:'Cash 2'},{now:'2026-08-01T00:00:00.000Z'}).finance;
  const add=d=>{const r=core.createTransaction(f,d,{now:`${d.date}T12:00:00.000Z`,idFactory:()=>`t_${Math.random()}`});assert.equal(r.ok,true);f=r.finance};
  add({type:'INCOME',amount:10000,accountId:'cash',incomeTypeId:'personal',date:'2026-08-01'});
  add({type:'EXPENSE',amount:1200,accountId:'cash',categoryId:'food',date:'2026-08-02'});
  add({type:'EXPENSE',amount:800,accountId:'cash',categoryId:'food',date:'2026-08-03'});
  add({type:'EXPENSE',amount:500,accountId:'cash',categoryId:'transport',date:'2026-08-03'});
  add({type:'TRANSFER',amount:300,fromAccountId:'cash',toAccountId:'cash2',date:'2026-08-03'});
  add({type:'ADJUSTMENT',amount:250,accountId:'cash',date:'2026-08-04'});
  add({type:'EXPENSE',amount:999,accountId:'cash',categoryId:'other',date:'2026-07-31'});
  const s=core.getAnalyticsSummary(f,{dateFrom:'2026-08-01',dateTo:'2026-08-04'});
  assert.equal(s.income,10000);
  assert.equal(s.expense,2500);
  assert.equal(s.difference,7500);
  assert.equal(s.expenseCount,3);
  assert.equal(s.days,4);
  assert.equal(s.averageExpensePerDay,625);
  assert.deepEqual(s.categoryBreakdown.map(x=>[x.categoryId,x.amount,x.count,x.share]),[['food',2000,2,80],['transport',500,1,20]]);
});

test('Part3 analytics date span is inclusive and empty periods stay zero',()=>{
  const f=core.createEmptyFinance('2026-08-01T00:00:00.000Z');
  assert.equal(core.dateSpanDays('2026-08-01','2026-08-01'),1);
  assert.equal(core.dateSpanDays('2026-08-01','2026-08-07'),7);
  const s=core.getAnalyticsSummary(f,{dateFrom:'2026-08-01',dateTo:'2026-08-07'});
  assert.deepEqual({income:s.income,expense:s.expense,difference:s.difference,expenseCount:s.expenseCount,average:s.averageExpensePerDay,days:s.days},{income:0,expense:0,difference:0,expenseCount:0,average:0,days:7});
});


test('Part3 reconciliation creates one ADJUSTMENT and reaches actual account balance',()=>{
  let f=core.createEmptyFinance('2026-08-01T00:00:00.000Z');
  f=core.createAccount(f,{id:'card',name:'Card',isDefault:true},{now:'2026-08-01T00:00:00.000Z'}).finance;
  f=core.createTransaction(f,{type:'INCOME',amount:10000,accountId:'card',incomeTypeId:'personal',date:'2026-08-01'},{now:'2026-08-01T12:00:00.000Z',idFactory:()=> 'inc'}).finance;
  const beforeAnalytics=core.getAnalyticsSummary(f,{dateFrom:'2026-08-01',dateTo:'2026-08-07'});
  const r=core.reconcileAccount(f,'card','9750',{date:'2026-08-07',now:'2026-08-07T12:00:00.000Z',idFactory:()=> 'rec'});
  assert.equal(r.ok,true);assert.equal(r.changed,true);assert.equal(r.difference,-250);
  assert.equal(r.transaction.type,'ADJUSTMENT');assert.equal(r.transaction.systemKind,core.SYSTEM_KINDS.RECONCILIATION);
  assert.equal(core.getAccountBalance(r.finance,'card'),9750);
  assert.equal(r.finance.transactions.filter(x=>x.systemKind===core.SYSTEM_KINDS.RECONCILIATION).length,1);
  const afterAnalytics=core.getAnalyticsSummary(r.finance,{dateFrom:'2026-08-01',dateTo:'2026-08-07'});
  assert.deepEqual({income:afterAnalytics.income,expense:afterAnalytics.expense,difference:afterAnalytics.difference},{income:beforeAnalytics.income,expense:beforeAnalytics.expense,difference:beforeAnalytics.difference});
});

test('Part3 reconciliation with matching balance creates no transaction',()=>{
  let f=core.createEmptyFinance('2026-08-01T00:00:00.000Z');f=core.createAccount(f,{id:'cash',name:'Cash',isDefault:true},{now:'2026-08-01T00:00:00.000Z'}).finance;
  const count=f.transactions.length;const r=core.reconcileAccount(f,'cash','0',{now:'2026-08-07T12:00:00.000Z'});
  assert.equal(r.ok,true);assert.equal(r.changed,false);assert.equal(r.difference,0);assert.equal(r.finance.transactions.length,count);
});
