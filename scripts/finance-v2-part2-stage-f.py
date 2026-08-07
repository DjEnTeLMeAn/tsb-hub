from pathlib import Path
APP=Path('js/app.js'); CSS=Path('css/mobile-finance.css'); TEST=Path('tests/app-static.test.cjs')
app=APP.read_text(); css=CSS.read_text(); tests=TEST.read_text()

def once(s,old,new,label):
    if old not in s: raise RuntimeError(f'missing anchor: {label}')
    if s.count(old)!=1: raise RuntimeError(f'non-unique anchor: {label} ({s.count(old)})')
    return s.replace(old,new,1)

# Money-now should contain only the four control numbers; quick actions get their own block.
app=once(app,
"    </div>${warning}\n    <div class=\"finance-v2-primary-actions\"><button class=\"primary-button\" type=\"button\" data-finance-v2-income-add>+ Поступление</button><button class=\"ghost-button\" type=\"button\" data-finance-v2-transfer-add>Перевод</button></div>\n  </section>`;",
"    </div>${warning}\n  </section>`;",
'move quick actions out of money card')

anchor="function getFinanceActiveReserves() {"
if anchor not in app: raise RuntimeError('finance feature anchor missing')
main_helpers=r'''function financeCurrentMonthStats() {
  const now=new Date();const start=toISODate(new Date(now.getFullYear(),now.getMonth(),1));const end=toISODate(new Date(now.getFullYear(),now.getMonth()+1,0));
  const rows=getFinanceTransactions({dateFrom:start,dateTo:end});const incomes=rows.filter(item=>item.type==='INCOME');const expenses=rows.filter(item=>item.type==='EXPENSE');
  const income=incomes.reduce((sum,item)=>sum+moneyNumber(item.amount),0);const expense=expenses.reduce((sum,item)=>sum+moneyNumber(item.amount),0);const byCategory={};
  expenses.forEach(item=>{byCategory[item.categoryId||'other']=(byCategory[item.categoryId||'other']||0)+moneyNumber(item.amount)});
  const topCategories=Object.entries(byCategory).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([categoryId,amount])=>({categoryId,name:getFinanceCategoryLabel(categoryId),amount}));
  return {label:MONTH_NAMES[now.getMonth()].toUpperCase(),income,expense,difference:income-expense,topCategories};
}
function renderFinanceQuickActions() {
  return `<section class="card finance-v2-quick-actions-card"><div class="card-title-row"><h2>Быстрые действия</h2></div><div class="finance-v2-quick-actions"><button class="primary-button" type="button" data-finance-v2-income-add>+ Поступление</button><button class="ghost-button" type="button" data-finance-v2-expense-add>+ Расход</button><button class="ghost-button" type="button" data-finance-v2-transfer-add>Перевод</button><button class="ghost-button" type="button" data-finance-more>Ещё</button></div></section>`;
}
function renderFinanceMonthCard() {
  const stats=financeCurrentMonthStats();const diff=stats.difference;const top=stats.topCategories.length?`<div class="finance-v2-month-top">${stats.topCategories.map(item=>`<div><span>${escapeHTML(item.name)}</span><strong>${formatRub(item.amount)}</strong></div>`).join('')}</div>`:'';
  return `<section class="card finance-v2-month-card"><div class="card-title-row"><div><h2>${stats.label}</h2><p class="muted">Только реальные поступления и расходы этого календарного месяца.</p></div></div><div class="finance-v2-month-grid"><div><span>Поступило</span><strong>${formatRub(stats.income)}</strong></div><div><span>Потрачено</span><strong>${formatRub(stats.expense)}</strong></div><div class="difference"><span>Разница</span><strong>${diff>0?'+':''}${formatRub(diff)}</strong></div></div>${top}</section>`;
}
async function openFinanceV2ExpenseDialog() {
  const account=getDefaultFinanceAccount();if(!account)return;
  const now=new Date();const today=toISODate(now);const hm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const result=await openEditDialog({title:'Добавить расход',fields:[
    {name:'amount',label:'Сумма',value:'',placeholder:'Напр. 1200'},
    {name:'categoryId',label:'Категория',type:'select',value:'other',options:financeCategoryOptions('other')},
    {name:'accountId',label:'Счёт',type:'select',value:account.id,options:financeAccountOptions(account.id)},
    {name:'description',label:'Описание',type:'textarea',value:'',placeholder:'Необязательно'},
    {name:'date',label:'Дата',type:'date',value:today},{name:'time',label:'Время',type:'time',value:hm}
  ],submitText:'Добавить'});if(!result)return;
  const amount=normalizeMoneyInput(result.amount);if(!amount)return;
  applyFinanceMutation(TSBFinanceCore.createTransaction(getFinanceStateV2(),{type:'EXPENSE',amount,categoryId:result.categoryId,accountId:result.accountId,description:result.description,date:normalizeDateInput(result.date)||today,time:result.time},{idFactory:uid}),'Расход добавлен');
}
function openFinanceSubscreen(name,returnTo='') {state.financeSubscreen=name;state.financeSubscreenReturn=returnTo;state.financeHistoryOpen=false;renderFinance();}
function closeFinanceSubscreen() {const target=state.financeSubscreenReturn||'';state.financeSubscreen=target;state.financeSubscreenReturn='';renderFinance();}
function renderFinanceManagementLinks() {
  return `<section class="card finance-v2-navigation-card"><button class="finance-v2-nav-row" type="button" data-finance-analytics-open><span><strong>Аналитика</strong><small>История и фильтры операций</small></span><b>›</b></button><button class="finance-v2-nav-row" type="button" data-finance-management-root><span><strong>Управление</strong><small>Счета, категории, резервы и платежи</small></span><b>›</b></button></section>`;
}
function renderFinanceAccountsScreen(root=$('#tab-finance')) {
  if(!root)return;const accounts=getFinanceAccounts();root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Счета и наличные</h2><p class="muted">Баланс каждого счёта вычисляется из операций.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section><section class="card finance-v2-accounts-card"><div class="card-title-row"><h2>Активные счета</h2><button class="primary-button small" type="button" data-finance-v2-account-add>+ Счёт</button></div><div class="finance-v2-accounts">${accounts.map(renderFinanceV2AccountCard).join('')||'<div class="empty">Счетов пока нет.</div>'}</div></section>`;bindFinanceV2Screen(root);
}
function renderFinanceCategoryCard(category) {
  return `<article class="finance-v2-manage-item"><div><div class="badge-row">${category.system?'<span class="badge secondary">системная</span>':''}</div><strong>${escapeHTML(category.name)}</strong></div><div class="actions"><button class="ghost-button small" type="button" data-finance-category-edit="${escapeHTML(category.id)}">Изм.</button>${category.system?'':`<button class="danger-button small" type="button" data-finance-category-archive="${escapeHTML(category.id)}">Архив</button>`}</div></article>`;
}
async function openFinanceCategoryDialog(categoryId='') {
  const finance=getFinanceStateV2();const current=finance.categories.find(item=>item.id===categoryId)||null;const result=await openEditDialog({title:current?'Изменить категорию':'Новая категория',fields:[{name:'name',label:'Название',value:current?.name||'',placeholder:'Напр. Одежда'}],submitText:'Подтвердить'});if(!result)return;
  applyFinanceMutation(TSBFinanceCore.createOrUpdateCategory(finance,{...(current?{id:current.id}:{}),name:String(result.name||'').trim()},{idFactory:uid}),current?'Категория изменена':'Категория добавлена');
}
async function archiveFinanceCategory(categoryId) {
  const finance=getFinanceStateV2();const category=finance.categories.find(item=>item.id===categoryId);if(!category||category.system)return;const ok=await openConfirmDialog({title:'Архивировать категорию?',message:'Старые операции сохранят её id и останутся в истории.',confirmText:'Архивировать',danger:true});if(!ok)return;applyFinanceMutation(TSBFinanceCore.archiveCategory(finance,categoryId),'Категория архивирована');
}
function renderFinanceCategoriesScreen(root=$('#tab-finance')) {
  if(!root)return;const categories=getFinanceStateV2().categories.filter(item=>item.active&&!item.archived);root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Категории</h2><p class="muted">Категории расходов для быстрого ввода и истории.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section><section class="card"><div class="card-title-row"><h2>Активные категории</h2><button class="primary-button small" type="button" data-finance-category-add>+ Категория</button></div><div class="finance-v2-manage-list">${categories.map(renderFinanceCategoryCard).join('')}</div></section>`;bindFinanceV2Screen(root);
}
function renderFinanceManagementScreen(root=$('#tab-finance')) {
  if(!root)return;root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Управление</h2><p class="muted">Подробные настройки вынесены с главного экрана.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section><section class="card finance-v2-management-list">
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="accounts"><span><strong>Счета и наличные</strong><small>Создать, переименовать, выбрать основной</small></span><b>›</b></button>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="categories"><span><strong>Категории</strong><small>Категории расходов</small></span><b>›</b></button>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="reserves"><span><strong>Резервы</strong><small>Назначенные деньги и цели</small></span><b>›</b></button>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="obligations"><span><strong>Обязательные платежи</strong><small>Будущие оплаты</small></span><b>›</b></button>
    <div class="finance-v2-nav-row disabled" aria-disabled="true"><span><strong>Сверка баланса</strong><small>Будет реализована отдельно, без пустого экрана</small></span></div>
    <button class="finance-v2-nav-row" type="button" data-finance-management-open="sync"><span><strong>Экспорт данных</strong><small>Перейти к существующему экспорту JSON</small></span><b>›</b></button>
  </section>`;bindFinanceV2Screen(root);
}

'''
app=app.replace(anchor,main_helpers+anchor,1)

