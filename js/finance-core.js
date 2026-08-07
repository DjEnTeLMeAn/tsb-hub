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
    normalizeAccount,normalizeTransaction,normalizeFinance,validateTransactionShape
  });
});
