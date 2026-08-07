const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../js/finance-core.js');

function funded(amount=10000){
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'card',name:'Карта',isDefault:true}).finance;
  f=core.createAccount(f,{id:'cash',name:'Наличные'}).finance;
  f=core.createTransaction(f,{id:'fund',type:'ADJUSTMENT',amount,accountId:'card',date:'2026-08-07'}).finance;
  return f;
}

test('Part2 reload preserves reserves obligations balances and freeMoney',()=>{
  let f=funded(20000);
  f=core.createReserve(f,{id:'r1',name:'Машина',amount:5000,targetAmount:110000},{fromDate:'2026-08-07'}).finance;
  f=core.createObligation(f,{id:'o1',name:'Интернет',amount:850,dueDate:'2026-08-12'},{fromDate:'2026-08-07'}).finance;
  const before={total:core.getTotalBalance(f),reserved:core.getTotalReservedAmount(f),upcoming:core.getUpcomingObligationsTotal(f,{fromDate:'2026-08-07'}),free:core.getFreeMoney(f,{fromDate:'2026-08-07'})};
  const reload=core.normalizeFinance(JSON.parse(JSON.stringify(f)),'2026-08-07T20:00:00.000Z');
  assert.equal(reload.reserves.length,1);assert.equal(reload.obligations.length,1);
  assert.deepEqual({total:core.getTotalBalance(reload),reserved:core.getTotalReservedAmount(reload),upcoming:core.getUpcomingObligationsTotal(reload,{fromDate:'2026-08-07'}),free:core.getFreeMoney(reload,{fromDate:'2026-08-07'})},before);
});

test('30-day upcoming window counts overdue and near ACTIVE, but not far PAID or CANCELLED',()=>{
  let f=funded(30000);
  const rows=[
    {id:'overdue',name:'Просрочено',amount:100,dueDate:'2026-08-01'},
    {id:'near',name:'Скоро',amount:200,dueDate:'2026-09-06'},
    {id:'far',name:'Далеко',amount:300,dueDate:'2026-09-07'}
  ];
  for(const row of rows)f=core.createObligation(f,row,{fromDate:'2026-08-07'}).finance;
  f.obligations.find(x=>x.id==='far').status='CANCELLED';
  f.obligations.push(core.normalizeObligation({id:'paid',name:'Оплаченное',amount:400,dueDate:'2026-08-10',status:'PAID'},f.obligations.length));
  assert.deepEqual(core.getUpcomingObligations(f,{fromDate:'2026-08-07'}).map(x=>x.id),['overdue','near']);
  assert.equal(core.getUpcomingObligationsTotal(f,{fromDate:'2026-08-07'}),300);
});

test('historical inconsistent state may be negative and coverage reports shortfall instead of breaking',()=>{
  let f=funded(1000);
  f.reserves=[core.normalizeReserve({id:'legacy-r',name:'Старый',amount:1200},0)];
  f.obligations=[core.normalizeObligation({id:'legacy-o',name:'Счёт',amount:500,dueDate:'2026-08-10',status:'ACTIVE'},0)];
  const coverage=core.getObligationCoverage(f,{fromDate:'2026-08-07'});
  assert.equal(coverage.free,-700);assert.equal(coverage.covered,false);assert.equal(coverage.shortfall,700);
});

test('legacy planned income survives Part2 migration and never changes total or free money',()=>{
  let f=funded(5000);const context={reserveBalance:'',obligations:[],incomes:[{id:'future-income',amount:'10000',date:'2026-08-20',status:'planned',title:'Будущая зарплата'}]};
  const beforeTotal=core.getTotalBalance(f);const beforeFree=core.getFreeMoney(f,{fromDate:'2026-08-07'});
  const r=core.migratePart2State({finance:f,financeContext:context,now:'2026-08-07T20:00:00.000Z'});
  assert.deepEqual(r.financeContext.incomes,context.incomes);assert.equal(core.getTotalBalance(r.finance),beforeTotal);assert.equal(core.getFreeMoney(r.finance,{fromDate:'2026-08-07'}),beforeFree);
});

