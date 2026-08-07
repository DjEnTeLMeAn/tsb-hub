from pathlib import Path
CORE=Path('js/finance-core.js')
TEST=Path('tests/finance-core.test.cjs')
core=CORE.read_text(); tests=TEST.read_text()

def once(s,old,new,label):
    if old not in s: raise RuntimeError(f'missing anchor: {label}')
    if s.count(old)!=1: raise RuntimeError(f'non-unique anchor: {label} ({s.count(old)})')
    return s.replace(old,new,1)

core=once(core,
"  const PART2_MIGRATION_CHECKPOINT='FINANCE_V2_PART2_MODEL_COMPLETE';",
"  const PART2_MIGRATION_CHECKPOINT='FINANCE_V2_PART2_MODEL_COMPLETE';\n  const UPCOMING_OBLIGATION_DAYS=30;",
'upcoming constant')

core=once(core,
"      linkedTransactionId:text(source.linkedTransactionId)||null,\n      createdAt:text(source.createdAt)||createdAt,",
"      linkedTransactionId:text(source.linkedTransactionId)||null,\n      recurrenceParentId:text(source.recurrenceParentId)||null,\n      nextObligationId:text(source.nextObligationId)||null,\n      createdAt:text(source.createdAt)||createdAt,",
'obligation linkage metadata')

core=once(core,
"  function deleteTransaction(finance,id){\n    const state=normalizeFinance(finance);\n    const index=state.transactions.findIndex(transaction=>transaction.id===id);\n    if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};\n    const transaction=state.transactions[index];\n    if(isSystemLocked(transaction))return {ok:false,error:'SYSTEM_LOCKED',finance:state};\n    state.transactions.splice(index,1);\n    return {ok:true,finance:state,transaction};\n  }",
"  function deleteTransaction(finance,id,{now=nowISO()}={}){\n    const state=normalizeFinance(finance,now);\n    const index=state.transactions.findIndex(transaction=>transaction.id===id);\n    if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};\n    const transaction=state.transactions[index];\n    if(isSystemLocked(transaction))return {ok:false,error:'SYSTEM_LOCKED',finance:state};\n    state.transactions.splice(index,1);\n    const reactivated=[];\n    state.obligations.forEach(obligation=>{\n      if(obligation.status!==OBLIGATION_STATUS.PAID||obligation.linkedTransactionId!==id)return;\n      obligation.status=OBLIGATION_STATUS.ACTIVE;\n      obligation.linkedTransactionId=null;\n      obligation.updatedAt=now;\n      if(obligation.nextObligationId){\n        const nextIndex=state.obligations.findIndex(item=>item.id===obligation.nextObligationId&&item.recurrenceParentId===obligation.id&&item.status===OBLIGATION_STATUS.ACTIVE);\n        if(nextIndex>=0)state.obligations.splice(nextIndex,1);\n        obligation.nextObligationId=null;\n      }\n      reactivated.push(obligation.id);\n    });\n    return {ok:true,finance:state,transaction,reactivatedObligationIds:reactivated};\n  }",
'delete linked expense integrity')