# Upgrade screen bindings and back-stack behavior.
app=once(app,
"  root.querySelector('[data-finance-reserves-open]')?.addEventListener('click',()=>{state.financeSubscreen='reserves';renderFinance();});\n  root.querySelector('[data-finance-subscreen-back]')?.addEventListener('click',()=>{state.financeSubscreen='';renderFinance();});",
"  root.querySelector('[data-finance-reserves-open]')?.addEventListener('click',()=>openFinanceSubscreen('reserves'));\n  root.querySelector('[data-finance-subscreen-back]')?.addEventListener('click',closeFinanceSubscreen);",
'reserve/back stack bindings')
app=once(app,
"  root.querySelector('[data-finance-obligations-open]')?.addEventListener('click',()=>{state.financeSubscreen='obligations';renderFinance();});",
"  root.querySelector('[data-finance-obligations-open]')?.addEventListener('click',()=>openFinanceSubscreen('obligations'));",
'obligation direct binding')

bind_tail="""  root.querySelectorAll('[data-finance-obligation-cancel]').forEach(button=>button.onclick=()=>cancelFinanceObligation(button.dataset.financeObligationCancel));
}"""
bind_new="""  root.querySelectorAll('[data-finance-obligation-cancel]').forEach(button=>button.onclick=()=>cancelFinanceObligation(button.dataset.financeObligationCancel));
  root.querySelector('[data-finance-v2-expense-add]')?.addEventListener('click',openFinanceV2ExpenseDialog);
  root.querySelector('[data-finance-more]')?.addEventListener('click',()=>openFinanceSubscreen('management'));
  root.querySelector('[data-finance-management-root]')?.addEventListener('click',()=>openFinanceSubscreen('management'));
  root.querySelector('[data-finance-analytics-open]')?.addEventListener('click',()=>{state.financeSubscreen='';state.financeHistoryOpen=true;renderFinance();});
  root.querySelectorAll('[data-finance-management-open]').forEach(button=>button.onclick=()=>{const target=button.dataset.financeManagementOpen;if(target==='sync'){setTab('sync');return;}openFinanceSubscreen(target,'management');});
  root.querySelector('[data-finance-category-add]')?.addEventListener('click',()=>openFinanceCategoryDialog());
  root.querySelectorAll('[data-finance-category-edit]').forEach(button=>button.onclick=()=>openFinanceCategoryDialog(button.dataset.financeCategoryEdit));
  root.querySelectorAll('[data-finance-category-archive]').forEach(button=>button.onclick=()=>archiveFinanceCategory(button.dataset.financeCategoryArchive));
}"""
app=once(app,bind_tail,bind_new,'management bindings')

