from pathlib import Path
APP=Path('js/app.js'); CSS=Path('css/mobile-finance.css'); TEST=Path('tests/app-static.test.cjs')
app=APP.read_text(); css=CSS.read_text(); tests=TEST.read_text()

def once(s,old,new,label):
    if old not in s: raise RuntimeError(f'missing anchor: {label}')
    if s.count(old)!=1: raise RuntimeError(f'non-unique anchor: {label} ({s.count(old)})')
    return s.replace(old,new,1)

# Extend readable mutation errors.
app=once(app,
"    NO_LEGACY_RESERVE_TO_IMPORT: 'Старый резерв уже обработан или отсутствует'",
"    NO_LEGACY_RESERVE_TO_IMPORT: 'Старый резерв уже обработан или отсутствует',\n    INVALID_DUE_DATE: 'Укажи корректную дату платежа',\n    INVALID_RECURRENCE: 'Некорректный тип повтора',\n    OBLIGATION_NOT_ACTIVE: 'Этот платёж уже закрыт или отменён',\n    OBLIGATION_NOT_FOUND: 'Обязательный платёж не найден',\n    EXPENSE_NOT_FOUND: 'Подходящая трата не найдена',\n    TRANSACTION_ALREADY_LINKED: 'Эта трата уже связана с другим платежом',\n    ACCOUNT_NOT_FOUND: 'Счёт не найден'",
'obligation error mapping')

# Better deletion notice if a linked obligation was restored.
app=once(app,
"  applyFinanceMutation(TSBFinanceCore.deleteTransaction(getFinanceStateV2(), id), 'Операция удалена');",
"  const mutation = TSBFinanceCore.deleteTransaction(getFinanceStateV2(), id);\n  applyFinanceMutation(mutation, mutation?.reactivatedObligationIds?.length ? 'Операция удалена · платёж снова активен' : 'Операция удалена');",
'linked delete toast')