anchor="  function validateTransactionShape(transaction){"
if anchor not in core: raise RuntimeError('validation anchor missing')
api=r'''  function isoDateFromNow(now=nowISO()){return validDate(now)?now:String(now||nowISO()).slice(0,10)}
  function addDaysISO(iso,days){
    if(!validDate(iso))return '';
    const [y,m,d]=iso.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));dt.setUTCDate(dt.getUTCDate()+Number(days||0));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
  }
  function addMonthISO(iso){
    if(!validDate(iso))return '';
    const [y,m,d]=iso.split('-').map(Number);const first=new Date(Date.UTC(y,m,1));const lastDay=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
    const day=Math.min(d,lastDay);return `${first.getUTCFullYear()}-${String(first.getUTCMonth()+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  function getActiveReserves(finance){return normalizeFinance(finance).reserves.filter(item=>item.active&&!item.archived)}
  function getTotalReservedAmount(finance){return roundMoney(getActiveReserves(finance).reduce((sum,item)=>sum+nonNegativeMoney(item.amount),0))}
  function getActiveObligations(finance){return normalizeFinance(finance).obligations.filter(item=>item.status===OBLIGATION_STATUS.ACTIVE)}
  function getUpcomingObligations(finance,{fromDate=isoDateFromNow(),days=UPCOMING_OBLIGATION_DAYS}={}){
    const start=validDate(fromDate)?fromDate:isoDateFromNow();const end=addDaysISO(start,Number(days));
    return getActiveObligations(finance).filter(item=>validDate(item.dueDate)&&item.dueDate<=end).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)||a.name.localeCompare(b.name));
  }
  function getUpcomingObligationsTotal(finance,options={}){return roundMoney(getUpcomingObligations(finance,options).reduce((sum,item)=>sum+positiveMoney(item.amount),0))}
  function getFreeMoney(finance,options={}){return roundMoney(getTotalBalance(finance)-getTotalReservedAmount(finance)-getUpcomingObligationsTotal(finance,options))}
  function getObligationCoverage(finance,options={}){
    const totalAccounts=getTotalBalance(finance);const reserved=getTotalReservedAmount(finance);const upcoming=getUpcomingObligationsTotal(finance,options);const afterReserves=roundMoney(totalAccounts-reserved);const free=roundMoney(afterReserves-upcoming);
    return {totalAccounts,reserved,upcoming,afterReserves,free,covered:free>=0,shortfall:free>=0?0:roundMoney(Math.abs(free))};
  }
  function worsensNegative(before,after){return after<0&&after<before}
  function validateReserveDraft(draft){
    if(!text(draft?.name))return {ok:false,error:'NAME_REQUIRED'};
    if(Object.prototype.hasOwnProperty.call(draft||{},'amount')&&moneyNumber(draft.amount)<0)return {ok:false,error:'INVALID_RESERVE_AMOUNT'};
    if(draft?.targetAmount!==null&&draft?.targetAmount!==undefined&&text(draft.targetAmount)!==''&&moneyNumber(draft.targetAmount)<=0)return {ok:false,error:'INVALID_TARGET_AMOUNT'};
    return {ok:true};
  }
  function createReserve(finance,draft,{now=nowISO(),idFactory=makeId,fromDate=isoDateFromNow(now)}={}){
    const state=normalizeFinance(finance,now);const check=validateReserveDraft(draft);if(!check.ok)return {ok:false,error:check.error,finance:state};
    const reserve=normalizeReserve({...clone(draft),id:text(draft?.id)||idFactory('reserve'),createdAt:now,updatedAt:now,active:true,archived:false},state.reserves.length,now);
    if(state.reserves.some(item=>item.id===reserve.id))return {ok:false,error:'DUPLICATE_ID',finance:state};
    const before=getFreeMoney(state,{fromDate});state.reserves.push(reserve);const after=getFreeMoney(state,{fromDate});
    if(worsensNegative(before,after)){state.reserves.pop();return {ok:false,error:'INSUFFICIENT_FREE_MONEY',finance:state,freeMoney:before};}
    return {ok:true,finance:state,reserve,freeMoney:after};
  }
  function updateReserve(finance,id,patch,{now=nowISO(),fromDate=isoDateFromNow(now)}={}){
    const state=normalizeFinance(finance,now);const index=state.reserves.findIndex(item=>item.id===id);if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};
    const current=state.reserves[index];const candidate={...current,...clone(patch),id:current.id,createdAt:current.createdAt,updatedAt:now};const check=validateReserveDraft(candidate);if(!check.ok)return {ok:false,error:check.error,finance:state};
    const before=getFreeMoney(state,{fromDate});const reserve=normalizeReserve(candidate,index,now);state.reserves[index]=reserve;const after=getFreeMoney(state,{fromDate});
    if(worsensNegative(before,after)){state.reserves[index]=current;return {ok:false,error:'INSUFFICIENT_FREE_MONEY',finance:state,freeMoney:before};}
    return {ok:true,finance:state,reserve,freeMoney:after};
  }
  function adjustReserveAmount(finance,id,delta,options={}){
    const state=normalizeFinance(finance,options.now);const reserve=state.reserves.find(item=>item.id===id);if(!reserve)return {ok:false,error:'NOT_FOUND',finance:state};
    const next=roundMoney(nonNegativeMoney(reserve.amount)+moneyNumber(delta));if(next<0)return {ok:false,error:'INVALID_RESERVE_AMOUNT',finance:state};
    return updateReserve(state,id,{amount:next},options);
  }
  function archiveReserve(finance,id,{now=nowISO()}={}){
    const state=normalizeFinance(finance,now);const index=state.reserves.findIndex(item=>item.id===id);if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};
    state.reserves[index]={...state.reserves[index],active:false,archived:true,updatedAt:now};return {ok:true,finance:state,reserve:state.reserves[index]};
  }
  function importLegacyReserve(finance,{name='Старый резерв',now=nowISO(),idFactory=makeId}={}){
    const state=normalizeFinance(finance,now);const migration=state.migration||{};if(migration.legacyReserveStatus==='MIGRATED'){
      const existing=state.reserves.find(item=>item.id==='reserve_legacy_v1')||null;return {ok:true,finance:state,reserve:existing,imported:false};
    }
    if(migration.legacyReserveStatus!=='REVIEW_REQUIRED'||nonNegativeMoney(migration.legacyReserveAmount)<=0)return {ok:false,error:'NO_LEGACY_RESERVE_TO_IMPORT',finance:state};
    const id=state.reserves.some(item=>item.id==='reserve_legacy_v1')?idFactory('reserve'):'reserve_legacy_v1';
    const reserve=normalizeReserve({id,name,amount:migration.legacyReserveAmount,targetAmount:null,active:true,archived:false,createdAt:now,updatedAt:now,sortOrder:state.reserves.length},state.reserves.length,now);
    state.reserves.push(reserve);state.migration={...migration,legacyReserveStatus:'MIGRATED'};
    return {ok:true,finance:normalizeFinance(state,now),reserve,imported:true};
  }
  function validateObligationDraft(draft){
    if(!text(draft?.name??draft?.title))return {ok:false,error:'NAME_REQUIRED'};
    if(positiveMoney(draft?.amount)<=0)return {ok:false,error:'INVALID_AMOUNT'};
    if(!validDate(draft?.dueDate??draft?.date))return {ok:false,error:'INVALID_DUE_DATE'};
    const recurrence=text(draft?.recurrence||OBLIGATION_RECURRENCE.NONE).toUpperCase();if(!Object.values(OBLIGATION_RECURRENCE).includes(recurrence))return {ok:false,error:'INVALID_RECURRENCE'};
    return {ok:true};
  }
  function createObligation(finance,draft,{now=nowISO(),idFactory=makeId,fromDate=isoDateFromNow(now)}={}){
    const state=normalizeFinance(finance,now);const check=validateObligationDraft(draft);if(!check.ok)return {ok:false,error:check.error,finance:state};
    const obligation=normalizeObligation({...clone(draft),id:text(draft?.id)||idFactory('obligation'),status:OBLIGATION_STATUS.ACTIVE,linkedTransactionId:null,createdAt:now,updatedAt:now},state.obligations.length,now);
    if(state.obligations.some(item=>item.id===obligation.id))return {ok:false,error:'DUPLICATE_ID',finance:state};
    const before=getFreeMoney(state,{fromDate});state.obligations.push(obligation);const after=getFreeMoney(state,{fromDate});
    if(worsensNegative(before,after)){state.obligations.pop();return {ok:false,error:'INSUFFICIENT_FREE_MONEY',finance:state,freeMoney:before};}
    return {ok:true,finance:state,obligation,freeMoney:after};
  }
  function updateObligation(finance,id,patch,{now=nowISO(),fromDate=isoDateFromNow(now)}={}){
    const state=normalizeFinance(finance,now);const index=state.obligations.findIndex(item=>item.id===id);if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};
    const current=state.obligations[index];if(current.status!==OBLIGATION_STATUS.ACTIVE)return {ok:false,error:'OBLIGATION_NOT_ACTIVE',finance:state};
    const editable={name:patch?.name??current.name,amount:patch?.amount??current.amount,dueDate:patch?.dueDate??current.dueDate,recurrence:patch?.recurrence??current.recurrence,note:patch?.note??current.note};
    const check=validateObligationDraft(editable);if(!check.ok)return {ok:false,error:check.error,finance:state};
    const before=getFreeMoney(state,{fromDate});const obligation=normalizeObligation({...current,...editable,id:current.id,status:current.status,linkedTransactionId:current.linkedTransactionId,updatedAt:now},index,now);state.obligations[index]=obligation;const after=getFreeMoney(state,{fromDate});
    if(worsensNegative(before,after)){state.obligations[index]=current;return {ok:false,error:'INSUFFICIENT_FREE_MONEY',finance:state,freeMoney:before};}
    return {ok:true,finance:state,obligation,freeMoney:after};
  }
  function cancelObligation(finance,id,{now=nowISO()}={}){
    const state=normalizeFinance(finance,now);const obligation=state.obligations.find(item=>item.id===id);if(!obligation)return {ok:false,error:'NOT_FOUND',finance:state};if(obligation.status!==OBLIGATION_STATUS.ACTIVE)return {ok:false,error:'OBLIGATION_NOT_ACTIVE',finance:state};
    obligation.status=OBLIGATION_STATUS.CANCELLED;obligation.linkedTransactionId=null;obligation.updatedAt=now;return {ok:true,finance:state,obligation};
  }
  function ensureNextMonthlyObligation(state,obligation,{now=nowISO(),idFactory=makeId}={}){
    if(obligation.recurrence!==OBLIGATION_RECURRENCE.MONTHLY)return null;
    if(obligation.nextObligationId){const existing=state.obligations.find(item=>item.id===obligation.nextObligationId);if(existing)return existing;}
    let id=idFactory('obligation');while(state.obligations.some(item=>item.id===id))id=idFactory('obligation');
    const next=normalizeObligation({id,name:obligation.name,amount:obligation.amount,dueDate:addMonthISO(obligation.dueDate),recurrence:OBLIGATION_RECURRENCE.MONTHLY,status:OBLIGATION_STATUS.ACTIVE,note:obligation.note,linkedTransactionId:null,recurrenceParentId:obligation.id,createdAt:now,updatedAt:now},state.obligations.length,now);
    state.obligations.push(next);obligation.nextObligationId=next.id;obligation.updatedAt=now;return next;
  }
  function payObligation(finance,id,{accountId,categoryId='other',amount,date,time='',description='',now=nowISO(),idFactory=makeId}={}){
    let state=normalizeFinance(finance,now);const index=state.obligations.findIndex(item=>item.id===id);if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};const obligation=state.obligations[index];if(obligation.status!==OBLIGATION_STATUS.ACTIVE)return {ok:false,error:'OBLIGATION_NOT_ACTIVE',finance:state};
    const account=getAccount(state,accountId);if(!account||account.archived||!account.active)return {ok:false,error:'ACCOUNT_NOT_FOUND',finance:state};
    const paidAmount=amount===undefined||amount===null||text(amount)===''?obligation.amount:positiveMoney(amount);if(!paidAmount)return {ok:false,error:'INVALID_AMOUNT',finance:state};
    const txDate=validDate(date)?date:isoDateFromNow(now);const created=createTransaction(state,{type:TYPES.EXPENSE,amount:paidAmount,accountId,categoryId:text(categoryId)||'other',date:txDate,time:validTime(time)?time:'',description:text(description)||obligation.name},{now,idFactory});if(!created.ok)return created;state=created.finance;
    const target=state.obligations.find(item=>item.id===id);target.status=OBLIGATION_STATUS.PAID;target.linkedTransactionId=created.transaction.id;target.updatedAt=now;const nextObligation=ensureNextMonthlyObligation(state,target,{now,idFactory});
    return {ok:true,finance:normalizeFinance(state,now),transaction:created.transaction,obligation:target,nextObligation};
  }
  function linkObligationToTransaction(finance,obligationId,transactionId,{now=nowISO(),idFactory=makeId}={}){
    const state=normalizeFinance(finance,now);const obligation=state.obligations.find(item=>item.id===obligationId);if(!obligation)return {ok:false,error:'OBLIGATION_NOT_FOUND',finance:state};if(obligation.status!==OBLIGATION_STATUS.ACTIVE)return {ok:false,error:'OBLIGATION_NOT_ACTIVE',finance:state};
    const transaction=state.transactions.find(item=>item.id===transactionId);if(!transaction||transaction.type!==TYPES.EXPENSE)return {ok:false,error:'EXPENSE_NOT_FOUND',finance:state};
    if(state.obligations.some(item=>item.id!==obligationId&&item.linkedTransactionId===transactionId))return {ok:false,error:'TRANSACTION_ALREADY_LINKED',finance:state};
    obligation.status=OBLIGATION_STATUS.PAID;obligation.linkedTransactionId=transaction.id;obligation.updatedAt=now;const nextObligation=ensureNextMonthlyObligation(state,obligation,{now,idFactory});
    return {ok:true,finance:normalizeFinance(state,now),transaction,obligation,nextObligation};
  }

'''
core=core.replace(anchor,api+anchor,1)