# Add subscreen dispatchers.
app=once(app,
"  if (state.financeSubscreen === 'obligations') { renderFinanceObligationsScreen(root); return; }\n  const finance = getFinanceStateV2();",
"  if (state.financeSubscreen === 'obligations') { renderFinanceObligationsScreen(root); return; }\n  if (state.financeSubscreen === 'management') { renderFinanceManagementScreen(root); return; }\n  if (state.financeSubscreen === 'accounts') { renderFinanceAccountsScreen(root); return; }\n  if (state.financeSubscreen === 'categories') { renderFinanceCategoriesScreen(root); return; }\n  const finance = getFinanceStateV2();",
'management dispatch')

# Replace final main Finance body with target Part2 structure.
old_body="""  const finance = getFinanceStateV2();
  const accounts = getFinanceAccounts();
  const recent = getFinanceTransactions().slice(0, 8);
  root.innerHTML = `
    ${renderFinanceMoneyNowCard()}

    <section class=\"card finance-v2-accounts-card\">
      <div class=\"card-title-row\"><div><h2>Счета</h2><p class=\"muted\">Обычные траты идут со счёта по умолчанию.</p></div><button class=\"ghost-button small\" type=\"button\" data-finance-v2-account-add>+ Счёт</button></div>
      <div class=\"finance-v2-accounts\">${accounts.map(renderFinanceV2AccountCard).join('') || '<div class=\"empty\">Счетов пока нет.</div>'}</div>
    </section>

    ${renderFinanceObligationsCompact()}

    ${renderFinanceReservesCompact()}

    <section class=\"card finance-v2-recent-card\">
      <div class=\"card-title-row\"><div><h2>Последние операции</h2><p class=\"muted\">Последние расходы, поступления и переводы.</p></div></div>
      <div class=\"finance-list\">${recent.length ? recent.map(transaction => renderFinanceV2TransactionRow(transaction)).join('') : '<div class=\"empty\">Операций пока нет.</div>'}</div>
      <button class=\"ghost-button finance-v2-history-button\" type=\"button\" data-finance-v2-history-open>Вся история</button>
    </section>
  `;"""