test('paid legacy obligation never becomes ACTIVE in Part2 migration',()=>{
  let f=funded(5000);const context={reserveBalance:'',incomes:[],obligations:[{id:'paid-old',title:'Уже оплачено',amount:'500',date:'2026-08-05',status:'paid'},{id:'planned-old',title:'Будущее',amount:'600',date:'2026-08-15',status:'planned'}]};
  const r=core.migratePart2State({finance:f,financeContext:context,now:'2026-08-07T20:00:00.000Z'});
  assert.equal(r.finance.obligations.some(x=>x.id==='paid-old'),false);assert.equal(r.finance.obligations.filter(x=>x.status==='ACTIVE').length,1);assert.equal(r.finance.obligations[0].id,'planned-old');
});

test('INCOME edit and delete regression remains correct with Part2 collections present',()=>{
  let f=funded(1000);f=core.createReserve(f,{id:'r1',name:'Подушка',amount:100},{fromDate:'2026-08-07'}).finance;f=core.createObligation(f,{id:'o1',name:'Связь',amount:100,dueDate:'2026-08-20'},{fromDate:'2026-08-07'}).finance;
  f=core.createTransaction(f,{id:'income',type:'INCOME',amount:500,accountId:'card',incomeTypeId:'personal',date:'2026-08-07'}).finance;assert.equal(core.getTotalBalance(f),1500);
  let r=core.updateTransaction(f,'income',{amount:700});assert.equal(r.ok,true);f=r.finance;assert.equal(core.getTotalBalance(f),1700);assert.equal(f.reserves.length,1);assert.equal(f.obligations.length,1);
  r=core.deleteTransaction(f,'income');assert.equal(r.ok,true);f=r.finance;assert.equal(core.getTotalBalance(f),1000);assert.equal(f.reserves.length,1);assert.equal(f.obligations.length,1);
});

test('TRANSFER remains zero-sum after Part2 state is populated',()=>{
  let f=funded(10000);f=core.createReserve(f,{id:'r1',name:'Машина',amount:2000},{fromDate:'2026-08-07'}).finance;f=core.createObligation(f,{id:'o1',name:'Платёж',amount:500,dueDate:'2026-08-20'},{fromDate:'2026-08-07'}).finance;
  const total=core.getTotalBalance(f);const free=core.getFreeMoney(f,{fromDate:'2026-08-07'});f=core.createTransaction(f,{id:'move2',type:'TRANSFER',amount:3000,fromAccountId:'card',toAccountId:'cash',date:'2026-08-07'}).finance;
  assert.equal(core.getTotalBalance(f),total);assert.equal(core.getFreeMoney(f,{fromDate:'2026-08-07'}),free);assert.equal(core.getAccountBalance(f,'card'),7000);assert.equal(core.getAccountBalance(f,'cash'),3000);
});

test('linked obligation actual amount may differ from plan without rewriting planned amount',()=>{
  let f=funded(10000);f=core.createObligation(f,{id:'o',name:'Интернет',amount:850,dueDate:'2026-08-12'},{fromDate:'2026-08-07'}).finance;f=core.createTransaction(f,{id:'expense',type:'EXPENSE',amount:900,accountId:'card',categoryId:'home',date:'2026-08-12'}).finance;
  f=core.linkObligationToTransaction(f,'o','expense',{now:'2026-08-12T10:00:00.000Z'}).finance;assert.equal(f.obligations.find(x=>x.id==='o').amount,850);
  f=core.updateTransaction(f,'expense',{amount:950},{now:'2026-08-12T11:00:00.000Z'}).finance;assert.equal(f.obligations.find(x=>x.id==='o').amount,850);assert.equal(f.transactions.find(x=>x.id==='expense').amount,950);
});

test('category management keeps history-compatible ids and archives custom category only',()=>{
  let f=funded();let r=core.createOrUpdateCategory(f,{id:'clothes',name:'Одежда'},{now:'2026-08-07T10:00:00.000Z'});assert.equal(r.ok,true);f=r.finance;
  f=core.createTransaction(f,{id:'e-cat',type:'EXPENSE',amount:100,accountId:'card',categoryId:'clothes',date:'2026-08-07'}).finance;
  r=core.archiveCategory(f,'clothes',{now:'2026-08-07T11:00:00.000Z'});assert.equal(r.ok,true);f=r.finance;assert.equal(f.categories.find(x=>x.id==='clothes').archived,true);assert.equal(f.transactions.find(x=>x.id==='e-cat').categoryId,'clothes');
});

