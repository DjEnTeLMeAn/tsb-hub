from pathlib import Path

CORE=Path('js/finance-core.js')
APP=Path('js/app.js')
TEST=Path('tests/finance-core.test.cjs')
core=CORE.read_text()
app=APP.read_text()
tests=TEST.read_text()

def once(s, old, new, label):
    if old not in s:
        raise RuntimeError(f'missing anchor: {label}')
    if s.count(old) != 1:
        raise RuntimeError(f'non-unique anchor: {label} ({s.count(old)})')
    return s.replace(old,new,1)

core=once(core,
"  const FINANCE_SCHEMA_VERSION=2;\n  const MIGRATION_CHECKPOINT='FINANCE_V2_PART1_COMPLETE';\n  const TYPES=Object.freeze({EXPENSE:'EXPENSE',INCOME:'INCOME',TRANSFER:'TRANSFER',ADJUSTMENT:'ADJUSTMENT'});\n  const SYSTEM_KINDS=Object.freeze({MIGRATION_ANCHOR:'MIGRATION_ANCHOR'});",
"  const FINANCE_SCHEMA_VERSION=3;\n  const MIGRATION_CHECKPOINT='FINANCE_V2_PART1_COMPLETE';\n  const PART2_MIGRATION_CHECKPOINT='FINANCE_V2_PART2_MODEL_COMPLETE';\n  const TYPES=Object.freeze({EXPENSE:'EXPENSE',INCOME:'INCOME',TRANSFER:'TRANSFER',ADJUSTMENT:'ADJUSTMENT'});\n  const SYSTEM_KINDS=Object.freeze({MIGRATION_ANCHOR:'MIGRATION_ANCHOR'});\n  const OBLIGATION_STATUS=Object.freeze({ACTIVE:'ACTIVE',PAID:'PAID',CANCELLED:'CANCELLED'});\n  const OBLIGATION_RECURRENCE=Object.freeze({NONE:'NONE',MONTHLY:'MONTHLY'});",
'constants')

core=once(core,
"  const signedMoney=value=>moneyNumber(value);",
"  const signedMoney=value=>moneyNumber(value);\n  const nonNegativeMoney=value=>Math.max(0,moneyNumber(value));",
'money helpers')

core=once(core,
"      accounts:[],\n      transactions:[],\n      categories:createDefaultCategories(createdAt),\n      incomeTypes:createDefaultIncomeTypes(createdAt)",
"      accounts:[],\n      transactions:[],\n      categories:createDefaultCategories(createdAt),\n      incomeTypes:createDefaultIncomeTypes(createdAt),\n      reserves:[],\n      obligations:[]",
'empty finance collections')

insert_before="  function normalizeFinance(value,createdAt=nowISO()){"
if insert_before not in core: raise RuntimeError('normalizeFinance anchor missing')
model_code=r'''  function normalizeReserve(reserve,index=0,createdAt=nowISO()){
    const source=reserve&&typeof reserve==='object'?reserve:{};
    const rawTarget=source.targetAmount;
    const target=rawTarget===null||rawTarget===undefined||text(rawTarget)===''?null:positiveMoney(rawTarget);
    return {
      id:text(source.id)||makeId('reserve'),
      name:text(source.name)||`Резерв ${index+1}`,
      amount:nonNegativeMoney(source.amount),
      targetAmount:target&&target>0?target:null,
      active:source.active!==false&&!source.archived,
      archived:bool(source.archived),
      createdAt:text(source.createdAt)||createdAt,
      updatedAt:text(source.updatedAt)||text(source.createdAt)||createdAt,
      sortOrder:Number.isFinite(Number(source.sortOrder))?Number(source.sortOrder):index
    };
  }
  function normalizeObligation(obligation,index=0,createdAt=nowISO()){
    const source=obligation&&typeof obligation==='object'?obligation:{};
    const rawStatus=text(source.status).toUpperCase();
    const rawRecurrence=text(source.recurrence).toUpperCase();
    return {
      id:text(source.id)||makeId('obligation'),
      name:text(source.name??source.title)||`Платёж ${index+1}`,
      amount:positiveMoney(source.amount),
      dueDate:validDate(source.dueDate??source.date)?String(source.dueDate??source.date):'',
      recurrence:Object.values(OBLIGATION_RECURRENCE).includes(rawRecurrence)?rawRecurrence:OBLIGATION_RECURRENCE.NONE,
      status:Object.values(OBLIGATION_STATUS).includes(rawStatus)?rawStatus:OBLIGATION_STATUS.ACTIVE,
      note:text(source.note??source.comment),
      linkedTransactionId:text(source.linkedTransactionId)||null,
      createdAt:text(source.createdAt)||createdAt,
      updatedAt:text(source.updatedAt)||text(source.createdAt)||createdAt
    };
  }

'''
core=core.replace(insert_before,model_code+insert_before,1)