anchor="function bindFinanceV2Screen(root) {"
if anchor not in app: raise RuntimeError('bind screen anchor missing')
obligation_ui=r'''function getFinanceActiveObligations() {
  return TSBFinanceCore.getActiveObligations(getFinanceStateV2());
}
function getFinanceUpcomingObligations() {
  return TSBFinanceCore.getUpcomingObligations(getFinanceStateV2(),{fromDate:toISODate(new Date())});
}
function getFinanceUpcomingTotal() {
  return TSBFinanceCore.getUpcomingObligationsTotal(getFinanceStateV2(),{fromDate:toISODate(new Date())});
}
function financeObligationDueText(obligation) {
  const today=toISODate(new Date());
  if(obligation.dueDate<today)return `Просрочено · ${shortDate(obligation.dueDate)}`;
  if(obligation.dueDate===today)return 'Сегодня';
  return shortDate(obligation.dueDate);
}
function financeObligationPaidTransaction(obligation) {
  return obligation.linkedTransactionId ? getFinanceTransaction(obligation.linkedTransactionId) : null;
}
function renderFinanceObligationCard(obligation,{compact=false}={}) {
  const paidTx=financeObligationPaidTransaction(obligation);
  const statusLabel=obligation.status==='PAID'?'Оплачено':obligation.status==='CANCELLED'?'Отменено':financeObligationDueText(obligation);
  const statusClass=obligation.status==='PAID'?'done-badge':obligation.status==='CANCELLED'?'muted-badge':(obligation.dueDate<toISODate(new Date())?'overdue':'secondary');
  const paidLine=paidTx?`<p class="muted">Фактически: ${formatRub(paidTx.amount)}${paidTx.amount!==obligation.amount?` · план ${formatRub(obligation.amount)}`:''}</p>`:'';
  return `<article class="finance-v2-obligation-card ${obligation.status.toLowerCase()}">
    <div class="item-top"><div><div class="badge-row"><span class="badge ${statusClass}">${escapeHTML(statusLabel)}</span>${obligation.recurrence==='MONTHLY'?'<span class="badge">ежемесячно</span>':''}</div><h3>${escapeHTML(obligation.name)}</h3><div class="finance-v2-obligation-amount">${formatRub(obligation.amount)}</div>${obligation.note?`<p class="muted">${escapeHTML(obligation.note)}</p>`:''}${paidLine}</div></div>
    ${compact||obligation.status!=='ACTIVE'?'':`<div class="finance-v2-obligation-actions"><button class="primary-button small" type="button" data-finance-obligation-pay="${escapeHTML(obligation.id)}">Оплатить сейчас</button><button class="ghost-button small" type="button" data-finance-obligation-link="${escapeHTML(obligation.id)}">Связать с тратой</button><button class="ghost-button small" type="button" data-finance-obligation-edit="${escapeHTML(obligation.id)}">Изм.</button><button class="danger-button small" type="button" data-finance-obligation-cancel="${escapeHTML(obligation.id)}">Отменить</button></div>`}
  </article>`;
}
function renderFinanceObligationsCompact() {
  const upcoming=getFinanceUpcomingObligations(); const preview=upcoming.slice(0,3);
  return `<section class="card finance-v2-obligations-card"><div class="card-title-row"><div><h2>Ближайшие платежи</h2><p class="muted">ACTIVE обязательства на ближайшие ${TSBFinanceCore.UPCOMING_OBLIGATION_DAYS} дней.</p></div><span class="badge important">${formatRub(getFinanceUpcomingTotal())}</span></div>
    <div class="finance-v2-obligation-list">${preview.length?preview.map(item=>renderFinanceObligationCard(item,{compact:true})).join(''):'<div class="empty">Ближайших обязательных платежей нет.</div>'}</div>
    <div class="finance-v2-section-actions"><button class="ghost-button" type="button" data-finance-obligations-open>Все платежи</button><button class="primary-button" type="button" data-finance-obligation-create>+ Добавить</button></div>
  </section>`;
}
async function openFinanceObligationDialog(obligationId='') {
  const finance=getFinanceStateV2();const current=finance.obligations.find(item=>item.id===obligationId)||null;
  if(current&&current.status!=='ACTIVE')return;
  const result=await openEditDialog({title:current?'Изменить платёж':'Добавить обязательный платёж',fields:[
    {name:'name',label:'Название',value:current?.name||'',placeholder:'Интернет, коммунальные'},
    {name:'amount',label:'Сумма',value:current?.amount||'',placeholder:'Напр. 850'},
    {name:'dueDate',label:'Дата',type:'date',value:current?.dueDate||toISODate(new Date())},
    {name:'recurrence',label:'Повтор',type:'select',value:current?.recurrence||'NONE',options:[{value:'NONE',label:'Нет'},{value:'MONTHLY',label:'Ежемесячно'}]},
    {name:'note',label:'Описание — необязательно',type:'textarea',value:current?.note||'',placeholder:'Комментарий'}
  ],submitText:'Подтвердить'});
  if(!result)return;
  const draft={name:String(result.name||'').trim(),amount:normalizeMoneyInput(result.amount),dueDate:normalizeDateInput(result.dueDate),recurrence:result.recurrence,note:String(result.note||'').trim()};
  const mutation=current?TSBFinanceCore.updateObligation(finance,current.id,draft,{fromDate:toISODate(new Date())}):TSBFinanceCore.createObligation(finance,draft,{idFactory:uid,fromDate:toISODate(new Date())});
  applyFinanceMutation(mutation,current?'Платёж изменён':'Платёж добавлен');
}
async function payFinanceObligation(obligationId) {
  const finance=getFinanceStateV2();const obligation=finance.obligations.find(item=>item.id===obligationId);const account=getDefaultFinanceAccount();if(!obligation||!account)return;
  const now=new Date();const today=toISODate(now);const hm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const result=await openEditDialog({title:`Оплатить · ${obligation.name}`,fields:[
    {name:'amount',label:'Сумма',value:obligation.amount},
    {name:'accountId',label:'Счёт',type:'select',value:account.id,options:financeAccountOptions(account.id)},
    {name:'categoryId',label:'Категория',type:'select',value:'other',options:financeCategoryOptions('other')},
    {name:'date',label:'Дата',type:'date',value:today},
    {name:'time',label:'Время',type:'time',value:hm},
    {name:'description',label:'Описание',type:'textarea',value:obligation.name,placeholder:'Необязательно'}
  ],submitText:'Оплатить'});
  if(!result)return;
  const mutation=TSBFinanceCore.payObligation(finance,obligationId,{accountId:result.accountId,categoryId:result.categoryId,amount:normalizeMoneyInput(result.amount),date:normalizeDateInput(result.date)||today,time:result.time,description:result.description,now:new Date().toISOString(),idFactory:uid});
  applyFinanceMutation(mutation,mutation?.nextObligation?'Оплачено · следующий платёж создан':'Платёж оплачен');
}
function financeLinkableExpenses(obligationId) {
  const finance=getFinanceStateV2();const used=new Set(finance.obligations.filter(item=>item.id!==obligationId&&item.linkedTransactionId).map(item=>item.linkedTransactionId));
  return getFinanceTransactions({type:'EXPENSE'}).filter(item=>!used.has(item.id)).slice(0,20);
}
async function linkFinanceObligation(obligationId) {
  const obligation=getFinanceStateV2().obligations.find(item=>item.id===obligationId);if(!obligation)return;
  const expenses=financeLinkableExpenses(obligationId);if(!expenses.length){showToast('Недавних расходов для связывания нет');return;}
  const result=await openEditDialog({title:`Связать · ${obligation.name}`,fields:[{name:'transactionId',label:'Существующая трата',type:'select',value:expenses[0].id,options:expenses.map(item=>({value:item.id,label:`${shortDate(item.date)} · ${formatRub(item.amount)} · ${financeTypeLabel(item)}${item.description?` · ${item.description}`:''}`}))}],submitText:'Связать'});
  if(!result)return;
  const mutation=TSBFinanceCore.linkObligationToTransaction(getFinanceStateV2(),obligationId,result.transactionId,{now:new Date().toISOString(),idFactory:uid});
  applyFinanceMutation(mutation,mutation?.nextObligation?'Связано · следующий платёж создан':'Платёж связан с тратой');
}
async function cancelFinanceObligation(obligationId) {
  const obligation=getFinanceStateV2().obligations.find(item=>item.id===obligationId);if(!obligation)return;
  const ok=await openConfirmDialog({title:'Отменить обязательный платёж?',message:`${obligation.name} больше не будет учитываться как будущая оплата.`,confirmText:'Отменить платёж',danger:true});if(!ok)return;
  applyFinanceMutation(TSBFinanceCore.cancelObligation(getFinanceStateV2(),obligationId),'Платёж отменён');
}
function renderFinanceObligationsScreen(root=$('#tab-finance')) {
  if(!root)return;const finance=getFinanceStateV2();const active=TSBFinanceCore.getActiveObligations(finance).sort((a,b)=>a.dueDate.localeCompare(b.dueDate));const closed=finance.obligations.filter(item=>item.status!=='ACTIVE').sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,10);
  root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Обязательные платежи</h2><p class="muted">План не меняет баланс. Деньги списываются только реальной EXPENSE.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    <section class="card"><div class="card-title-row"><div><h2>Активные</h2><p class="muted">Ближайшие и просроченные платежи.</p></div><button class="primary-button small" type="button" data-finance-obligation-create>+ Добавить</button></div><div class="finance-v2-obligation-list full">${active.length?active.map(item=>renderFinanceObligationCard(item)).join(''):'<div class="empty">Активных обязательных платежей нет.</div>'}</div></section>
    ${closed.length?`<details class="card finance-v2-closed-obligations"><summary>Недавно закрытые · ${closed.length}</summary><div class="finance-v2-obligation-list">${closed.map(item=>renderFinanceObligationCard(item)).join('')}</div></details>`:''}`;
  bindFinanceV2Screen(root);
}

'''
app=app.replace(anchor,obligation_ui+anchor,1)