new_body="""  const finance = getFinanceStateV2();
  const recent = getFinanceTransactions().slice(0, 8);
  root.innerHTML = `
    ${renderFinanceMoneyNowCard()}
    ${renderFinanceQuickActions()}
    ${renderFinanceMonthCard()}
    ${renderFinanceObligationsCompact()}
    ${renderFinanceReservesCompact()}
    <section class=\"card finance-v2-recent-card\"><div class=\"card-title-row\"><div><h2>Последние операции</h2><p class=\"muted\">Последние расходы, поступления и переводы.</p></div></div><div class=\"finance-list\">${recent.length ? recent.map(transaction => renderFinanceV2TransactionRow(transaction)).join('') : '<div class=\"empty\">Операций пока нет.</div>'}</div><button class=\"ghost-button finance-v2-history-button\" type=\"button\" data-finance-v2-history-open>Вся история</button></section>
    ${renderFinanceManagementLinks()}
  `;"""
app=once(app,old_body,new_body,'final finance main structure')

css_add=r'''

/* Finance v2 Part 2 — final main, month and management */
.finance-v2-quick-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.finance-v2-month-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}
.finance-v2-month-grid>div{display:grid;gap:4px;padding:11px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.025)}
.finance-v2-month-grid span,.finance-v2-month-top span{font-size:.78rem;color:var(--muted)}
.finance-v2-month-grid strong,.finance-v2-month-top strong{font-size:1rem}
.finance-v2-month-grid .difference{grid-column:1/-1;border-color:rgba(139,92,246,.30)}
.finance-v2-month-top{display:grid;gap:7px;margin-top:9px}
.finance-v2-month-top>div{display:flex;justify-content:space-between;gap:10px;padding:7px 2px;border-bottom:1px solid rgba(148,163,184,.10)}
.finance-v2-navigation-card,.finance-v2-management-list{padding:8px!important;display:grid;gap:4px}
.finance-v2-nav-row{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border:0;border-radius:13px;background:transparent;color:inherit;text-align:left;cursor:pointer}
.finance-v2-nav-row:hover,.finance-v2-nav-row:active{background:rgba(139,92,246,.08)}
.finance-v2-nav-row span{display:grid;gap:2px}.finance-v2-nav-row small{color:var(--muted);font-size:.75rem}.finance-v2-nav-row b{font-size:1.35rem;opacity:.5}
.finance-v2-nav-row.disabled{cursor:default;opacity:.48}.finance-v2-nav-row.disabled:hover{background:transparent}
.finance-v2-manage-list{display:grid;gap:8px;margin-top:10px}
.finance-v2-manage-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.025)}
@media(max-width:380px){.finance-v2-quick-actions,.finance-v2-month-grid{grid-template-columns:1fr}.finance-v2-month-grid .difference{grid-column:auto}}
'''
if 'Finance v2 Part 2 — final main, month and management' not in css: css+=css_add

test_add=r'''

// Finance v2 Part 2 main screen order and real management destinations.
assert.ok(app.includes('function renderFinanceQuickActions'),'Finance quick actions block missing');
assert.ok(app.includes('data-finance-v2-expense-add'),'Finance quick expense action missing');
assert.ok(app.includes('function financeCurrentMonthStats'),'current month calculation missing');
assert.ok(app.includes("item.type==='INCOME'"),'month income calculation missing');
assert.ok(app.includes("item.type==='EXPENSE'"),'month expense calculation missing');
assert.ok(app.includes('function renderFinanceManagementScreen'),'management screen missing');
assert.ok(app.includes('function renderFinanceAccountsScreen'),'accounts must be moved to management');
assert.ok(app.includes('function renderFinanceCategoriesScreen'),'category management screen missing');
assert.ok(app.includes('data-finance-analytics-open'),'analytics/history destination missing');
assert.ok(app.includes('Сверка баланса'),'reconciliation status row missing');
'''
if 'Finance quick actions block missing' not in tests: tests+=test_add

APP.write_text(app);CSS.write_text(css);TEST.write_text(tests);print('Finance v2 Part2 stage F applied')
