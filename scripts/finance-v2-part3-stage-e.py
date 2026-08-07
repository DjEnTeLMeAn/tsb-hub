from pathlib import Path

APP=Path('js/app.js'); CSS=Path('css/mobile-finance.css'); STATIC=Path('tests/app-static.test.cjs')
app=APP.read_text(); css=CSS.read_text(); static=STATIC.read_text()

old="    state.financeHistory = { type:'ALL', period:'month', categoryId:'', search:'', dateFrom:'', dateTo:'' };"
new="    state.financeHistory = { type:'ALL', period:'month', categoryId:'', accountId:'', search:'', dateFrom:'', dateTo:'' };"
if old not in app: raise RuntimeError('history default state anchor missing')
app=app.replace(old,new,1)

# Add year range before custom.
old="  if (period === '3m') {\n    const start = new Date(current.getFullYear(), current.getMonth()-2, 1);\n    return { dateFrom:toISODate(start), dateTo:today };\n  }\n  if (period === 'custom') {"
new="  if (period === '3m') {\n    const start = new Date(current.getFullYear(), current.getMonth()-2, 1);\n    return { dateFrom:toISODate(start), dateTo:today };\n  }\n  if (period === 'year') return { dateFrom:`${current.getFullYear()}-01-01`, dateTo:today };\n  if (period === 'custom') {"
if old not in app: raise RuntimeError('history range 3m anchor missing')
app=app.replace(old,new,1)

old="  return getFinanceTransactions({ type:h.type, categoryId:h.categoryId, search:h.search, ...range });"
new="  return getFinanceTransactions({ type:h.type, categoryId:h.categoryId, accountId:h.accountId, search:h.search, ...range });"
if old not in app: raise RuntimeError('history transactions anchor missing')
app=app.replace(old,new,1)

# Replace compact single-value summary with analysis strip.
start=app.find('function financeHistorySummaryHTML(rows) {')
end=app.find('\nfunction financeHistoryGroupsHTML(rows)',start)
if start<0 or end<0: raise RuntimeError('history summary function range missing')
summary=r'''function financeHistorySummaryHTML(rows) {
  const expenses=rows.filter(x=>x.type==='EXPENSE');const incomes=rows.filter(x=>x.type==='INCOME');
  const expense=incomes.length>=0?expenses.reduce((s,x)=>s+moneyNumber(x.amount),0):0;const income=incomes.reduce((s,x)=>s+moneyNumber(x.amount),0);const difference=income-expense;
  return `<div class="finance-v2-history-summary-grid"><div><span>Поступления</span><strong>${formatRub(income)}</strong></div><div><span>Расходы</span><strong>${formatRub(expense)}</strong></div><div><span>Разница</span><strong>${difference>0?'+':''}${formatRub(difference)}</strong></div><div><span>Операций</span><strong>${rows.length}</strong></div></div><p class="muted finance-v2-history-summary-note">TRANSFER и ADJUSTMENT не считаются доходом или расходом.</p>`;
}'''
app=app[:start]+summary+app[end:]

