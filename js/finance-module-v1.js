// TSB Hub v0.9.1 - Finance v1 simplified.
// One finance module: simple money screen, real-data history, and handlers.
(function(){
  const todayISO=()=>toISODate(new Date());
  const money=v=>moneyNumber(v)||0;
  const fmt=v=>formatRub(String(v||0));
  const hasDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
  const safe=s=>escapeHTML(s||'');
  function signedMoneyInput(value){
    const raw=String(value||'').trim().replace(',','.');
    if(!raw)return '';
    const sign=raw.startsWith('-')?'-':'';
    const match=raw.match(/\d+(?:\.\d{0,2})?/);
    if(!match)return '';
    return sign+String(Math.round(Number(match[0])*100)/100);
  }
  function planned(list){return (list||[]).filter(x=>x.status==='planned')}
  function upcoming(list,base=todayISO()){
    return planned(list).filter(x=>!hasDate(x.date)||x.date>=base).sort((a,b)=>String(a.date||'9999-99-99').localeCompare(String(b.date||'9999-99-99')));
  }
  function nearestObligations(ctx,base=todayISO()){
    return upcoming(ctx.obligations,base).filter(x=>hasDate(x.date)).slice(0,5);
  }
  function requiredSoon(ctx){
    return nearestObligations(ctx).reduce((s,x)=>s+money(x.amount),0);
  }
  function financeSnapshot(){
    const ctx=getFinanceContext();
    const available=money(ctx.availableBalance);
    const reserve=money(ctx.reserveBalance);
    const required=requiredSoon(ctx);
    const free=available-required;
    let status='Нормально',tone='good',note='Показываются только понятные суммы: карта, резерв и ближайшие обязательные оплаты.';
    if(!ctx.availableBalance){status='Нет баланса';tone='empty';note='Укажи деньги на карте через “Изменить карту и резерв”.'}
    else if(free<0){status='Не хватает';tone='bad';note=`По ближайшим оплатам не хватает ${fmt(Math.abs(free))}.`}
    else if(required>0){status='Есть обязательные оплаты';tone='warn';note=`После ближайших оплат останется примерно ${fmt(free)}.`}
    return{ctx,available,reserve,required,free,status,tone,note};
  }
  function allExpenseRows(){
    const rows=[];
    Object.entries(app.finance||{}).forEach(([iso,day])=>{
      (day?.expenses||[]).forEach(exp=>rows.push({kind:'expense',iso,date:iso,createdAt:exp.createdAt||'',amount:-money(exp.amount),title:getFinanceCategoryLabel(exp.category),comment:exp.comment||'',source:exp}));
    });
    return rows;
  }
  function incomeRows(ctx){
    return (ctx.incomes||[]).filter(x=>x.status==='received').map(x=>({kind:'income',iso:x.date||todayISO(),date:x.date||todayISO(),createdAt:x.completedAt||x.createdAt||'',amount:money(x.amount),title:x.title||'Поступление',comment:x.comment||'',source:x}));
  }
  function obligationRows(ctx){
    return (ctx.obligations||[]).filter(x=>x.status==='paid').map(x=>({kind:'obligation',iso:x.date||todayISO(),date:x.date||todayISO(),createdAt:x.completedAt||x.createdAt||'',amount:-money(x.amount),title:x.title||'Обязательная оплата',comment:x.comment||'',source:x}));
  }
  function technicalRows(ctx){
    return (ctx.operations||[]).filter(op=>op.type==='adjustment'||!op.sourceId).map(op=>({kind:'technical',iso:op.date||todayISO(),date:op.date||todayISO(),createdAt:op.createdAt||'',amount:money(op.amount),title:op.title||'Техническая запись',comment:op.comment||'',source:op}));
  }
  function financeHistoryRows(){
    const ctx=getFinanceContext();
    return [...allExpenseRows(),...incomeRows(ctx),...obligationRows(ctx)].sort((a,b)=>String(b.createdAt||b.date).localeCompare(String(a.createdAt||a.date))).slice(0,80);
  }
  function upcomingMoneyEvents(ctx){
    const base=todayISO();
    const inc=upcoming(ctx.incomes,base).map(item=>({type:'income',item,date:item.date||'9999-99-99'}));
    const obl=upcoming(ctx.obligations,base).map(item=>({type:'obligation',item,date:item.date||'9999-99-99'}));
    return [...obl,...inc].sort((a,b)=>a.date.localeCompare(b.date)).slice(0,6);
  }
  function moneyStateHTML(s){
    return `<section class="card finance-v1-hero finance-v1-${s.tone}"><div class="finance-v1-status"><span class="badge">${safe(s.status)}</span><span class="muted">Деньги сейчас</span></div><h2>Финансы</h2><p class="muted">${safe(s.note)}</p><div class="finance-v1-grid"><div class="stat-card main"><div class="muted">На карте</div><div class="stat-value">${s.ctx.availableBalance?fmt(s.available):'—'}</div></div><div class="stat-card"><div class="muted">Резерв</div><div class="stat-value small-stat">${s.ctx.reserveBalance?fmt(s.reserve):'—'}</div></div><div class="stat-card"><div class="muted">Свободно на жизнь</div><div class="stat-value small-stat">${s.ctx.availableBalance?fmt(s.free):'—'}</div></div><div class="stat-card"><div class="muted">Обязательное скоро</div><div class="stat-value small-stat">${fmt(s.required)}</div></div></div><button class="ghost-button" type="button" data-finance-balance-open>Изменить карту и резерв</button></section>`;
  }
  function expenseFormHTML(){
    const opts=FINANCE_CATEGORIES.map(c=>`<option value="${safe(c.value)}">${safe(c.label)}</option>`).join('');
    return `<section class="card finance-v1-expense"><div class="card-title-row"><div><h2>Быстрая трата</h2><p class="muted">Только сумма и категория. Запись идёт в сегодняшний день.</p></div></div><form class="finance-v1-form" data-finance-v1-expense><label>Сумма<input name="amount" required inputmode="decimal" placeholder="250"></label><label>Категория<select name="category">${opts}</select></label><button class="primary-button" type="submit">Записать трату</button></form></section>`;
  }
  function todayExpensesHTML(){
    const iso=todayISO();
    const list=[...(getFinance(iso).expenses||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    const body=list.length?list.map(exp=>`<article class="finance-card"><div class="item-top"><div><div class="badge-row"><span class="badge important">${safe(getFinanceCategoryLabel(exp.category))}</span>${exp.time?`<span class="badge">${safe(exp.time)}</span>`:''}</div><h3>${fmt(exp.amount)}</h3>${exp.comment?`<p class="muted">${safe(exp.comment)}</p>`:''}</div><div class="actions"><button class="danger-button" type="button" data-finance-v1-expense-delete="${safe(exp.id)}">Удалить</button></div></div></article>`).join(''):'<div class="empty">Сегодня трат пока нет.</div>';
    return `<section class="card"><div class="card-title-row"><div><h2>Сегодняшние траты</h2><p class="muted">Это реальные записи дня. Удаление возвращает деньги на баланс.</p></div></div><div class="finance-list">${body}</div></section>`;
  }
  function upcomingHTML(ctx){
    const rows=upcomingMoneyEvents(ctx);
    const body=rows.length?rows.map(({type,item})=>`<article class="finance-event ${type}"><div><strong>${type==='income'?'+':'−'} ${safe(item.title|| (type==='income'?'Поступление':'Оплата'))}</strong><div class="muted">${item.date?shortDate(item.date):'без даты'} · ${fmt(item.amount)}</div></div><button class="ghost-button small" type="button" data-finance-v1-plan-done="${safe(item.id)}" data-plan-type="${type}">${type==='income'?'Получено':'Оплачено'}</button></article>`).join(''):'<div class="empty">Ближайших поступлений и оплат нет.</div>';
    return `<section class="card finance-v1-next"><div class="card-title-row"><div><h2>Ближайшее</h2><p class="muted">Поступления и обязательные оплаты одним списком.</p></div></div><div class="finance-events-list">${body}</div></section>`;
  }
  function historyHTML(){
    const rows=financeHistoryRows();
    const body=rows.length?rows.map(row=>`<article class="finance-card"><div class="item-top"><div><div class="badge-row"><span class="badge secondary">${row.kind==='expense'?'трата':row.kind==='income'?'поступление':'оплата'}</span><span class="badge">${shortDate(row.date)}</span></div><h3>${row.amount>0?'+':''}${fmt(row.amount)}</h3><p class="muted">${safe(row.title)}${row.comment?` · ${safe(row.comment)}`:''}</p></div><div class="actions">${row.kind==='expense'?`<button class="danger-button" type="button" data-finance-v1-expense-delete="${safe(row.source.id)}" data-date="${safe(row.iso)}">Удалить</button>`:''}${row.kind==='income'||row.kind==='obligation'?`<button class="ghost-button" type="button" data-finance-v1-plan-revert="${safe(row.source.id)}" data-plan-type="${row.kind==='income'?'income':'obligation'}">Откатить</button>`:''}</div></div></article>`).join(''):'<div class="empty">История пока пустая.</div>';
    return `<details class="card collapsible-list finance-v1-history"><summary>История · ${rows.length}</summary><p class="muted">История строится из реальных трат, полученных поступлений и оплаченных обязательств.</p><div class="finance-list">${body}</div></details>`;
  }
  function technicalHTML(ctx){
    const rows=technicalRows(ctx).slice(0,40);
    if(!rows.length)return '';
    const body=rows.map(row=>`<article class="finance-card"><div class="item-top"><div><div class="badge-row"><span class="badge secondary">техническая</span><span class="badge">${shortDate(row.date)}</span></div><h3>${row.amount>0?'+':''}${fmt(row.amount)}</h3><p class="muted">${safe(row.title)}${row.comment?` · ${safe(row.comment)}`:''}</p></div></div></article>`).join('');
    return `<details class="collapsible-list"><summary>Технические записи · ${rows.length}</summary><div class="finance-list">${body}</div></details>`;
  }
  function managementHTML(ctx){
    return `<details class="card collapsible-list finance-v1-manage"><summary>Управление</summary><details class="collapsible-list"><summary>Добавить поступление / оплату</summary>${renderFinancePlanForm('income')}${renderFinancePlanForm('obligation')}</details>${historyHTML()}${technicalHTML(ctx)}</details>`;
  }
  function renderFinanceV1(){
    const root=$('#tab-finance');
    if(!root)return;
    const snap=financeSnapshot();
    root.innerHTML=`${moneyStateHTML(snap)}${expenseFormHTML()}${todayExpensesHTML()}${upcomingHTML(snap.ctx)}${managementHTML(snap.ctx)}`;
    bindCommonActions(root);
    bindFinanceV1(root);
  }
  async function openBalanceDialog(){
    const ctx=getFinanceContext();
    const result=await openEditDialog({title:'Карта и резерв',fields:[{name:'availableBalance',label:'На карте',value:ctx.availableBalance||'',placeholder:'Напр. 12500'},{name:'reserveBalance',label:'Резерв',value:ctx.reserveBalance||'',placeholder:'Не трогать каждый день'}],submitText:'Сохранить'});
    if(!result)return;
    ctx.availableBalance=signedMoneyInput(result.availableBalance);
    ctx.reserveBalance=normalizeMoneyInput(result.reserveBalance);
    markChanged();
    showToast('Карта и резерв сохранены');
  }
  function bindFinanceV1(root){
    $$('[data-finance-balance-open]',root).forEach(btn=>btn.onclick=openBalanceDialog);
    $$('[data-finance-v1-expense]',root).forEach(form=>form.onsubmit=e=>{
      e.preventDefault();
      const fd=new FormData(form),amount=normalizeMoneyInput(fd.get('amount'));
      if(!amount)return;
      const now=new Date();
      const iso=todayISO();
      const exp={id:uid('exp'),amount,category:normalizeFinanceCategory(fd.get('category')),reason:'',comment:'',time:`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`,createdAt:now.toISOString()};
      const day=getFinance(iso);day.noExpenses=false;day.expenses.push(exp);
      addAvailableBalance(-money(amount));
      markChanged();showToast('Трата добавлена');
    });
    $$('[data-finance-v1-expense-delete]',root).forEach(btn=>btn.onclick=async()=>{
      const id=btn.dataset.financeV1ExpenseDelete,date=btn.dataset.date||todayISO();
      const day=getFinance(date);const exp=day.expenses.find(x=>x.id===id);
      if(!exp)return;
      if(!await openConfirmDialog('Удалить трату? Деньги вернутся на баланс.'))return;
      addAvailableBalance(money(exp.amount));
      day.expenses=day.expenses.filter(x=>x.id!==id);
      markChanged();showToast('Трата удалена');
    });
    $$('[data-finance-v1-plan-done]',root).forEach(btn=>btn.onclick=()=>{
      const ctx=getFinanceContext(),type=btn.dataset.planType,key=type==='income'?'incomes':'obligations';
      const item=ctx[key].find(x=>x.id===btn.dataset.financeV1PlanDone);
      if(!item||item.status!=='planned')return;
      const amount=money(item.amount);item.status=type==='income'?'received':'paid';item.completedAt=new Date().toISOString();
      addAvailableBalance(type==='income'?amount:-amount);
      markChanged();showToast(type==='income'?'Поступление получено':'Оплата выполнена');
    });
    $$('[data-finance-v1-plan-revert]',root).forEach(btn=>btn.onclick=async()=>{
      const ctx=getFinanceContext(),type=btn.dataset.planType,key=type==='income'?'incomes':'obligations';
      const item=ctx[key].find(x=>x.id===btn.dataset.financeV1PlanRevert);
      if(!item)return;
      if(!await openConfirmDialog(type==='income'?'Откатить поступление?':'Откатить оплату?'))return;
      const amount=money(item.amount);addAvailableBalance(type==='income'?-amount:amount);
      item.status='planned';item.completedAt='';
      markChanged();showToast('Операция отменена');
    });
  }
  window.renderFinance=renderFinanceV1;
  renderFinance=renderFinanceV1;
  document.addEventListener('DOMContentLoaded',()=>{if(state.activeTab==='finance'||document.body?.dataset.activeTab==='finance')renderFinanceV1()});
})();