old_norm="""    const transactions=(Array.isArray(source.transactions)?source.transactions:[]).map(item=>normalizeTransaction(item,createdAt)).filter(Boolean);\n    if(accounts.length&&!accounts.some(a=>a.isDefault))accounts[0].isDefault=true;"""
new_norm="""    const transactions=(Array.isArray(source.transactions)?source.transactions:[]).map(item=>normalizeTransaction(item,createdAt)).filter(Boolean);\n    const reserves=(Array.isArray(source.reserves)?source.reserves:[]).map((item,index)=>normalizeReserve(item,index,createdAt));\n    const obligations=(Array.isArray(source.obligations)?source.obligations:[]).map((item,index)=>normalizeObligation(item,index,createdAt));\n    if(accounts.length&&!accounts.some(a=>a.isDefault))accounts[0].isDefault=true;"""
core=once(core,old_norm,new_norm,'normalize collections')

core=once(core,
"      migration:{checkpoint:text(source.migration?.checkpoint),completedAt:text(source.migration?.completedAt)},\n      accounts,categories,incomeTypes,transactions",
"      migration:{\n        checkpoint:text(source.migration?.checkpoint),\n        completedAt:text(source.migration?.completedAt),\n        part2Checkpoint:text(source.migration?.part2Checkpoint),\n        part2CompletedAt:text(source.migration?.part2CompletedAt),\n        legacyReserveStatus:text(source.migration?.legacyReserveStatus),\n        legacyReserveAmount:nonNegativeMoney(source.migration?.legacyReserveAmount),\n        legacyObligationsMigrated:Number(source.migration?.legacyObligationsMigrated||0),\n        legacyObligationsSkipped:Number(source.migration?.legacyObligationsSkipped||0)\n      },\n      accounts,categories,incomeTypes,transactions,reserves,obligations",
'normalize migration metadata')

core=once(core,
"  function isMigrationComplete(finance){\n    return Number(finance?.schemaVersion)===FINANCE_SCHEMA_VERSION&&finance?.migration?.checkpoint===MIGRATION_CHECKPOINT;\n  }",
"  function isMigrationComplete(finance){\n    return Number(finance?.schemaVersion)>=2&&finance?.migration?.checkpoint===MIGRATION_CHECKPOINT;\n  }",
'part1 migration complete compatibility')

core=once(core,
"    const alreadyV2=Number(sourceFinance?.schemaVersion)===FINANCE_SCHEMA_VERSION&&Array.isArray(sourceFinance?.transactions);",
"    const alreadyV2=Number(sourceFinance?.schemaVersion)>=2&&Array.isArray(sourceFinance?.transactions);",
'part1 v2 compatibility')

