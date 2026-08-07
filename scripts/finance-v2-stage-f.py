from pathlib import Path
import re,json

RELEASE='0.11.0-finance-v2-part1-20260807'
APP_VERSION='0.11.0-finance-v2-part1'
APP=Path('js/app.js'); CORE=Path('js/finance-core.js'); INDEX=Path('index.html'); CSS=Path('css/mobile-finance.css')
SW=Path('service-worker.js'); UPDATE=Path('js/update-manager.js'); MANIFEST=Path('manifest.json'); VERSION=Path('version.json')
TEST=Path('tests/app-static.test.cjs'); CORETEST=Path('tests/finance-core.test.cjs'); PKG=Path('package.json')
app=APP.read_text(); core=CORE.read_text(); index=INDEX.read_text(); css=CSS.read_text(); tests=TEST.read_text(); coretests=CORETEST.read_text()

def function_range(source,name):
    token=f'function {name}('; start=source.find(token)
    if start<0: raise RuntimeError(f'Function not found: {name}')
    brace=source.find('{',start+len(token)); depth=0; quote=None; esc=False; line=False; block=False; i=brace
    while i<len(source):
        c=source[i]; n=source[i+1] if i+1<len(source) else ''
        if line:
            if c=='\n': line=False
            i+=1; continue
        if block:
            if c=='*' and n=='/': block=False; i+=2; continue
            i+=1; continue
        if quote:
            if esc: esc=False; i+=1; continue
            if c=='\\': esc=True; i+=1; continue
            if c==quote: quote=None
            i+=1; continue
        if c=='/' and n=='/': line=True; i+=2; continue
        if c=='/' and n=='*': block=True; i+=2; continue
        if c in ('"',"'",'`'): quote=c; i+=1; continue
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0:return start,i+1
        i+=1
    raise RuntimeError(f'End not found: {name}')
def replace_function(source,name,code):
    a,b=function_range(source,name); return source[:a]+code.strip()+source[b:]
def insert_before(source,name,code):
    a,_=function_range(source,name); return source[:a]+code.strip()+'\n\n'+source[a:]

# Core integrity: archived account cannot make money disappear.
core=replace_function(core,'getTotalBalance',r'''
function getTotalBalance(finance){
    const state=normalizeFinance(finance);
    return roundMoney(state.accounts.reduce((sum,account)=>sum+getAccountBalance(state,account.id),0));
  }
''')
core=replace_function(core,'archiveAccount',r'''
function archiveAccount(finance,id,{now=nowISO()}={}){
    const state=normalizeFinance(finance,now);
    const account=state.accounts.find(item=>item.id===id);
    if(!account)return {ok:false,error:'NOT_FOUND',finance:state};
    if(state.accounts.filter(item=>!item.archived&&item.active).length<=1)return {ok:false,error:'LAST_ACTIVE_ACCOUNT',finance:state};
    if(Math.abs(getAccountBalance(state,id))>=0.005)return {ok:false,error:'ACCOUNT_NOT_EMPTY',finance:state};
    return updateAccount(state,id,{archived:true,active:false,isDefault:false},{now});
  }
''')

