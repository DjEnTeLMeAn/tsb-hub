import fs from 'node:fs';

const corePath='js/finance-core.js';
const testPath='tests/finance-core.test.cjs';
let core=fs.readFileSync(corePath,'utf8');
let tests=fs.readFileSync(testPath,'utf8');

if(core.includes('function getAccountBalance(finance,accountId)')){
  console.log('Stage C already applied');
  process.exit(0);
}

const api=`
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
  function transactionSortKey(transaction){return \`${'${transaction?.date||\'\'}'}T${'${transaction?.time||\'00:00\'}'}|${'${transaction?.updatedAt||transaction?.createdAt||\'\'}'}\`}
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
`;

core=core.replace('  function validateTransactionShape(transaction){',api+'\n  function validateTransactionShape(transaction){');
core=core.replace('accountEffect,isMigrationComplete,migrateLegacyState\n  });','accountEffect,isMigrationComplete,migrateLegacyState,\n    getAccount,getDefaultAccount,getAccountBalance,getTotalBalance,getTransactions,isSystemLocked,\n    createTransaction,updateTransaction,deleteTransaction,createAccount,updateAccount,archiveAccount,\n    createOrUpdateCategory,archiveCategory,createOrUpdateIncomeType,archiveIncomeType\n  });');
if(!core.includes('getAccountBalance,getTotalBalance'))throw new Error('Stage C export patch failed');
fs.writeFileSync(corePath,core);

tests+=`\n\ntest('balances are derived from expense, income and transfer operations',()=>{\n  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');\n  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true},{now:'2026-08-07T00:00:00.000Z'}).finance;\n  f=core.createAccount(f,{id:'a2',name:'Наличные'},{now:'2026-08-07T00:00:00.000Z'}).finance;\n  f=core.createTransaction(f,{id:'in',type:'INCOME',amount:10000,accountId:'a1',incomeTypeId:'personal',date:'2026-08-07'},{now:'2026-08-07T10:00:00.000Z'}).finance;\n  f=core.createTransaction(f,{id:'out',type:'EXPENSE',amount:2000,accountId:'a1',categoryId:'food',date:'2026-08-07'},{now:'2026-08-07T11:00:00.000Z'}).finance;\n  f=core.createTransaction(f,{id:'move',type:'TRANSFER',amount:3000,fromAccountId:'a1',toAccountId:'a2',date:'2026-08-07'},{now:'2026-08-07T12:00:00.000Z'}).finance;\n  assert.equal(core.getAccountBalance(f,'a1'),5000);\n  assert.equal(core.getAccountBalance(f,'a2'),3000);\n  assert.equal(core.getTotalBalance(f),8000);\n});\n\ntest('editing and deleting transactions recalculate balances without double effects',()=>{\n  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');\n  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true},{now:'2026-08-07T00:00:00.000Z'}).finance;\n  f=core.createTransaction(f,{id:'anchor',type:'ADJUSTMENT',amount:1000,accountId:'a1',date:'2026-08-07'}).finance;\n  f=core.createTransaction(f,{id:'e1',type:'EXPENSE',amount:100,accountId:'a1',categoryId:'food',date:'2026-08-07'}).finance;\n  assert.equal(core.getAccountBalance(f,'a1'),900);\n  const edited=core.updateTransaction(f,'e1',{amount:150});assert.equal(edited.ok,true);f=edited.finance;\n  assert.equal(core.getAccountBalance(f,'a1'),850);\n  const deleted=core.deleteTransaction(f,'e1');assert.equal(deleted.ok,true);f=deleted.finance;\n  assert.equal(core.getAccountBalance(f,'a1'),1000);\n});\n\ntest('migration anchors are hidden and cannot be edited or deleted',()=>{\n  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');\n  f.accounts=[{id:'a1',name:'Карта',active:true,archived:false,isDefault:true,createdAt:'2026-08-07T00:00:00.000Z'}];\n  f.transactions=[core.normalizeTransaction({id:'m1',type:'ADJUSTMENT',amount:1000,accountId:'a1',systemKind:'MIGRATION_ANCHOR',date:'2026-08-07'},'2026-08-07T00:00:00.000Z')];\n  assert.equal(core.getTransactions(f).length,0);\n  assert.equal(core.getTransactions(f,{includeSystem:true}).length,1);\n  assert.equal(core.updateTransaction(f,'m1',{amount:5}).error,'SYSTEM_LOCKED');\n  assert.equal(core.deleteTransaction(f,'m1').error,'SYSTEM_LOCKED');\n});\n\ntest('transaction filters use the same source of truth',()=>{\n  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');\n  f=core.createAccount(f,{id:'a1',name:'Карта',isDefault:true}).finance;\n  f=core.createTransaction(f,{id:'e1',type:'EXPENSE',amount:100,accountId:'a1',categoryId:'food',description:'магазин',date:'2026-08-06'}).finance;\n  f=core.createTransaction(f,{id:'e2',type:'EXPENSE',amount:200,accountId:'a1',categoryId:'transport',description:'бензин',date:'2026-08-07'}).finance;\n  f=core.createTransaction(f,{id:'i1',type:'INCOME',amount:500,accountId:'a1',incomeTypeId:'personal',description:'работа',date:'2026-08-07'}).finance;\n  assert.deepEqual(core.getTransactions(f,{type:'EXPENSE',dateFrom:'2026-08-07'}).map(x=>x.id),['e2']);\n  assert.deepEqual(core.getTransactions(f,{categoryId:'food'}).map(x=>x.id),['e1']);\n  assert.deepEqual(core.getTransactions(f,{search:'бенз'}).map(x=>x.id),['e2']);\n});\n`;
fs.writeFileSync(testPath,tests);
console.log('Stage C patch applied');