anchor="\n\n  function roundMoney(value){return Math.round((Number(value)||0)*100)/100}"
if anchor not in core: raise RuntimeError('roundMoney anchor missing')
part2_migration=r'''

  function isPart2MigrationComplete(finance){
    return Number(finance?.schemaVersion)>=FINANCE_SCHEMA_VERSION&&finance?.migration?.part2Checkpoint===PART2_MIGRATION_CHECKPOINT;
  }
  function migratePart2State({finance,financeContext,now=nowISO(),idFactory=makeId}={}){
    const sourceContext=financeContext&&typeof financeContext==='object'?clone(financeContext):{};
    const state=normalizeFinance(finance,now);
    if(isPart2MigrationComplete(state))return {finance:state,financeContext:sourceContext,migrated:false};

    const beforeBalance=getTotalBalance(state);
    const existingIds=new Set(state.obligations.map(item=>item.id));
    let migratedObligations=0;
    let skippedObligations=0;
    (Array.isArray(sourceContext.obligations)?sourceContext.obligations:[]).forEach(item=>{
      if(String(item?.status||'').toLowerCase()!=='planned')return;
      const amount=positiveMoney(item?.amount??item?.sum);
      const dueDate=validDate(item?.date)?item.date:'';
      if(!amount||!dueDate){skippedObligations+=1;return;}
      let id=text(item?.id)||idFactory('obligation');
      if(existingIds.has(id))return;
      while(existingIds.has(id))id=idFactory('obligation');
      existingIds.add(id);
      state.obligations.push(normalizeObligation({
        id,
        name:text(item?.title||item?.name)||'Обязательный платёж',
        amount,
        dueDate,
        recurrence:OBLIGATION_RECURRENCE.NONE,
        status:OBLIGATION_STATUS.ACTIVE,
        note:text(item?.comment||item?.note),
        linkedTransactionId:null,
        createdAt:text(item?.createdAt)||now,
        updatedAt:now
      },state.obligations.length,now));
      migratedObligations+=1;
    });

    const legacyReservePresent=hasLegacyBalance(sourceContext.reserveBalance)&&nonNegativeMoney(sourceContext.reserveBalance)>0;
    state.migration={
      ...state.migration,
      part2Checkpoint:PART2_MIGRATION_CHECKPOINT,
      part2CompletedAt:now,
      legacyReserveStatus:legacyReservePresent?'REVIEW_REQUIRED':'NONE',
      legacyReserveAmount:legacyReservePresent?nonNegativeMoney(sourceContext.reserveBalance):0,
      legacyObligationsMigrated:migratedObligations,
      legacyObligationsSkipped:skippedObligations
    };
    const normalized=normalizeFinance(state,now);
    if(getTotalBalance(normalized)!==beforeBalance)throw new Error('PART2_MIGRATION_BALANCE_CHANGED');
    return {finance:normalized,financeContext:sourceContext,migrated:true};
  }
'''
core=core.replace(anchor,part2_migration+anchor,1)

core=once(core,
"    FINANCE_SCHEMA_VERSION,MIGRATION_CHECKPOINT,TYPES,SYSTEM_KINDS,",
"    FINANCE_SCHEMA_VERSION,MIGRATION_CHECKPOINT,PART2_MIGRATION_CHECKPOINT,TYPES,SYSTEM_KINDS,OBLIGATION_STATUS,OBLIGATION_RECURRENCE,",
'exports constants')
core=once(core,
"    normalizeAccount,normalizeTransaction,normalizeFinance,validateTransactionShape,\n    accountEffect,isMigrationComplete,migrateLegacyState,",
"    normalizeAccount,normalizeTransaction,normalizeReserve,normalizeObligation,normalizeFinance,validateTransactionShape,\n    accountEffect,isMigrationComplete,migrateLegacyState,isPart2MigrationComplete,migratePart2State,",
'exports migration/model')

# Wire the Part 2 migration into normal app loading after the already-safe Part 1 migration.
app=once(app,
"""  const migration = TSBFinanceCore.migrateLegacyState({
    finance: data.finance,
    financeContext: data.financeContext,
    archives: data.archives,
    now,
    idFactory: uid
  });
  let finance = migration.finance;""",
"""  const migration = TSBFinanceCore.migrateLegacyState({
    finance: data.finance,
    financeContext: data.financeContext,
    archives: data.archives,
    now,
    idFactory: uid
  });
  const part2Migration = TSBFinanceCore.migratePart2State({
    finance: migration.finance,
    financeContext: migration.financeContext,
    now,
    idFactory: uid
  });
  let finance = part2Migration.finance;""",
'app migration pipeline')
app=once(app,
"    financeContext: normalizeFinanceContext(migration.financeContext),",
"    financeContext: normalizeFinanceContext(part2Migration.financeContext),",
'app migrated legacy context')

# Update Part 1 schema expectations and append Part 2 model/migration checks.
tests=tests.replace("test('empty finance uses schema v2 and default dictionaries'", "test('empty finance uses schema v3 with Part 2 collections and default dictionaries'",1)
tests=tests.replace("assert.equal(f.schemaVersion,2);", "assert.equal(f.schemaVersion,3);\n  assert.deepEqual(f.reserves,[]);\n  assert.deepEqual(f.obligations,[]);",1)
tests=tests.replace("  assert.equal(r.finance.schemaVersion,2);", "  assert.equal(r.finance.schemaVersion,3);",1)

append=r'''

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
'''
if "Part 2 migration preserves ambiguous legacy reserve" not in tests:
    tests += append

CORE.write_text(core)
APP.write_text(app)
TEST.write_text(tests)
print('Finance v2 Part2 stage A applied')