if 'function renderFinanceHistoryV2' not in app:
    history=r'''
function ensureFinanceHistoryState() {
  if (!state.financeHistory || typeof state.financeHistory !== 'object') {
    state.financeHistory = { type:'ALL', period:'month', categoryId:'', search:'', dateFrom:'', dateTo:'' };
  }
  return state.financeHistory;
}
function financeHistoryRange(period) {
  const today = toISODate(new Date());
  const current = fromISODate(today);
  if (period === 'today') return { dateFrom:today, dateTo:today };
  if (period === '7d') return { dateFrom:addDays(today,-6), dateTo:today };
  if (period === '3m') {
    const start = new Date(current.getFullYear(), current.getMonth()-2, 1);
    return { dateFrom:toISODate(start), dateTo:today };
  }
  if (period === 'custom') {
    const h = ensureFinanceHistoryState();
    return { dateFrom:normalizeDateInput(h.dateFrom)||'', dateTo:normalizeDateInput(h.dateTo)||'' };
  }
  const start = new Date(current.getFullYear(), current.getMonth(), 1);
  const end = new Date(current.getFullYear(), current.getMonth()+1, 0);
  return { dateFrom:toISODate(start), dateTo:toISODate(end) };
}
function financeHistoryTransactions() {
  const h = ensureFinanceHistoryState();
  const range = financeHistoryRange(h.period);
  return getFinanceTransactions({ type:h.type, categoryId:h.categoryId, search:h.search, ...range });
}
function financeHistoryDateLabel(iso) {
  return fromISODate(iso).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
}
function financeHistorySummaryHTML(rows) {
  const expenses=rows.filter(x=>x.type==='EXPENSE'); const incomes=rows.filter(x=>x.type==='INCOME'); const transfers=rows.filter(x=>x.type==='TRANSFER');
  const expenseSum=expenses.reduce((s,x)=>s+moneyNumber(x.amount),0); const incomeSum=incomes.reduce((s,x)=>s+moneyNumber(x.amount),0); const transferSum=transfers.reduce((s,x)=>s+moneyNumber(x.amount),0);
  const h=ensureFinanceHistoryState();
  let title='Операции'; let value=`${rows.length}`; let note=`${rows.length} операций`;
  if(h.type==='EXPENSE'||h.categoryId){title=h.categoryId ? getFinanceCategoryLabel(h.categoryId) : 'Расходы';value=formatRub(expenseSum);note=`${expenses.length} операций`}
  else if(h.type==='INCOME'){title='Поступления';value=formatRub(incomeSum);note=`${incomes.length} операций`}
  else if(h.type==='TRANSFER'){title='Переводы';value=formatRub(transferSum);note=`${transfers.length} операций`}
  else{title='Итог по фильтру';value=`−${formatRub(expenseSum)} · +${formatRub(incomeSum)}`;note=`${rows.length} операций`}
  return `<div class="finance-v2-filter-summary"><div class="muted">${escapeHTML(title)}</div><div class="finance-v2-filter-total">${value}</div><div class="muted">${escapeHTML(note)}</div></div>`;
}
function financeHistoryGroupsHTML(rows) {
  if(!rows.length)return '<div class="empty">По выбранному фильтру операций нет.</div>';
  const groups={}; rows.forEach(transaction=>{(groups[transaction.date] ||= []).push(transaction)});
  return Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0])).map(([date,list])=>`<section class="finance-v2-history-day"><h3>${escapeHTML(financeHistoryDateLabel(date))}</h3><div class="finance-list">${list.map(transaction=>renderFinanceV2TransactionRow(transaction,{compact:false})).join('')}</div></section>`).join('');
}
function renderFinanceHistoryV2(root = $('#tab-finance')) {
  if(!root)return;
  const h=ensureFinanceHistoryState(); const rows=financeHistoryTransactions();
  const typeButtons=[['ALL','Все'],['EXPENSE','Расходы'],['INCOME','Поступления'],['TRANSFER','Переводы']].map(([value,label])=>`<button class="ghost-button small ${h.type===value?'active':''}" type="button" data-finance-history-type="${value}">${label}</button>`).join('');
  const periodButtons=[['today','Сегодня'],['7d','7 дней'],['month','Месяц'],['3m','3 месяца'],['custom','Свой период']].map(([value,label])=>`<button class="ghost-button small ${h.period===value?'active':''}" type="button" data-finance-history-period="${value}">${label}</button>`).join('');
  const categories=[{value:'',label:'Все категории'},...getFinanceStateV2().categories.filter(x=>x.active&&!x.archived).map(x=>({value:x.id,label:x.name}))];
  root.innerHTML=`
    <section class="card finance-v2-history-head"><div class="card-title-row"><div><h2>История операций</h2><p class="muted">Одна база расходов, поступлений и переводов.</p></div><button class="ghost-button small" type="button" data-finance-history-back>Назад</button></div>
      <div class="finance-v2-filter-row">${typeButtons}</div><div class="finance-v2-filter-row">${periodButtons}</div>
      ${h.period==='custom'?`<div class="finance-v2-custom-period"><label>От<input type="date" data-finance-history-from value="${escapeHTML(h.dateFrom||'')}"></label><label>До<input type="date" data-finance-history-to value="${escapeHTML(h.dateTo||'')}"></label></div>`:''}
      <form class="finance-v2-history-search" data-finance-history-search-form><select name="categoryId">${financeOptionHTML(categories,h.categoryId)}</select><input name="search" value="${escapeHTML(h.search||'')}" placeholder="Поиск по описанию"><button class="ghost-button" type="submit">Найти</button></form>
      ${financeHistorySummaryHTML(rows)}
    </section>
    <div class="finance-v2-history-groups">${financeHistoryGroupsHTML(rows)}</div>`;
  bindFinanceV2Screen(root); bindFinanceHistoryV2(root);
}
function bindFinanceHistoryV2(root) {
  root.querySelector('[data-finance-history-back]')?.addEventListener('click',()=>{state.financeHistoryOpen=false;renderFinance()});
  root.querySelectorAll('[data-finance-history-type]').forEach(button=>button.onclick=()=>{ensureFinanceHistoryState().type=button.dataset.financeHistoryType;renderFinance()});
  root.querySelectorAll('[data-finance-history-period]').forEach(button=>button.onclick=()=>{ensureFinanceHistoryState().period=button.dataset.financeHistoryPeriod;renderFinance()});
  root.querySelector('[data-finance-history-from]')?.addEventListener('change',event=>{ensureFinanceHistoryState().dateFrom=event.target.value;renderFinance()});
  root.querySelector('[data-finance-history-to]')?.addEventListener('change',event=>{ensureFinanceHistoryState().dateTo=event.target.value;renderFinance()});
  root.querySelector('[data-finance-history-search-form]')?.addEventListener('submit',event=>{event.preventDefault();const fd=new FormData(event.currentTarget);const h=ensureFinanceHistoryState();h.categoryId=String(fd.get('categoryId')||'');h.search=String(fd.get('search')||'').trim();renderFinance()});
}
'''
    app=insert_before(app,'renderFinance',history)