bind_old="""  root.querySelector('[data-finance-legacy-reserve-import]')?.addEventListener('click',importLegacyFinanceReserve);
}"""
bind_new="""  root.querySelector('[data-finance-legacy-reserve-import]')?.addEventListener('click',importLegacyFinanceReserve);
  root.querySelector('[data-finance-obligations-open]')?.addEventListener('click',()=>{state.financeSubscreen='obligations';renderFinance();});
  root.querySelectorAll('[data-finance-obligation-create]').forEach(button=>button.onclick=()=>openFinanceObligationDialog());
  root.querySelectorAll('[data-finance-obligation-edit]').forEach(button=>button.onclick=()=>openFinanceObligationDialog(button.dataset.financeObligationEdit));
  root.querySelectorAll('[data-finance-obligation-pay]').forEach(button=>button.onclick=()=>payFinanceObligation(button.dataset.financeObligationPay));
  root.querySelectorAll('[data-finance-obligation-link]').forEach(button=>button.onclick=()=>linkFinanceObligation(button.dataset.financeObligationLink));
  root.querySelectorAll('[data-finance-obligation-cancel]').forEach(button=>button.onclick=()=>cancelFinanceObligation(button.dataset.financeObligationCancel));
}"""
app=once(app,bind_old,bind_new,'obligation bindings')

