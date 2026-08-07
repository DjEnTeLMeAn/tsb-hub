from pathlib import Path
from datetime import datetime, timezone, timedelta
import json,re

RELEASE='0.13.0-finance-v2-complete-20260807'
APP_VERSION='0.13.0-finance-v2-complete'
OLD_RELEASE='0.12.0-finance-v2-part2-20260807'
OLD_APP_VERSION='0.12.0-finance-v2-part2'

APP=Path('js/app.js'); INDEX=Path('index.html'); SW=Path('service-worker.js'); UPDATE=Path('js/update-manager.js'); MANIFEST=Path('manifest.json'); VERSION=Path('version.json'); STATIC=Path('tests/app-static.test.cjs'); REG=Path('tests/finance-part3-regression.test.cjs')
app=APP.read_text(); index=INDEX.read_text(); sw=SW.read_text(); update=UPDATE.read_text(); static=STATIC.read_text()

# Small cleanup from Stage E; no behavior change.
app=app.replace("const expense=incomes.length>=0?expenses.reduce((s,x)=>s+moneyNumber(x.amount),0):0;","const expense=expenses.reduce((s,x)=>s+moneyNumber(x.amount),0);",1)

# Release hygiene.
if OLD_APP_VERSION not in app: raise RuntimeError('old app version not found')
app=app.replace(OLD_APP_VERSION,APP_VERSION)
for name,text in [('index',index),('sw',sw),('update',update),('static',static)]:
    if OLD_RELEASE not in text: raise RuntimeError(f'old release not found in {name}')
index=index.replace(OLD_RELEASE,RELEASE)
sw=sw.replace(OLD_RELEASE,RELEASE)
update=update.replace(OLD_RELEASE,RELEASE)
static=static.replace(OLD_RELEASE,RELEASE).replace(OLD_APP_VERSION,APP_VERSION)
index=re.sub(r'<title>TSB Hub v[^<]+</title>','<title>TSB Hub v0.13.0</title>',index,count=1)
update=re.sub(r'// TSB Hub v[^\n]+', '// TSB Hub v0.13.0-finance-v2-complete — single PWA update authority.',update,count=1)

manifest=json.loads(MANIFEST.read_text())
manifest['start_url']=f'./index.html?v={RELEASE}'
manifest['version']=RELEASE
for icon in manifest.get('icons',[]): icon['src']=re.sub(r'\?v=.*$',f'?v={RELEASE}',icon['src'])
published=datetime.now(timezone(timedelta(hours=5))).replace(microsecond=0).isoformat()
version={'release':RELEASE,'publishedAt':published,'cache':f'tsb-hub-{RELEASE}'}

APP.write_text(app);INDEX.write_text(index);SW.write_text(sw);UPDATE.write_text(update);MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');VERSION.write_text(json.dumps(version,ensure_ascii=False,indent=2)+'\n')

# Final static invariants.
static += r'''

// Finance v2 complete: architecture and daily-input invariants.
assert.ok(app.includes("const STORAGE_KEY = 'tsb_hub_data_v1'"),'storage key must remain unchanged');
const coreText=fs.readFileSync('js/finance-core.js','utf8');
assert.ok(coreText.includes('const FINANCE_SCHEMA_VERSION=3'),'Finance schema must remain v3');
assert.ok(coreText.includes("RECONCILIATION:'RECONCILIATION'"),'reconciliation system kind missing');
const quickStart=app.indexOf('function renderFinanceQuickForm');
const quickEnd=app.indexOf('function ',quickStart+20);
const quickFn=app.slice(quickStart,quickEnd>quickStart?quickEnd:app.length);
assert.ok(quickFn.includes('name="amount"'),'quick expense amount missing');
assert.ok(quickFn.includes('name="categoryId"'),'quick expense category missing');
assert.equal(quickFn.includes('name="accountId"'),false,'quick daily expense must not require account selection');
assert.equal(quickFn.includes('reserveId'),false,'quick daily expense must not require reserve allocation');
assert.equal(quickFn.includes('obligationId'),false,'quick daily expense must not require obligation selection');
assert.equal(index.includes('finance-module-v3.js'),false,'Finance v2 complete must not add an override module');
assert.equal(fs.existsSync('js/finance-module-v3.js'),false,'Finance v2 complete override file must not exist');
'''
STATIC.write_text(static)