# Replace history renderer as one coherent UI block.
start=app.find("function renderFinanceHistoryV2(root = $('#tab-finance')) {")
end=app.find('\nfunction bindFinanceHistoryV2(root)',start)
if start<0 or end<0: raise RuntimeError('history renderer range missing')
renderer=r'''function renderFinanceHistoryV2(root = $('#tab-finance')) {
  if(!root)return;
  const h=ensureFinanceHistoryState(); const rows=financeHistoryTransactions();const finance=getFinanceStateV2();
  const typeButtons=[['ALL','Все'],['EXPENSE','Расходы'],['INCOME','Поступления'],['TRANSFER','Переводы'],['ADJUSTMENT','Корректировки']].map(([value,label])=>`<button class="ghost-button small ${h.type===value?'active':''}" type="button" data-finance-history-type="${value}">${label}</button>`).join('');
  const periodButtons=[['today','Сегодня'],['7d','7 дней'],['month','Месяц'],['3m','3 месяца'],['year','Год'],['custom','Свой период']].map(([value,label])=>`<button class="ghost-button small ${h.period===value?'active':''}" type="button" data-finance-history-period="${value}">${label}</button>`).join('');
  const categories=[{value:'',label:'Все категории'},...finance.categories.filter(x=>x.active&&!x.archived).map(x=>({value:x.id,label:x.name}))];
  const accounts=[{value:'',label:'Все счета'},...finance.accounts.map(x=>({value:x.id,label:`${x.name}${x.archived?' · архив':''}`}))];
  root.innerHTML=`
    <section class="card finance-v2-history-head"><div class="card-title-row"><div><h2>История операций</h2><p class="muted">Фильтры и сводка читают ту же единую базу transactions[].</p></div><button class="ghost-button small" type="button" data-finance-history-back>Назад</button></div>
      <div class="finance-v2-filter-row">${typeButtons}</div><div class="finance-v2-filter-row">${periodButtons}</div>
      ${h.period==='custom'?`<div class="finance-v2-custom-period"><label>От<input type="date" data-finance-history-from value="${escapeHTML(h.dateFrom||'')}"></label><label>До<input type="date" data-finance-history-to value="${escapeHTML(h.dateTo||'')}"></label></div>`:''}
      <form class="finance-v2-history-search" data-finance-history-search-form><select name="accountId">${financeOptionHTML(accounts,h.accountId)}</select><select name="categoryId">${financeOptionHTML(categories,h.categoryId)}</select><input name="search" value="${escapeHTML(h.search||'')}" placeholder="Поиск по описанию"><button class="ghost-button" type="submit">Применить</button></form>
      ${financeHistorySummaryHTML(rows)}
      <button class="ghost-button finance-v2-details-button" type="button" data-finance-history-export>CSV этой выборки</button>
    </section>
    <div class="finance-v2-history-groups">${financeHistoryGroupsHTML(rows)}</div>`;
  bindFinanceV2Screen(root); bindFinanceHistoryV2(root);
}'''
app=app[:start]+renderer+app[end:]

# Expand form binder and filtered CSV.
old="  root.querySelector('[data-finance-history-search-form]')?.addEventListener('submit',event=>{event.preventDefault();const fd=new FormData(event.currentTarget);const h=ensureFinanceHistoryState();h.categoryId=String(fd.get('categoryId')||'');h.search=String(fd.get('search')||'').trim();renderFinance()});\n"
new="  root.querySelector('[data-finance-history-search-form]')?.addEventListener('submit',event=>{event.preventDefault();const fd=new FormData(event.currentTarget);const h=ensureFinanceHistoryState();h.accountId=String(fd.get('accountId')||'');h.categoryId=String(fd.get('categoryId')||'');h.search=String(fd.get('search')||'').trim();renderFinance()});\n  root.querySelector('[data-finance-history-export]')?.addEventListener('click',()=>exportFinanceCsv(financeHistoryTransactions(),'history-filtered'));\n"
if old not in app: raise RuntimeError('history form binder anchor missing')
app=app.replace(old,new,1)
APP.write_text(app)

css += r'''

/* Finance v2 Part3 — history analysis */
.finance-v2-history-summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}
.finance-v2-history-summary-grid>div{display:grid;gap:3px;padding:9px;border-radius:11px;background:rgba(255,255,255,.035)}
.finance-v2-history-summary-grid span{font-size:.74rem;opacity:.7}
.finance-v2-history-summary-grid strong{font-size:.94rem;overflow-wrap:anywhere}
.finance-v2-history-summary-note{margin:7px 0 0}
@media(max-width:600px){.finance-v2-history-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.finance-v2-history-search{grid-template-columns:1fr}}
'''
CSS.write_text(css)

extra=r'''

// Finance v2 Part3 history is an analysis tool, not a second ledger.
assert.ok(app.includes("['year','Год']"),'history year period missing');
assert.ok(app.includes("['ADJUSTMENT','Корректировки']"),'history adjustment filter missing');
assert.ok(app.includes("accountId:h.accountId"),'history account filter must use core transactions filter');
assert.ok(app.includes('finance-v2-history-summary-grid'),'history analysis summary missing');
assert.ok(app.includes('data-finance-history-export'),'filtered history CSV export missing');
assert.ok(app.includes("exportFinanceCsv(financeHistoryTransactions(),'history-filtered')"),'history export must use current filtered rows');
'''
if 'Finance v2 Part3 history is an analysis tool' not in static:static+=extra
STATIC.write_text(static)
print('Finance v2 Part3 stage E applied')
