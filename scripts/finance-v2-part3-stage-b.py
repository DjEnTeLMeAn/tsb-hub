from pathlib import Path

APP=Path('js/app.js')
CSS=Path('css/mobile-finance.css')
TEST=Path('tests/app-static.test.cjs')
app=APP.read_text(); css=CSS.read_text(); test=TEST.read_text()

old=r'''function financeCurrentMonthStats() {
  const now=new Date();const start=toISODate(new Date(now.getFullYear(),now.getMonth(),1));const end=toISODate(new Date(now.getFullYear(),now.getMonth()+1,0));
  const rows=getFinanceTransactions({dateFrom:start,dateTo:end});const incomes=rows.filter(item=>item.type==='INCOME');const expenses=rows.filter(item=>item.type==='EXPENSE');
  const income=incomes.reduce((sum,item)=>sum+moneyNumber(item.amount),0);const expense=expenses.reduce((sum,item)=>sum+moneyNumber(item.amount),0);const byCategory={};
  expenses.forEach(item=>{byCategory[item.categoryId||'other']=(byCategory[item.categoryId||'other']||0)+moneyNumber(item.amount)});
  const topCategories=Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([categoryId,amount])=>({categoryId,name:getFinanceCategoryLabel(categoryId),amount}));
  return {label:MONTH_NAMES[now.getMonth()].toUpperCase(),income,expense,difference:income-expense,topCategories};
}
'''
new=r'''function financeCurrentMonthStats() {
  const now=new Date();const start=toISODate(new Date(now.getFullYear(),now.getMonth(),1));const end=toISODate(now);
  const summary=TSBFinanceCore.getAnalyticsSummary(getFinanceStateV2(),{dateFrom:start,dateTo:end});
  return {...summary,label:MONTH_NAMES[now.getMonth()].toUpperCase(),topCategories:summary.categoryBreakdown.slice(0,3).map(item=>({...item,name:getFinanceCategoryLabel(item.categoryId)}))};
}
'''
if old not in app: raise RuntimeError('month stats anchor missing')
app=app.replace(old,new,1)