# Better account archive feedback.
old="applyFinanceMutation(TSBFinanceCore.archiveAccount(getFinanceStateV2(), accountId), 'Счёт архивирован');"
new="const mutation = TSBFinanceCore.archiveAccount(getFinanceStateV2(), accountId); if (!mutation.ok && mutation.error === 'ACCOUNT_NOT_EMPTY') { showToast('Сначала переведи деньги с этого счёта'); return; } applyFinanceMutation(mutation, 'Счёт архивирован');"
if old in app: app=app.replace(old,new,1)

# Version the core app itself.
app=re.sub(r"const APP_VERSION = '[^']+';",f"const APP_VERSION = '{APP_VERSION}';",app,count=1)

# History UI CSS.
marker='/* Finance v2 Part 1 — unified history */'
if marker not in css:
    css += r'''

/* Finance v2 Part 1 — unified history */
.finance-v2-filter-row{display:flex;gap:7px;overflow-x:auto;padding:3px 0 6px;scrollbar-width:none}
.finance-v2-filter-row::-webkit-scrollbar{display:none}
.finance-v2-filter-row .active{border-color:rgba(139,92,246,.55);background:rgba(139,92,246,.14)}
.finance-v2-history-search{display:grid;grid-template-columns:minmax(120px,.8fr) minmax(140px,1.2fr) auto;gap:8px;margin-top:10px}
.finance-v2-history-search select,.finance-v2-history-search input{min-width:0}
.finance-v2-custom-period{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.finance-v2-custom-period label{display:grid;gap:5px;font-size:.78rem;color:var(--muted)}
.finance-v2-filter-summary{padding:14px;margin-top:12px;border:1px solid rgba(139,92,246,.24);border-radius:16px;background:rgba(139,92,246,.055)}
.finance-v2-filter-total{font-size:1.35rem;font-weight:900;margin:4px 0}
.finance-v2-history-groups{display:grid;gap:12px;margin-top:12px}
.finance-v2-history-day>h3{font-size:.9rem;color:var(--muted);margin:0 0 7px 5px;text-transform:none;font-weight:750}
@media(max-width:600px){.finance-v2-history-search{grid-template-columns:1fr 1fr}.finance-v2-history-search button{grid-column:1/-1}.finance-v2-custom-period{grid-template-columns:1fr 1fr}}
'''

