(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TSBFinanceCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const FINANCE_SCHEMA_VERSION=3;
  const MIGRATION_CHECKPOINT='FINANCE_V2_PART1_COMPLETE';
  const PART2_MIGRATION_CHECKPOINT='FINANCE_V2_PART2_MODEL_COMPLETE';
  const UPCOMING_OBLIGATION_DAYS=30;
  const TYPES=Object.freeze({EXPENSE:'EXPENSE',INCOME:'INCOME',TRANSFER:'TRANSFER',ADJUSTMENT:'ADJUSTMENT'});
  const SYSTEM_KINDS=Object.freeze({MIGRATION_ANCHOR:'MIGRATION_ANCHOR',RECONCILIATION:'RECONCILIATION'});
  const OBLIGATION_STATUS=Object.freeze({ACTIVE:'ACTIVE',PAID:'PAID',CANCELLED:'CANCELLED'});
  const OBLIGATION_RECURRENCE=Object.freeze({NONE:'NONE',MONTHLY:'MONTHLY'});

  const DEFAULT_CATEGORY_DEFS=Object.freeze([
    ['food','Еда'],['transport','Транспорт'],['home','Дом'],['health','Здоровье'],['other','Другое'],
    ['subscriptions','Подписки'],['fun','Развлечения']
  ]);
  const DEFAULT_INCOME_TYPE_DEFS=Object.freeze([
    ['personal','Личный доход'],['per_diem','Суточные / компенсация'],['car','Деньги автомобиля'],
    ['refund','Возврат'],['gift','Подарок'],['other','Прочее']
  ]);

  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const nowISO=()=>new Date().toISOString();
  const makeId=(prefix='fin')=>`${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const text=value=>String(value??'').trim();
  const bool=value=>Boolean(value);
  const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
  const validTime=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||''));
  const moneyNumber=value=>{
    const n=Number(String(value??'').replace(',','.'));
    return Number.isFinite(n)?Math.round(n*100)/100:0;
  };
  const positiveMoney=value=>Math.abs(moneyNumber(value));
  const signedMoney=value=>moneyNumber(value);
  const nonNegativeMoney=value=>Math.max(0,moneyNumber(value));

  function createDefaultCategories(createdAt=nowISO()){
    return DEFAULT_CATEGORY_DEFS.map(([id,name],index)=>({id,name,active:true,archived:false,system:true,sortOrder:index,createdAt,updatedAt:createdAt}));
  }
  function createDefaultIncomeTypes(createdAt=nowISO()){
    return DEFAULT_INCOME_TYPE_DEFS.map(([id,name],index)=>({id,name,active:true,archived:false,system:true,sortOrder:index,createdAt,updatedAt:createdAt}));
  }
  function createEmptyFinance(createdAt=nowISO()){
    return {
      schemaVersion:FINANCE_SCHEMA_VERSION,
      migration:{checkpoint:'',completedAt:''},
      accounts:[],
      transactions:[],
      categories:createDefaultCategories(createdAt),
      incomeTypes:createDefaultIncomeTypes(createdAt),
      reserves:[],
      obligations:[]
    };
  }

  function normalizeAccount(account,index=0,createdAt=nowISO()){
    const source=account&&typeof account==='object'?account:{};
    return {
      id:text(source.id)||makeId('acct'),
      name:text(source.name)||`Счёт ${index+1}`,
      type:text(source.type)||'',
      active:source.active!==false&&!source.archived,
      archived:bool(source.archived),
      isDefault:bool(source.isDefault),
      sortOrder:Number.isFinite(Number(source.sortOrder))?Number(source.sortOrder):index,
      createdAt:text(source.createdAt)||createdAt,
      updatedAt:text(source.updatedAt)||text(source.createdAt)||createdAt
    };
  }
  function normalizeNamedItem(item,index,fallback,createdAt=nowISO()){
    const source=item&&typeof item==='object'?item:{};
    return {
      id:text(source.id)||fallback.id,
      name:text(source.name)||fallback.name,
      active:source.active!==false&&!source.archived,
      archived:bool(source.archived),
      system:source.system!==false,
      sortOrder:Number.isFinite(Number(source.sortOrder))?Number(source.sortOrder):index,
      createdAt:text(source.createdAt)||createdAt,
      updatedAt:text(source.updatedAt)||text(source.createdAt)||createdAt
    };
  }
  function normalizeCollection(items,defaults,createdAt){
    const source=Array.isArray(items)?items:[];
    const seen=new Set();
    const normalized=[];
    source.forEach((item,index)=>{
      const fallback=defaults[index]||{id:`custom_${index}`,name:`Элемент ${index+1}`};
      const row=normalizeNamedItem(item,index,fallback,createdAt);
      if(!row.id||seen.has(row.id))return;
      seen.add(row.id);normalized.push(row);
    });
    defaults.forEach((fallback,index)=>{
      if(seen.has(fallback.id))return;
      const row=normalizeNamedItem(fallback,normalized.length,fallback,createdAt);seen.add(row.id);normalized.push(row);
    });
    return normalized;
  }

  function baseTransaction(source,createdAt){
    return {
      id:text(source.id)||makeId('txn'),
      type:text(source.type).toUpperCase(),
      amount:0,
      date:validDate(source.date)?source.date:createdAt.slice(0,10),
      time:validTime(source.time)?source.time:'',
      description:text(source.description??source.comment??source.detail),
      createdAt:text(source.createdAt)||createdAt,
      updatedAt:text(source.updatedAt)||text(source.createdAt)||createdAt
    };
  }
  function normalizeTransaction(transaction,createdAt=nowISO()){
    const source=transaction&&typeof transaction==='object'?transaction:{};
    const row=baseTransaction(source,createdAt);
    if(!Object.values(TYPES).includes(row.type))return null;

    if(row.type===TYPES.EXPENSE){
      row.amount=positiveMoney(source.amount);
      row.accountId=text(source.accountId);
      row.categoryId=text(source.categoryId??source.category)||'other';
    }else if(row.type===TYPES.INCOME){
      row.amount=positiveMoney(source.amount);
      row.accountId=text(source.accountId);
      row.incomeTypeId=text(source.incomeTypeId)||'other';
    }else if(row.type===TYPES.TRANSFER){
      row.amount=positiveMoney(source.amount);
      row.fromAccountId=text(source.fromAccountId);
      row.toAccountId=text(source.toAccountId);
    }else if(row.type===TYPES.ADJUSTMENT){
      row.amount=signedMoney(source.amount);
      row.accountId=text(source.accountId);
      const systemKind=text(source.systemKind);
      if(systemKind)row.systemKind=systemKind;
    }
    return row;
  }

  function normalizeReserve(reserve,index=0,createdAt=nowISO()){
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
      recurrenceParentId:text(source.recurrenceParentId)||null,
      nextObligationId:text(source.nextObligationId)||null,
      createdAt:text(source.createdAt)||createdAt,
      updatedAt:text(source.updatedAt)||text(source.createdAt)||createdAt
    };
  }

  function normalizeFinance(value,createdAt=nowISO()){
    const source=value&&typeof value==='object'?value:{};
    const defaults=createEmptyFinance(createdAt);
    const accounts=(Array.isArray(source.accounts)?source.accounts:[]).map((item,index)=>normalizeAccount(item,index,createdAt));
    const defaultIds=DEFAULT_CATEGORY_DEFS.map(([id,name])=>({id,name,system:true}));
    const incomeIds=DEFAULT_INCOME_TYPE_DEFS.map(([id,name])=>({id,name,system:true}));
    const categories=normalizeCollection(source.categories,defaultIds,createdAt);
    const incomeTypes=normalizeCollection(source.incomeTypes,incomeIds,createdAt);
    const transactions=(Array.isArray(source.transactions)?source.transactions:[]).map(item=>normalizeTransaction(item,createdAt)).filter(Boolean);
    const reserves=(Array.isArray(source.reserves)?source.reserves:[]).map((item,index)=>normalizeReserve(item,index,createdAt));
    const obligations=(Array.isArray(source.obligations)?source.obligations:[]).map((item,index)=>normalizeObligation(item,index,createdAt));
    if(accounts.length&&!accounts.some(a=>a.isDefault))accounts[0].isDefault=true;
    if(accounts.filter(a=>a.isDefault).length>1){let kept=false;accounts.forEach(a=>{if(a.isDefault&&!kept)kept=true;else if(a.isDefault)a.isDefault=false})}
    return {
      ...defaults,
      ...source,
      schemaVersion:FINANCE_SCHEMA_VERSION,
      migration:{
        checkpoint:text(source.migration?.checkpoint),
        completedAt:text(source.migration?.completedAt),
        part2Checkpoint:text(source.migration?.part2Checkpoint),
        part2CompletedAt:text(source.migration?.part2CompletedAt),
        legacyReserveStatus:text(source.migration?.legacyReserveStatus),
        legacyReserveAmount:nonNegativeMoney(source.migration?.legacyReserveAmount),
        legacyObligationsMigrated:Number(source.migration?.legacyObligationsMigrated||0),
        legacyObligationsSkipped:Number(source.migration?.legacyObligationsSkipped||0)
      },
      accounts,categories,incomeTypes,transactions,reserves,obligations
    };
  }

  function legacyCategoryId(value){
    const raw=text(value).toLowerCase();
    const aliases={еда:'food',food:'food',транспорт:'transport',transport:'transport',дом:'home',home:'home',здоровье:'health',health:'health',подписки:'subscriptions',subscriptions:'subscriptions',развлечения:'fun',fun:'fun',другое:'other',other:'other'};
    return aliases[raw]||'other';
  }
  function dateFromLegacy(item,fallbackDate,now){
    if(validDate(item?.date))return item.date;
    const completed=text(item?.completedAt||item?.receivedAt||item?.paidAt||item?.createdAt);
    if(/^\d{4}-\d{2}-\d{2}T/.test(completed))return completed.slice(0,10);
    return validDate(fallbackDate)?fallbackDate:now.slice(0,10);
  }
  function timeFromLegacy(item){
    if(validTime(item?.time))return item.time;
    const completed=text(item?.completedAt||item?.receivedAt||item?.paidAt||item?.createdAt);
    const match=completed.match(/T(\d{2}:\d{2})/);
    return match?match[1]:'';
  }
  function hasLegacyBalance(value){
    if(value===null||value===undefined)return false;
    return text(value)!==''&&Number.isFinite(Number(String(value).replace(',','.')));
  }
  function accountEffect(transaction,accountId){
    if(!transaction||!accountId)return 0;
    if(transaction.type===TYPES.EXPENSE&&transaction.accountId===accountId)return -positiveMoney(transaction.amount);
    if(transaction.type===TYPES.INCOME&&transaction.accountId===accountId)return positiveMoney(transaction.amount);
    if(transaction.type===TYPES.ADJUSTMENT&&transaction.accountId===accountId)return signedMoney(transaction.amount);
    if(transaction.type===TYPES.TRANSFER){
      if(transaction.fromAccountId===accountId)return -positiveMoney(transaction.amount);
      if(transaction.toAccountId===accountId)return positiveMoney(transaction.amount);
    }
    return 0;
  }
  function isMigrationComplete(finance){
    return Number(finance?.schemaVersion)>=2&&finance?.migration?.checkpoint===MIGRATION_CHECKPOINT;
  }
  function migrateLegacyState({finance,financeContext,archives,now=nowISO(),idFactory=makeId}={}){
    const sourceFinance=finance&&typeof finance==='object'?finance:{};
    const sourceContext=financeContext&&typeof financeContext==='object'?financeContext:{};
    const nextArchives=archives&&typeof archives==='object'?clone(archives):{};

    if(isMigrationComplete(sourceFinance)){
      return {finance:normalizeFinance(sourceFinance,now),financeContext:clone(sourceContext),archives:nextArchives,migrated:false};
    }

    const alreadyV2=Number(sourceFinance?.schemaVersion)>=2&&Array.isArray(sourceFinance?.transactions);
    if(alreadyV2){
      const normalized=normalizeFinance(sourceFinance,now);
      normalized.migration={checkpoint:MIGRATION_CHECKPOINT,completedAt:text(sourceFinance.migration?.completedAt)||now};
      return {finance:normalized,financeContext:clone(sourceContext),archives:nextArchives,migrated:false};
    }

    if(!Object.prototype.hasOwnProperty.call(nextArchives,'financeV1MigrationBackup')){
      nextArchives.financeV1MigrationBackup={createdAt:now,finance:clone(sourceFinance),financeContext:clone(sourceContext)};
    }

    const accountId='account_main';
    const result=createEmptyFinance(now);
    result.accounts=[normalizeAccount({id:accountId,name:'Основной счёт',type:'',active:true,archived:false,isDefault:true,createdAt:now},0,now)];
    const transactions=[];
    const usedIds=new Set();
    const uniqueId=(preferred,prefix)=>{
      let id=text(preferred)||idFactory(prefix);
      while(usedIds.has(id))id=idFactory(prefix);
      usedIds.add(id);return id;
    };

    Object.entries(sourceFinance).forEach(([iso,day])=>{
      if(!validDate(iso)||!Array.isArray(day?.expenses))return;
      day.expenses.forEach(expense=>{
        const amount=positiveMoney(expense?.amount??expense?.sum);
        if(!amount)return;
        const tx=normalizeTransaction({
          id:uniqueId(expense?.id,'exp'),type:TYPES.EXPENSE,amount,
          accountId,categoryId:legacyCategoryId(expense?.category),date:iso,
          time:validTime(expense?.time)?expense.time:timeFromLegacy(expense),
          description:text(expense?.detail||expense?.comment),
          createdAt:text(expense?.createdAt)||now,updatedAt:text(expense?.updatedAt)||text(expense?.createdAt)||now
        },now);
        if(tx)transactions.push(tx);
      });
    });

    (Array.isArray(sourceContext.incomes)?sourceContext.incomes:[]).filter(item=>item?.status==='received').forEach(item=>{
      const amount=positiveMoney(item?.amount??item?.sum);if(!amount)return;
      const tx=normalizeTransaction({
        id:uniqueId(item?.id,'inc'),type:TYPES.INCOME,amount,accountId,incomeTypeId:'other',
        date:dateFromLegacy(item,'',now),time:timeFromLegacy(item),
        description:[text(item?.title||item?.source),text(item?.comment)].filter(Boolean).join(' · '),
        createdAt:text(item?.createdAt)||now,updatedAt:text(item?.completedAt)||text(item?.createdAt)||now
      },now);if(tx)transactions.push(tx);
    });

    (Array.isArray(sourceContext.obligations)?sourceContext.obligations:[]).filter(item=>item?.status==='paid').forEach(item=>{
      const amount=positiveMoney(item?.amount??item?.sum);if(!amount)return;
      const tx=normalizeTransaction({
        id:uniqueId(item?.id,'obl'),type:TYPES.EXPENSE,amount,accountId,categoryId:'other',
        date:dateFromLegacy(item,'',now),time:timeFromLegacy(item),
        description:[text(item?.title),text(item?.comment)].filter(Boolean).join(' · '),
        createdAt:text(item?.createdAt)||now,updatedAt:text(item?.completedAt)||text(item?.createdAt)||now
      },now);if(tx)transactions.push(tx);
    });

    (Array.isArray(sourceContext.operations)?sourceContext.operations:[]).filter(op=>String(op?.type||'').toLowerCase()==='adjustment').forEach(op=>{
      const amount=signedMoney(op?.amount);if(!amount)return;
      const tx=normalizeTransaction({
        id:uniqueId(op?.id,'adj'),type:TYPES.ADJUSTMENT,amount,accountId,
        date:dateFromLegacy(op,op?.date,now),time:timeFromLegacy(op),
        description:[text(op?.title),text(op?.comment)].filter(Boolean).join(' · '),
        createdAt:text(op?.createdAt)||now,updatedAt:text(op?.updatedAt)||text(op?.createdAt)||now
      },now);if(tx)transactions.push(tx);
    });

    if(hasLegacyBalance(sourceContext.availableBalance)){
      const target=signedMoney(sourceContext.availableBalance);
      const imported=Math.round(transactions.reduce((sum,tx)=>sum+accountEffect(tx,accountId),0)*100)/100;
      const anchor=Math.round((target-imported)*100)/100;
      if(Math.abs(anchor)>=0.005){
        transactions.push(normalizeTransaction({
          id:uniqueId('', 'migration'),type:TYPES.ADJUSTMENT,amount:anchor,accountId,
          systemKind:SYSTEM_KINDS.MIGRATION_ANCHOR,date:now.slice(0,10),time:'',
          description:'Миграционная привязка баланса Finance v1',createdAt:now,updatedAt:now
        },now));
      }
    }

    result.transactions=transactions;
    result.migration={checkpoint:MIGRATION_CHECKPOINT,completedAt:now};

    const legacyContext={...clone(sourceContext)};
    legacyContext.availableBalance='';
    legacyContext.reserveBalance=sourceContext.reserveBalance??'';
    legacyContext.incomes=(Array.isArray(sourceContext.incomes)?sourceContext.incomes:[]).filter(item=>item?.status==='planned');
    legacyContext.obligations=(Array.isArray(sourceContext.obligations)?sourceContext.obligations:[]).filter(item=>item?.status==='planned');
    legacyContext.operations=[];
    legacyContext.financeV2Legacy=true;

    return {finance:normalizeFinance(result,now),financeContext:legacyContext,archives:nextArchives,migrated:true};
  }


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


  function roundMoney(value){return Math.round((Number(value)||0)*100)/100}
  function getAccount(finance,accountId){return normalizeFinance(finance).accounts.find(account=>account.id===accountId)||null}
  function getDefaultAccount(finance){
    const accounts=normalizeFinance(finance).accounts.filter(account=>account.active&&!account.archived);
    return accounts.find(account=>account.isDefault)||accounts[0]||null;
  }
  function getAccountBalance(finance,accountId){
    const state=normalizeFinance(finance);
    return roundMoney(state.transactions.reduce((sum,transaction)=>sum+accountEffect(transaction,accountId),0));
  }
  function getTotalBalance(finance){
    const state=normalizeFinance(finance);
    return roundMoney(state.accounts.reduce((sum,account)=>sum+getAccountBalance(state,account.id),0));
  }
  function isSystemLocked(transaction){return transaction?.type===TYPES.ADJUSTMENT&&transaction?.systemKind===SYSTEM_KINDS.MIGRATION_ANCHOR}
  function transactionSortKey(transaction){return `${transaction?.date||''}T${transaction?.time||'00:00'}|${transaction?.updatedAt||transaction?.createdAt||''}`}
  function getTransactions(finance,filters={}){
    const state=normalizeFinance(finance);
    const type=text(filters.type).toUpperCase();
    const search=text(filters.search).toLowerCase();
    return state.transactions.filter(transaction=>{
      if(filters.includeSystem!==true&&isSystemLocked(transaction))return false;
      if(type&&type!=='ALL'&&transaction.type!==type)return false;
      if(validDate(filters.dateFrom)&&transaction.date<filters.dateFrom)return false;
      if(validDate(filters.dateTo)&&transaction.date>filters.dateTo)return false;
      if(filters.categoryId&&transaction.categoryId!==filters.categoryId)return false;
      if(filters.accountId){
        const matches=transaction.accountId===filters.accountId||transaction.fromAccountId===filters.accountId||transaction.toAccountId===filters.accountId;
        if(!matches)return false;
      }
      if(search&&!text(transaction.description).toLowerCase().includes(search))return false;
      return true;
    }).sort((a,b)=>transactionSortKey(b).localeCompare(transactionSortKey(a)));
  }
  function transactionExists(finance,id){return normalizeFinance(finance).transactions.some(transaction=>transaction.id===id)}
  function createTransaction(finance,draft,{now=nowISO(),idFactory=makeId}={}){
    const state=normalizeFinance(finance,now);
    const candidate={...clone(draft),id:text(draft?.id)||idFactory('txn'),createdAt:text(draft?.createdAt)||now,updatedAt:now};
    const transaction=normalizeTransaction(candidate,now);
    const check=validateTransactionShape(transaction);
    if(!check.ok)return {ok:false,error:check.error,finance:state};
    if(transactionExists(state,transaction.id))return {ok:false,error:'DUPLICATE_ID',finance:state};
    state.transactions.push(transaction);
    return {ok:true,finance:state,transaction};
  }
  function updateTransaction(finance,id,patch,{now=nowISO()}={}){
    const state=normalizeFinance(finance,now);
    const index=state.transactions.findIndex(transaction=>transaction.id===id);
    if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};
    const current=state.transactions[index];
    if(isSystemLocked(current))return {ok:false,error:'SYSTEM_LOCKED',finance:state};
    const candidate={...current,...clone(patch),id:current.id,type:current.type,createdAt:current.createdAt,updatedAt:now};
    const transaction=normalizeTransaction(candidate,now);
    const check=validateTransactionShape(transaction);
    if(!check.ok)return {ok:false,error:check.error,finance:state};
    state.transactions[index]=transaction;
    return {ok:true,finance:state,transaction,previous:current};
  }
  function deleteTransaction(finance,id,{now=nowISO()}={}){
    const state=normalizeFinance(finance,now);
    const index=state.transactions.findIndex(transaction=>transaction.id===id);
    if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};
    const transaction=state.transactions[index];
    if(isSystemLocked(transaction))return {ok:false,error:'SYSTEM_LOCKED',finance:state};
    state.transactions.splice(index,1);
    const reactivated=[];
    state.obligations.forEach(obligation=>{
      if(obligation.status!==OBLIGATION_STATUS.PAID||obligation.linkedTransactionId!==id)return;
      obligation.status=OBLIGATION_STATUS.ACTIVE;
      obligation.linkedTransactionId=null;
      obligation.updatedAt=now;
      if(obligation.nextObligationId){
        const nextIndex=state.obligations.findIndex(item=>item.id===obligation.nextObligationId&&item.recurrenceParentId===obligation.id&&item.status===OBLIGATION_STATUS.ACTIVE);
        if(nextIndex>=0)state.obligations.splice(nextIndex,1);
        obligation.nextObligationId=null;
      }
      reactivated.push(obligation.id);
    });
    return {ok:true,finance:state,transaction,reactivatedObligationIds:reactivated};
  }
  function createAccount(finance,draft,{now=nowISO(),idFactory=makeId}={}){
    const state=normalizeFinance(finance,now);
    const account=normalizeAccount({...clone(draft),id:text(draft?.id)||idFactory('acct'),createdAt:now,updatedAt:now},state.accounts.length,now);
    if(state.accounts.some(item=>item.id===account.id))return {ok:false,error:'DUPLICATE_ID',finance:state};
    if(account.isDefault)state.accounts.forEach(item=>item.isDefault=false);
    if(!state.accounts.length)account.isDefault=true;
    state.accounts.push(account);
    return {ok:true,finance:state,account};
  }
  function updateAccount(finance,id,patch,{now=nowISO()}={}){
    const state=normalizeFinance(finance,now);
    const index=state.accounts.findIndex(account=>account.id===id);
    if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};
    const current=state.accounts[index];
    const account=normalizeAccount({...current,...clone(patch),id:current.id,createdAt:current.createdAt,updatedAt:now},index,now);
    if(account.isDefault)state.accounts.forEach(item=>item.isDefault=false);
    state.accounts[index]=account;
    if(!state.accounts.some(item=>item.isDefault&&!item.archived)){
      const fallback=state.accounts.find(item=>!item.archived&&item.active);
      if(fallback)fallback.isDefault=true;
    }
    return {ok:true,finance:state,account};
  }
  function archiveAccount(finance,id,{now=nowISO()}={}){
    const state=normalizeFinance(finance,now);
    const account=state.accounts.find(item=>item.id===id);
    if(!account)return {ok:false,error:'NOT_FOUND',finance:state};
    if(state.accounts.filter(item=>!item.archived&&item.active).length<=1)return {ok:false,error:'LAST_ACTIVE_ACCOUNT',finance:state};
    if(Math.abs(getAccountBalance(state,id))>=0.005)return {ok:false,error:'ACCOUNT_NOT_EMPTY',finance:state};
    return updateAccount(state,id,{archived:true,active:false,isDefault:false},{now});
  }
  function upsertNamedCollection(finance,key,draft,{now=nowISO(),idFactory=makeId}={}){
    const state=normalizeFinance(finance,now);
    const list=state[key];
    if(!Array.isArray(list))return {ok:false,error:'UNKNOWN_COLLECTION',finance:state};
    const id=text(draft?.id)||idFactory(key==='categories'?'cat':'income_type');
    const index=list.findIndex(item=>item.id===id);
    const base=index>=0?list[index]:{id,system:false,active:true,archived:false,sortOrder:list.length,createdAt:now};
    const item={...base,...clone(draft),id,name:text(draft?.name??base.name),updatedAt:now};
    if(!item.name)return {ok:false,error:'NAME_REQUIRED',finance:state};
    if(index>=0)list[index]=item;else list.push(item);
    return {ok:true,finance:state,item};
  }
  function archiveNamedItem(finance,key,id,{now=nowISO()}={}){
    const state=normalizeFinance(finance,now);
    const list=state[key];
    const index=Array.isArray(list)?list.findIndex(item=>item.id===id):-1;
    if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};
    list[index]={...list[index],active:false,archived:true,updatedAt:now};
    return {ok:true,finance:state,item:list[index]};
  }
  function createOrUpdateCategory(finance,draft,options){return upsertNamedCollection(finance,'categories',draft,options)}
  function archiveCategory(finance,id,options){return archiveNamedItem(finance,'categories',id,options)}
  function createOrUpdateIncomeType(finance,draft,options){return upsertNamedCollection(finance,'incomeTypes',draft,options)}
  function archiveIncomeType(finance,id,options){return archiveNamedItem(finance,'incomeTypes',id,options)}

  function isoDateFromNow(now=nowISO()){return validDate(now)?now:String(now||nowISO()).slice(0,10)}
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

  function dateSpanDays(dateFrom,dateTo){
    if(!validDate(dateFrom)||!validDate(dateTo)||dateTo<dateFrom)return 0;
    const [fy,fm,fd]=dateFrom.split('-').map(Number);const [ty,tm,td]=dateTo.split('-').map(Number);
    const start=Date.UTC(fy,fm-1,fd);const end=Date.UTC(ty,tm-1,td);
    return Math.floor((end-start)/86400000)+1;
  }
  function analyticsBounds(rows,dateFrom,dateTo){
    if(validDate(dateFrom)&&validDate(dateTo)&&dateTo>=dateFrom)return {dateFrom,dateTo,days:dateSpanDays(dateFrom,dateTo)};
    const dates=rows.map(item=>item.date).filter(validDate).sort();
    if(!dates.length)return {dateFrom:'',dateTo:'',days:0};
    const from=validDate(dateFrom)?dateFrom:dates[0];const to=validDate(dateTo)?dateTo:dates[dates.length-1];
    return {dateFrom:from,dateTo:to,days:dateSpanDays(from,to)};
  }
  function getAnalyticsSummary(finance,{dateFrom='',dateTo=''}={}){
    const filters={};if(validDate(dateFrom))filters.dateFrom=dateFrom;if(validDate(dateTo))filters.dateTo=dateTo;
    const rows=getTransactions(finance,filters);
    const incomes=rows.filter(item=>item.type===TYPES.INCOME);
    const expenses=rows.filter(item=>item.type===TYPES.EXPENSE);
    const income=roundMoney(incomes.reduce((sum,item)=>sum+positiveMoney(item.amount),0));
    const expense=roundMoney(expenses.reduce((sum,item)=>sum+positiveMoney(item.amount),0));
    const byCategory={};
    expenses.forEach(item=>{
      const id=text(item.categoryId)||'other';
      const bucket=byCategory[id]||(byCategory[id]={categoryId:id,amount:0,count:0});
      bucket.amount=roundMoney(bucket.amount+positiveMoney(item.amount));bucket.count+=1;
    });
    const categoryBreakdown=Object.values(byCategory).map(item=>({...item,share:expense>0?Math.round((item.amount/expense)*1000)/10:0})).sort((a,b)=>b.amount-a.amount||a.categoryId.localeCompare(b.categoryId));
    const bounds=analyticsBounds(rows,dateFrom,dateTo);
    return {
      dateFrom:bounds.dateFrom,dateTo:bounds.dateTo,days:bounds.days,
      income,expense,difference:roundMoney(income-expense),expenseCount:expenses.length,
      averageExpensePerDay:bounds.days?roundMoney(expense/bounds.days):0,
      categoryBreakdown
    };
  }

  function reconcileAccount(finance,accountId,actualBalance,{date='',time='',description='',now=nowISO(),idFactory=makeId}={}){
    const state=normalizeFinance(finance,now);
    const account=getAccount(state,accountId);
    if(!account||account.archived||!account.active)return {ok:false,error:'ACCOUNT_NOT_FOUND',finance:state};
    const raw=String(actualBalance??'').trim().replace(',','.');
    if(raw===''||!Number.isFinite(Number(raw)))return {ok:false,error:'INVALID_ACTUAL_BALANCE',finance:state};
    const actual=roundMoney(Number(raw));
    const calculated=getAccountBalance(state,accountId);
    const difference=roundMoney(actual-calculated);
    if(Math.abs(difference)<0.005)return {ok:true,finance:state,account,calculated,actual,difference:0,changed:false,transaction:null};
    const created=createTransaction(state,{
      type:TYPES.ADJUSTMENT,amount:difference,accountId,
      systemKind:SYSTEM_KINDS.RECONCILIATION,
      date:validDate(date)?date:isoDateFromNow(now),time:validTime(time)?time:'',
      description:text(description)||`Сверка счёта: фактически ${actual}`
    },{now,idFactory});
    if(!created.ok)return created;
    return {ok:true,finance:created.finance,account,calculated,actual,difference,changed:true,transaction:created.transaction};
  }

  function validateTransactionShape(transaction){
    const row=normalizeTransaction(transaction);
    if(!row)return {ok:false,error:'UNKNOWN_TYPE'};
    if(!row.id||(!row.amount&&row.type!==TYPES.ADJUSTMENT))return {ok:false,error:'INVALID_AMOUNT'};
    if(row.type===TYPES.EXPENSE&&(!row.accountId||!row.categoryId))return {ok:false,error:'EXPENSE_FIELDS'};
    if(row.type===TYPES.INCOME&&(!row.accountId||!row.incomeTypeId))return {ok:false,error:'INCOME_FIELDS'};
    if(row.type===TYPES.TRANSFER&&(!row.fromAccountId||!row.toAccountId||row.fromAccountId===row.toAccountId))return {ok:false,error:'TRANSFER_FIELDS'};
    if(row.type===TYPES.ADJUSTMENT&&!row.accountId)return {ok:false,error:'ADJUSTMENT_FIELDS'};
    const forbidden={
      EXPENSE:['incomeTypeId','fromAccountId','toAccountId'],
      INCOME:['categoryId','fromAccountId','toAccountId'],
      TRANSFER:['accountId','categoryId','incomeTypeId'],
      ADJUSTMENT:['categoryId','incomeTypeId','fromAccountId','toAccountId']
    }[row.type]||[];
    if(forbidden.some(key=>Object.prototype.hasOwnProperty.call(row,key)))return {ok:false,error:'AMBIGUOUS_ACCOUNT_FIELDS'};
    return {ok:true,value:row};
  }

  return Object.freeze({
    FINANCE_SCHEMA_VERSION,MIGRATION_CHECKPOINT,PART2_MIGRATION_CHECKPOINT,UPCOMING_OBLIGATION_DAYS,TYPES,SYSTEM_KINDS,OBLIGATION_STATUS,OBLIGATION_RECURRENCE,
    clone,makeId,moneyNumber,createDefaultCategories,createDefaultIncomeTypes,createEmptyFinance,
    normalizeAccount,normalizeTransaction,normalizeReserve,normalizeObligation,normalizeFinance,validateTransactionShape,
    accountEffect,isMigrationComplete,migrateLegacyState,isPart2MigrationComplete,migratePart2State,
    getAccount,getDefaultAccount,getAccountBalance,getTotalBalance,getTransactions,isSystemLocked,
    createTransaction,updateTransaction,deleteTransaction,createAccount,updateAccount,archiveAccount,reconcileAccount,
    getActiveReserves,getTotalReservedAmount,createReserve,updateReserve,adjustReserveAmount,archiveReserve,importLegacyReserve,
    getActiveObligations,getUpcomingObligations,getUpcomingObligationsTotal,createObligation,updateObligation,cancelObligation,payObligation,linkObligationToTransaction,
    getFreeMoney,getObligationCoverage,addDaysISO,addMonthISO,dateSpanDays,getAnalyticsSummary,
    createOrUpdateCategory,archiveCategory,createOrUpdateIncomeType,archiveIncomeType
  });
});