old=r'''function renderFinanceMonthCard() {
  const stats=financeCurrentMonthStats();const diff=stats.difference;const top=stats.topCategories.length?`<div class="finance-v2-month-top">${stats.topCategories.map(item=>`<div><span>${escapeHTML(item.name)}</span><strong>${formatRub(item.amount)}</strong></div>`).join('')}</div>`:'';
  return `<section class="card finance-v2-month-card"><div class="card-title-row"><div><h2>${stats.label}</h2><p class="muted">Только реальные поступления и расходы этого календарного месяца.</p></div></div><div class="finance-v2-month-grid"><div><span>Поступило</span><strong>${formatRub(stats.income)}</strong></div><div><span>Потрачено</span><strong>${formatRub(stats.expense)}</strong></div><div class="difference"><span>Разница</span><strong>${diff>0?'+':''}${formatRub(diff)}</strong></div></div>${top}</section>`;
}
'''
new=r'''function renderFinanceMonthCard() {
  const stats=financeCurrentMonthStats();const diff=stats.difference;const top=stats.topCategories.length?`<div class="finance-v2-month-top">${stats.topCategories.map(item=>`<div><span>${escapeHTML(item.name)}</span><strong>${formatRub(item.amount)}</strong></div>`).join('')}</div>`:'';
  return `<section class="card finance-v2-month-card"><div class="card-title-row"><div><h2>${stats.label}</h2><p class="muted">Только реальные INCOME и EXPENSE.</p></div></div><div class="finance-v2-month-grid"><div><span>Поступило</span><strong>${formatRub(stats.income)}</strong></div><div><span>Потрачено</span><strong>${formatRub(stats.expense)}</strong></div><div class="difference"><span>Разница</span><strong>${diff>0?'+':''}${formatRub(diff)}</strong></div></div>${top}<button class="ghost-button finance-v2-details-button" type="button" data-finance-analytics-open>Подробнее</button></section>`;
}

function ensureFinanceAnalyticsState() {
  if(!state.financeAnalytics||typeof state.financeAnalytics!=='object')state.financeAnalytics={period:'month',dateFrom:'',dateTo:''};
  return state.financeAnalytics;
}
function financeAnalyticsRange(period=ensureFinanceAnalyticsState().period) {
  const a=ensureFinanceAnalyticsState();const today=toISODate(new Date());const now=fromISODate(today);
  if(period==='week')return {dateFrom:getMondayISO(today),dateTo:today};
  if(period==='3m'){const start=new Date(now.getFullYear(),now.getMonth()-2,1);return {dateFrom:toISODate(start),dateTo:today};}
  if(period==='year')return {dateFrom:`${now.getFullYear()}-01-01`,dateTo:today};
  if(period==='custom'){
    const from=normalizeAnyDateKey(a.dateFrom);const to=normalizeAnyDateKey(a.dateTo);
    if(from&&to&&from<=to)return {dateFrom:from,dateTo:to};
  }
  return {dateFrom:toISODate(new Date(now.getFullYear(),now.getMonth(),1)),dateTo:today};
}
function financeAnalyticsSummary() {
  const range=financeAnalyticsRange();return {...TSBFinanceCore.getAnalyticsSummary(getFinanceStateV2(),range),...range};
}
function financeAnalyticsCategoryHTML(summary) {
  if(!summary.categoryBreakdown.length)return '<div class="empty">Расходов за период нет.</div>';
  return summary.categoryBreakdown.map(item=>`<div class="finance-v2-analytics-category"><div><strong>${escapeHTML(getFinanceCategoryLabel(item.categoryId))}</strong><small>${item.count} оп. · ${item.share}%</small></div><strong>${formatRub(item.amount)}</strong></div>`).join('');
}
function renderFinanceAnalyticsScreen(root=$('#tab-finance')) {
  if(!root)return;const a=ensureFinanceAnalyticsState();const summary=financeAnalyticsSummary();const diff=summary.difference;
  const buttons=[['week','Неделя'],['month','Месяц'],['3m','3 месяца'],['year','Год'],['custom','Свой период']].map(([value,label])=>`<button class="ghost-button small ${a.period===value?'active':''}" type="button" data-finance-analytics-period="${value}">${label}</button>`).join('');
  const custom=a.period==='custom'?`<form class="finance-v2-analytics-custom" data-finance-analytics-custom><label>От<input type="date" name="dateFrom" value="${escapeHTML(a.dateFrom||summary.dateFrom)}" required></label><label>До<input type="date" name="dateTo" value="${escapeHTML(a.dateTo||summary.dateTo)}" required></label><button class="primary-button small" type="submit">Показать</button></form>`:'';
  root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Аналитика</h2><p class="muted">Автоматически из реальных операций.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    <section class="card finance-v2-analytics-card"><div class="finance-v2-period-buttons">${buttons}</div>${custom}<p class="muted finance-v2-period-caption">${shortDate(summary.dateFrom)} — ${shortDate(summary.dateTo)} · ${summary.days} дн.</p><div class="finance-v2-analytics-grid"><div><span>Поступления</span><strong>${formatRub(summary.income)}</strong></div><div><span>Расходы</span><strong>${formatRub(summary.expense)}</strong></div><div><span>Разница</span><strong>${diff>0?'+':''}${formatRub(diff)}</strong></div><div><span>Расходных операций</span><strong>${summary.expenseCount}</strong></div><div><span>Среднее в день</span><strong>${formatRub(summary.averageExpensePerDay)}</strong></div></div></section>
    <section class="card"><div class="card-title-row"><div><h2>По категориям</h2><p class="muted">Доля только от EXPENSE выбранного периода.</p></div></div><div class="finance-v2-analytics-categories">${financeAnalyticsCategoryHTML(summary)}</div><button class="ghost-button finance-v2-details-button" type="button" data-finance-analytics-history>Операции периода</button></section>`;
  bindFinanceV2Screen(root);
}
'''
if old not in app: raise RuntimeError('month card anchor missing')
app=app.replace(old,new,1)

app=app.replace('<strong>Аналитика</strong><small>История и фильтры операций</small>','<strong>Аналитика</strong><small>Периоды, суммы и категории</small>',1)