# Release shell.
old_release_match=re.search(r'data-release="([^"]+)"',index)
old_release=old_release_match.group(1) if old_release_match else ''
if old_release: index=index.replace(old_release,RELEASE)
index=re.sub(r'<title>TSB Hub v[^<]+</title>','<title>TSB Hub v0.11.0</title>',index)
index=re.sub(r'\s*<script defer src="js/finance-module-v1\.js\?v=[^"]+"></script>','',index)
if 'js/finance-core.js' not in index: raise RuntimeError('finance-core missing from index')

sw=SW.read_text(); sw=re.sub(r"const RELEASE='[^']+';",f"const RELEASE='{RELEASE}';",sw,count=1)
sw=re.sub(r"\s*`\./js/finance-module-v1\.js\?v=\$\{RELEASE\}`,?",'',sw)
if 'js/finance-core.js' not in sw:
    sw=sw.replace('  `./js/app.js?v=${RELEASE}`,','  `./js/finance-core.js?v=${RELEASE}`,\n  `./js/app.js?v=${RELEASE}`,')
SW.write_text(sw)

update=UPDATE.read_text(); update=re.sub(r'// TSB Hub v[^\n]+','// TSB Hub v0.11.0-finance-v2-part1 — single PWA update authority.',update,count=1); update=re.sub(r"const RELEASE='[^']+';",f"const RELEASE='{RELEASE}';",update,count=1); UPDATE.write_text(update)
manifest=json.loads(MANIFEST.read_text()); manifest['start_url']=f'./index.html?v={RELEASE}'; manifest['version']=RELEASE
for icon in manifest.get('icons',[]): icon['src']=re.sub(r'\?v=.*$',f'?v={RELEASE}',icon['src'])
MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
VERSION.write_text(json.dumps({'release':RELEASE,'publishedAt':'2026-08-07T18:30:00+05:00','cache':f'tsb-hub-{RELEASE}'},ensure_ascii=False,indent=2)+'\n')

# Tests: persistence and archive safety.
if "serialization keeps balances stable" not in coretests:
    coretests += r'''

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
'''

# Strong static final checks.
tests += f'''\nassert.ok(app.includes('function renderFinanceHistoryV2'),'unified history missing');
assert.ok(app.includes("const APP_VERSION = '{APP_VERSION}'"),'app version mismatch');
assert.equal(index.includes('finance-module-v1.js'),false,'legacy finance module reference remains');
assert.ok(index.includes('{RELEASE}'),'release shell mismatch');
const sw=fs.readFileSync('service-worker.js','utf8');
assert.ok(sw.includes('js/finance-core.js'),'service worker must cache finance core');
assert.equal(sw.includes('finance-module-v1.js'),false,'service worker still references Finance v1');
assert.equal(fs.existsSync('js/finance-module-v1.js'),false,'Finance v1 file must be removed');
'''

pkg=json.loads(PKG.read_text()); pkg['scripts']['lint']='node --check js/finance-core.js && node --check js/app.js && node --check js/mobile-first-cleanup.js && node --check js/mobile-dashboard.js && node --check js/update-manager.js && node --check service-worker.js'; pkg['scripts']['build']='node tests/app-static.test.cjs'; PKG.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')

APP.write_text(app); CORE.write_text(core); INDEX.write_text(index); CSS.write_text(css); TEST.write_text(tests); CORETEST.write_text(coretests)

# Remove old override and temporary implementation machinery from final tree.
for path in [
  'js/finance-module-v1.js',
  'scripts/finance-v2-stage-c.mjs','scripts/finance-v2-stage-d.py','scripts/finance-v2-stage-e.py','scripts/finance-v2-stage-f.py',
  '.github/workflows/finance-v2-stage-c.yml','.github/workflows/finance-v2-stage-d.yml','.github/workflows/finance-v2-stage-e.yml','.github/workflows/finance-v2-stage-f.yml'
]:
    p=Path(path)
    if p.exists(): p.unlink()
print('Stage F applied and temporary files removed')