test('full JSON roundtrip preserves all Part2 indicators after payment and transfer',()=>{
  let f=funded(25000);f=core.createReserve(f,{id:'r1',name:'Техника',amount:3000,targetAmount:20000},{fromDate:'2026-08-07'}).finance;f=core.createObligation(f,{id:'o1',name:'Коммунальные',amount:6500,dueDate:'2026-08-15'},{fromDate:'2026-08-07'}).finance;
  f=core.createTransaction(f,{id:'move',type:'TRANSFER',amount:2000,fromAccountId:'card',toAccountId:'cash',date:'2026-08-08'}).finance;f=core.payObligation(f,'o1',{accountId:'card',categoryId:'home',date:'2026-08-15',now:'2026-08-15T10:00:00.000Z',idFactory:p=>`${p}_roundtrip`}).finance;
  const snap={total:core.getTotalBalance(f),card:core.getAccountBalance(f,'card'),cash:core.getAccountBalance(f,'cash'),reserved:core.getTotalReservedAmount(f),upcoming:core.getUpcomingObligationsTotal(f,{fromDate:'2026-08-15'}),free:core.getFreeMoney(f,{fromDate:'2026-08-15'}),tx:f.transactions.length,ob:f.obligations.length};
  const reload=core.normalizeFinance(JSON.parse(JSON.stringify(f)),'2026-08-15T20:00:00.000Z');const after={total:core.getTotalBalance(reload),card:core.getAccountBalance(reload,'card'),cash:core.getAccountBalance(reload,'cash'),reserved:core.getTotalReservedAmount(reload),upcoming:core.getUpcomingObligationsTotal(reload,{fromDate:'2026-08-15'}),free:core.getFreeMoney(reload,{fromDate:'2026-08-15'}),tx:reload.transactions.length,ob:reload.obligations.length};assert.deepEqual(after,snap);
});


test('planning deficit is allowed for reserves and obligations', () => {
  let finance = core.createEmptyFinance('2026-08-08T00:00:00.000Z');
  finance = core.createAccount(finance,{id:'main',name:'Основной',isDefault:true},{now:'2026-08-08T00:00:00.000Z'}).finance;
  finance = core.createTransaction(finance,{type:'INCOME',amount:1000,accountId:'main',incomeTypeId:'other',date:'2026-08-08'},{now:'2026-08-08T00:00:00.000Z'}).finance;
  const reserve = core.createReserve(finance,{name:'Загранпаспорт',amount:5000},{now:'2026-08-08T00:00:00.000Z',fromDate:'2026-08-08'});
  assert.equal(reserve.ok,true);assert.equal(reserve.freeMoney,-4000);assert.equal(reserve.hasShortfall,true);
  const obligation = core.createObligation(reserve.finance,{name:'Платёж через месяц',amount:2000,dueDate:'2026-09-07',recurrence:'MONTHLY'},{now:'2026-08-08T00:00:00.000Z',fromDate:'2026-08-08'});
  assert.equal(obligation.ok,true);assert.equal(obligation.hasShortfall,true);assert.equal(obligation.obligation.recurrence,'MONTHLY');
});


test('imported legacy reserve balance can be restored once without creating income',()=>{
  let f=funded(1000);
  f.migration={...f.migration,part2Checkpoint:core.PART2_MIGRATION_CHECKPOINT,legacyReserveStatus:'MIGRATED',legacyReserveAmount:5000};
  f.reserves=[core.normalizeReserve({id:'reserve_legacy_v1',name:'Старый резерв',amount:5000},0)];
  const beforeIncome=f.transactions.filter(x=>x.type==='INCOME').length;
  let r=core.restoreLegacyReserveBalance(f,{accountId:'card',now:'2026-08-08T00:00:00.000Z'});
  assert.equal(r.ok,true);assert.equal(r.restored,true);f=r.finance;
  assert.equal(core.getTotalBalance(f),6000);assert.equal(core.getTotalReservedAmount(f),5000);assert.equal(core.getFreeMoney(f,{fromDate:'2026-08-08'}),1000);
  assert.equal(f.transactions.filter(x=>x.type==='INCOME').length,beforeIncome);
  const repair=f.transactions.find(x=>x.systemKind==='LEGACY_RESERVE_BALANCE');assert.ok(repair);assert.equal(core.isSystemLocked(repair),true);
  r=core.restoreLegacyReserveBalance(f,{accountId:'card',now:'2026-08-08T01:00:00.000Z'});assert.equal(r.restored,false);assert.equal(r.finance.transactions.filter(x=>x.systemKind==='LEGACY_RESERVE_BALANCE').length,1);
});