old="  root.querySelector('[data-finance-analytics-open]')?.addEventListener('click',()=>{state.financeSubscreen='';state.financeHistoryOpen=true;renderFinance();});\n"
new="  root.querySelectorAll('[data-finance-analytics-open]').forEach(button=>button.onclick=()=>openFinanceSubscreen('analytics'));\n  root.querySelectorAll('[data-finance-analytics-period]').forEach(button=>button.onclick=()=>{const a=ensureFinanceAnalyticsState();a.period=button.dataset.financeAnalyticsPeriod;renderFinance();});\n  root.querySelector('[data-finance-analytics-custom]')?.addEventListener('submit',event=>{event.preventDefault();const fd=new FormData(event.currentTarget);const a=ensureFinanceAnalyticsState();const from=String(fd.get('dateFrom')||'');const to=String(fd.get('dateTo')||'');if(!normalizeAnyDateKey(from)||!normalizeAnyDateKey(to)||from>to){showToast('Проверь период');return;}a.dateFrom=from;a.dateTo=to;a.period='custom';renderFinance();});\n  root.querySelector('[data-finance-analytics-history]')?.addEventListener('click',()=>{const range=financeAnalyticsRange();const h=ensureFinanceHistoryState();h.period='custom';h.dateFrom=range.dateFrom;h.dateTo=range.dateTo;h.type='ALL';state.financeSubscreen='';state.financeHistoryOpen=true;renderFinance();});\n"
if old not in app: raise RuntimeError('analytics binder anchor missing')
app=app.replace(old,new,1)

old="  if (state.financeSubscreen === 'categories') { renderFinanceCategoriesScreen(root); return; }\n"
new="  if (state.financeSubscreen === 'categories') { renderFinanceCategoriesScreen(root); return; }\n  if (state.financeSubscreen === 'analytics') { renderFinanceAnalyticsScreen(root); return; }\n"
if old not in app: raise RuntimeError('renderFinance subscreen anchor missing')
app=app.replace(old,new,1)
APP.write_text(app)

css += r'''

/* Finance v2 Part3 — analytics */
.finance-v2-details-button{width:100%;margin-top:12px}
.finance-v2-period-buttons{display:flex;gap:8px;flex-wrap:wrap}
.finance-v2-period-buttons .active{outline:1px solid currentColor}
.finance-v2-period-caption{margin:10px 0 0}
.finance-v2-analytics-custom{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.finance-v2-analytics-custom label{display:grid;gap:5px;font-size:.84rem}
.finance-v2-analytics-custom button{grid-column:1/-1}
.finance-v2-analytics-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
.finance-v2-analytics-grid>div{display:grid;gap:3px;padding:10px;border-radius:12px;background:rgba(255,255,255,.035)}
.finance-v2-analytics-grid span,.finance-v2-analytics-category small{font-size:.78rem;opacity:.7}
.finance-v2-analytics-grid strong{font-size:1.05rem}
.finance-v2-analytics-categories{display:grid;gap:4px}
.finance-v2-analytics-category{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.finance-v2-analytics-category:last-child{border-bottom:0}
.finance-v2-analytics-category>div{display:grid;gap:2px}
@media(max-width:520px){.finance-v2-analytics-custom{grid-template-columns:1fr}.finance-v2-analytics-custom button{grid-column:auto}}
'''
CSS.write_text(css)

# Part2 static assertions used to require the month calculation to be duplicated in app.js.
# Part3 centralizes those rules in finance-core.js, so the static check must verify delegation instead.
test=test.replace("assert.ok(app.includes(\"item.type==='INCOME'\"),'month income calculation missing');\nassert.ok(app.includes(\"item.type==='EXPENSE'\"),'month expense calculation missing');\n","assert.ok(app.includes('TSBFinanceCore.getAnalyticsSummary'),'month analytics must delegate to finance core');\n",1)

extra=r'''

// Finance v2 Part3 analytics UI must use the core summary and keep the main card compact.
assert.ok(app.includes('function renderFinanceAnalyticsScreen'),'Part3 analytics screen missing');
assert.ok(app.includes('TSBFinanceCore.getAnalyticsSummary'),'analytics UI must use core analytics');
assert.ok(app.includes("['week','Неделя']"),'analytics week period missing');
assert.ok(app.includes("['month','Месяц']"),'analytics month period missing');
assert.ok(app.includes("['3m','3 месяца']"),'analytics 3 month period missing');
assert.ok(app.includes("['year','Год']"),'analytics year period missing');
assert.ok(app.includes("['custom','Свой период']"),'analytics custom period missing');
assert.ok(app.includes('Среднее в день'),'analytics daily average missing');
assert.ok(app.includes('data-finance-analytics-history'),'analytics to history integration missing');
'''
if 'Finance v2 Part3 analytics UI must use the core summary' not in test:test+=extra
TEST.write_text(test)
print('Finance v2 Part3 stage B applied')