REG.write_text(r'''const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../js/finance-core.js');

function baseFinance(){
  let f=core.createEmptyFinance('2026-08-07T00:00:00.000Z');
  f=core.createAccount(f,{id:'card',name:'Card',isDefault:true},{now:'2026-08-07T00:00:00.000Z'}).finance;
  const income=core.createTransaction(f,{type:'INCOME',amount:1000,accountId:'card',incomeTypeId:'personal',date:'2026-08-07'},{now:'2026-08-07T09:00:00.000Z',idFactory:()=> 'income'});
  assert.equal(income.ok,true);return income.finance;
}

test('Finance v2 complete keeps schema v3 and derived collections after JSON roundtrip',()=>{
  let f=baseFinance();
  f=core.createReserve(f,{name:'Подушка',amount:100},{now:'2026-08-07T10:00:00.000Z',idFactory:()=> 'reserve'}).finance;
  f=core.createObligation(f,{name:'Интернет',amount:200,dueDate:'2026-08-20',recurrence:'NONE'},{now:'2026-08-07T10:05:00.000Z',idFactory:()=> 'obligation'}).finance;
  const normalized=core.normalizeFinance(JSON.parse(JSON.stringify(f)),'2026-08-07T11:00:00.000Z');
  assert.equal(normalized.schemaVersion,3);assert.equal(normalized.reserves.length,1);assert.equal(normalized.obligations.length,1);
  assert.equal(core.getTotalBalance(normalized),1000);assert.equal(core.getFreeMoney(normalized,{today:'2026-08-07'}),700);
  const analytics=core.getAnalyticsSummary(normalized,{dateFrom:'2026-08-01',dateTo:'2026-08-31'});
  assert.deepEqual({income:analytics.income,expense:analytics.expense,difference:analytics.difference},{income:1000,expense:0,difference:1000});
});

test('reconciliation is reversible and never becomes user income or expense',()=>{
  const f=baseFinance();
  const r=core.reconcileAccount(f,'card',875,{date:'2026-08-07',now:'2026-08-07T12:00:00.000Z',idFactory:()=> 'reconcile'});
  assert.equal(r.ok,true);assert.equal(core.getAccountBalance(r.finance,'card'),875);
  const analytics=core.getAnalyticsSummary(r.finance,{dateFrom:'2026-08-07',dateTo:'2026-08-07'});
  assert.equal(analytics.income,1000);assert.equal(analytics.expense,0);
  const deleted=core.deleteTransaction(r.finance,'reconcile');assert.equal(deleted.ok,true);assert.equal(core.getAccountBalance(deleted.finance,'card'),1000);
});

test('custom income type can be archived without breaking historical INCOME reference',()=>{
  let f=baseFinance();
  const type=core.createOrUpdateIncomeType(f,{name:'Подработка'},{now:'2026-08-07T13:00:00.000Z',idFactory:()=> 'side_job'});assert.equal(type.ok,true);f=type.finance;
  const income=core.createTransaction(f,{type:'INCOME',amount:250,accountId:'card',incomeTypeId:'side_job',date:'2026-08-07'},{now:'2026-08-07T13:05:00.000Z',idFactory:()=> 'side_income'});assert.equal(income.ok,true);f=income.finance;
  const archived=core.archiveIncomeType(f,'side_job',{now:'2026-08-07T13:10:00.000Z'});assert.equal(archived.ok,true);
  const tx=archived.finance.transactions.find(x=>x.id==='side_income');assert.equal(tx.incomeTypeId,'side_job');
  const item=archived.finance.incomeTypes.find(x=>x.id==='side_job');assert.equal(item.archived,true);
  assert.equal(core.getAnalyticsSummary(archived.finance,{dateFrom:'2026-08-07',dateTo:'2026-08-07'}).income,1250);
});

test('Part1 transfer and Part2 reserve semantics remain intact with Part3 analytics',()=>{
  let f=baseFinance();f=core.createAccount(f,{id:'cash',name:'Cash'},{now:'2026-08-07T14:00:00.000Z'}).finance;
  const tr=core.createTransaction(f,{type:'TRANSFER',amount:300,fromAccountId:'card',toAccountId:'cash',date:'2026-08-07'},{now:'2026-08-07T14:05:00.000Z',idFactory:()=> 'transfer'});assert.equal(tr.ok,true);f=tr.finance;
  const before=core.getTotalBalance(f);const reserve=core.createReserve(f,{name:'Машина',amount:200},{now:'2026-08-07T14:10:00.000Z',idFactory:()=> 'car'});assert.equal(reserve.ok,true);f=reserve.finance;
  assert.equal(core.getTotalBalance(f),before);
  const a=core.getAnalyticsSummary(f,{dateFrom:'2026-08-07',dateTo:'2026-08-07'});assert.equal(a.income,1000);assert.equal(a.expense,0);assert.equal(a.difference,1000);
});
''')
print(f'Finance v2 Part3 finalization applied: {RELEASE}')
