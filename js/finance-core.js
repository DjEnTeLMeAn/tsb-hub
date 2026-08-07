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
    accountEffect,isMigrationComplete,migrateLegacyState
  });
});