core=once(core,
"    FINANCE_SCHEMA_VERSION,MIGRATION_CHECKPOINT,PART2_MIGRATION_CHECKPOINT,TYPES,SYSTEM_KINDS,OBLIGATION_STATUS,OBLIGATION_RECURRENCE,",
"    FINANCE_SCHEMA_VERSION,MIGRATION_CHECKPOINT,PART2_MIGRATION_CHECKPOINT,UPCOMING_OBLIGATION_DAYS,TYPES,SYSTEM_KINDS,OBLIGATION_STATUS,OBLIGATION_RECURRENCE,",
'export upcoming')
core=once(core,
"    createTransaction,updateTransaction,deleteTransaction,createAccount,updateAccount,archiveAccount,\n    createOrUpdateCategory,archiveCategory,createOrUpdateIncomeType,archiveIncomeType",
"    createTransaction,updateTransaction,deleteTransaction,createAccount,updateAccount,archiveAccount,\n    getActiveReserves,getTotalReservedAmount,createReserve,updateReserve,adjustReserveAmount,archiveReserve,importLegacyReserve,\n    getActiveObligations,getUpcomingObligations,getUpcomingObligationsTotal,createObligation,updateObligation,cancelObligation,payObligation,linkObligationToTransaction,\n    getFreeMoney,getObligationCoverage,addDaysISO,addMonthISO,\n    createOrUpdateCategory,archiveCategory,createOrUpdateIncomeType,archiveIncomeType",
'export part2 api')

append=r'''

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

test('reserve API rejects negative amounts and new over-allocation',()=>{
  let f=core.createEmptyFinance();f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;f=core.createTransaction(f,{id:'m',type:'ADJUSTMENT',amount:1000,accountId:'a1',date:'2026-08-07'}).finance;
  assert.equal(core.createReserve(f,{name:'bad',amount:-1},{fromDate:'2026-08-07'}).error,'INVALID_RESERVE_AMOUNT');
  assert.equal(core.createReserve(f,{name:'too much',amount:1500},{fromDate:'2026-08-07'}).error,'INSUFFICIENT_FREE_MONEY');
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
'''
if "reserve API changes allocation but never account balances" not in tests: tests+=append

CORE.write_text(core);TEST.write_text(tests);print('Finance v2 Part2 stage B applied')
