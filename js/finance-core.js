(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.TSBFinanceCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const FINANCE_SCHEMA_VERSION=2;
  const MIGRATION_CHECKPOINT='FINANCE_V2_PART1_COMPLETE';
  const TYPES=Object.freeze({EXPENSE:'EXPENSE',INCOME:'INCOME',TRANSFER:'TRANSFER',ADJUSTMENT:'ADJUSTMENT'});
  const SYSTEM_KINDS=Object.freeze({MIGRATION_ANCHOR:'MIGRATION_ANCHOR'});

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
      incomeTypes:createDefaultIncomeTypes(createdAt)
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

  function normalizeFinance(value,createdAt=nowISO()){
    const source=value&&typeof value==='object'?value:{};
    const defaults=createEmptyFinance(createdAt);
    const accounts=(Array.isArray(source.accounts)?source.accounts:[]).map((item,index)=>normalizeAccount(item,index,createdAt));
    const defaultIds=DEFAULT_CATEGORY_DEFS.map(([id,name])=>({id,name,system:true}));
    const incomeIds=DEFAULT_INCOME_TYPE_DEFS.map(([id,name])=>({id,name,system:true}));
    const categories=normalizeCollection(source.categories,defaultIds,createdAt);
    const incomeTypes=normalizeCollection(source.incomeTypes,incomeIds,createdAt);
    const transactions=(Array.isArray(source.transactions)?source.transactions:[]).map(item=>normalizeTransaction(item,createdAt)).filter(Boolean);
    if(accounts.length&&!accounts.some(a=>a.isDefault))accounts[0].isDefault=true;
    if(accounts.filter(a=>a.isDefault).length>1){let kept=false;accounts.forEach(a=>{if(a.isDefault&&!kept)kept=true;else if(a.isDefault)a.isDefault=false})}
    return {
      ...defaults,
      ...source,
      schemaVersion:FINANCE_SCHEMA_VERSION,
      migration:{checkpoint:text(source.migration?.checkpoint),completedAt:text(source.migration?.completedAt)},
      accounts,categories,incomeTypes,transactions
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
    return Number(finance?.schemaVersion)===FINANCE_SCHEMA_VERSION&&finance?.migration?.checkpoint===MIGRATION_CHECKPOINT;
  }
  function migrateLegacyState({finance,financeContext,archives,now=nowISO(),idFactory=makeId}={}){
    const sourceFinance=finance&&typeof finance==='object'?finance:{};
    const sourceContext=financeContext&&typeof financeContext==='object'?financeContext:{};
    const nextArchives=archives&&typeof archives==='object'?clone(archives):{};

    if(isMigrationComplete(sourceFinance)){
      return {finance:normalizeFinance(sourceFinance,now),financeContext:clone(sourceContext),archives:nextArchives,migrated:false};
    }

    const alreadyV2=Number(sourceFinance?.schemaVersion)===FINANCE_SCHEMA_VERSION&&Array.isArray(sourceFinance?.transactions);
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
    return roundMoney(state.accounts.filter(account=>!account.archived).reduce((sum,account)=>sum+getAccountBalance(state,account.id),0));
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
  function deleteTransaction(finance,id){
    const state=normalizeFinance(finance);
    const index=state.transactions.findIndex(transaction=>transaction.id===id);
    if(index<0)return {ok:false,error:'NOT_FOUND',finance:state};
    const transaction=state.transactions[index];
    if(isSystemLocked(transaction))return {ok:false,error:'SYSTEM_LOCKED',finance:state};
    state.transactions.splice(index,1);
    return {ok:true,finance:state,transaction};
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
    FINANCE_SCHEMA_VERSION,MIGRATION_CHECKPOINT,TYPES,SYSTEM_KINDS,
    clone,makeId,moneyNumber,createDefaultCategories,createDefaultIncomeTypes,createEmptyFinance,
    normalizeAccount,normalizeTransaction,normalizeFinance,validateTransactionShape,
    accountEffect,isMigrationComplete,migrateLegacyState,
    getAccount,getDefaultAccount,getAccountBalance,getTotalBalance,getTransactions,isSystemLocked,
    createTransaction,updateTransaction,deleteTransaction,createAccount,updateAccount,archiveAccount,
    createOrUpdateCategory,archiveCategory,createOrUpdateIncomeType,archiveIncomeType
  });
});