app=once(app,
"  if (state.financeSubscreen === 'reserves') { renderFinanceReservesScreen(root); return; }\n  const finance = getFinanceStateV2();",
"  if (state.financeSubscreen === 'reserves') { renderFinanceReservesScreen(root); return; }\n  if (state.financeSubscreen === 'obligations') { renderFinanceObligationsScreen(root); return; }\n  const finance = getFinanceStateV2();",
'obligation dispatch')

reserve_anchor="""    ${renderFinanceReservesCompact()}"""
if reserve_anchor not in app: raise RuntimeError('reserve compact anchor missing')
app=app.replace(reserve_anchor,"""    ${renderFinanceObligationsCompact()}\n\n    ${renderFinanceReservesCompact()}""",1)

css_add=r'''

/* Finance v2 Part 2 — obligations */
.finance-v2-obligations-card,.finance-v2-closed-obligations{overflow:hidden}
.finance-v2-obligation-list{display:grid;gap:9px;margin-top:10px}
.finance-v2-obligation-list.full{gap:12px}
.finance-v2-obligation-card{display:grid;gap:10px;padding:13px;border:1px solid var(--border);border-radius:16px;background:rgba(255,255,255,.025)}
.finance-v2-obligation-card h3{margin:4px 0}
.finance-v2-obligation-amount{font-size:1.05rem;font-weight:900}
.finance-v2-obligation-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.finance-v2-obligation-card.paid{opacity:.78}
.finance-v2-obligation-card.cancelled{opacity:.58}
.finance-v2-closed-obligations>summary{min-height:44px;font-weight:850;cursor:pointer}
@media(min-width:720px){.finance-v2-obligation-actions{grid-template-columns:repeat(4,minmax(0,1fr))}}
'''
if 'Finance v2 Part 2 — obligations' not in css: css+=css_add

test_add=r'''

// Finance v2 Part 2 obligation UI must preserve the one-transaction payment model.
assert.ok(app.includes('function renderFinanceObligationsScreen'),'obligation management screen missing');
assert.ok(app.includes('data-finance-obligation-pay'),'obligation payment action missing');
assert.ok(app.includes('TSBFinanceCore.payObligation'),'payment UI must use core payObligation');
assert.ok(app.includes('TSBFinanceCore.linkObligationToTransaction'),'link UI must use core linking');
assert.ok(app.includes('data-finance-obligation-link'),'existing-expense link action missing');
assert.ok(app.includes('reactivatedObligationIds'),'transaction deletion UI must surface obligation reactivation');
'''
if 'obligation management screen missing' not in tests: tests+=test_add

APP.write_text(app);CSS.write_text(css);TEST.write_text(tests);print('Finance v2 Part2 stage D applied')
