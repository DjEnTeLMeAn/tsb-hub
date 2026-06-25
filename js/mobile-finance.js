// TSB Hub 0.8.29 - finance mini tracker cleanup.
(function(){
  const DAY=86400000;
  const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
  const money=v=>moneyNumber(v)||0;
  const planned=x=>x.status==='planned';
  const today=()=>toISODate(new Date());
  function plusDays(iso,n){const d=new Date(`${iso}T00:00:00`);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
  function diffDays(a,b){return Math.max(0,Math.round((new Date(`${b}T00:00:00`)-new Date(`${a}T00:00:00`))/DAY))}
  function nowTime(){const d=new Date();return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
  function futureItems(list,base=today()){return list.filter(planned).filter(x=>!validDate(x.date)||x.date>=base).sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999')))}
  function nextIncome(ctx,base=today()){return futureItems(ctx.incomes,base).find(x=>validDate(x.date))||null}
  function horizonDate(ctx,base=today()){return nextIncome(ctx,base)?.date||plusDays(base,7)}
  function obligationsUntil(ctx,end,base=today()){return futureItems(ctx.obligations,base).filter(x=>!validDate(x.date)||x.date<=end)}
  function calcFinance(ctx,summary,base=today()){
    const available=money(ctx.availableBalance),reserve=money(ctx.reserveBalance),end=horizonDate(ctx,base);
    const obligations=obligationsUntil(ctx,end,base),required=obligations.reduce((s,x)=>s+money(x.amount),0);
    const free=available-required,days=Math.max(1,diffDays(base,end)+1),dayLimit=Math.floor(free/days),leftToday=dayLimit-money(summary.total);
    let status='Нормально',tone='ok',note=`До ${shortDate(end)} можно примерно ${formatRub(String(Math.max(0,dayLimit)))} в день.`;
    if(!ctx.availableBalance){status='Нет баланса';tone='empty';note='Укажи деньги на карте, чтобы расчёт стал полезным.'}
    else if(free<0){status='Не хватает';tone='danger';note=`До ${shortDate(end)} не хватает ${formatRub(String(Math.abs(free)))}.`}
    else if(dayLimit<500){status='Жёстко экономить';tone='danger';note=`Лимит очень низкий до ${shortDate(end)}.`}
    else if(dayLimit<1000){status='Осторожно';tone='warn';note=`Лучше держать траты около ${formatRub(String(dayLimit)))} в день.`}
    return{available,reserve,end,required,free,days,dayLimit,leftToday,status,tone,note,obligations};
  }
  function miniExpenseForm(){
    const opts=FINANCE_CATEGORIES.map(c=>`<option value="${escapeHTML(c.value)}">${escapeHTML(c.label)}</option>`).join('');
    return `<form class="finance-mini-form" data-mini-finance-form><label>Сумма<input name="amount" required inputmode="decimal" placeholder="250"></label><label>Категория<select name="category">${opts}</select></label><button class="primary-button" type="submit">Записать трату</button></form>`;
  }
  function expenseList(iso){
    const day=getFinance(iso),items=[...day.expenses].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    if(!items.length)return day.noExpenses?'<div class="empty">Сегодня отмечено без трат.</div>':'<div class="empty">Сегодня трат пока нет.</div>';
    return items.slice(0,6).map(x=>`<article class="finance-card"><div class="item-top"><div><div class="badge-row"><span class="badge important">${escapeHTML(getFinanceCategoryLabel(x.category))}</span>${x.time?`<span class="badge">${escapeHTML(x.time)}</span>`:''}</div><h3>${formatRub(x.amount)}</h3>${x.comment?`<p class="muted">${escapeHTML(x.comment)}</p>`:''}</div><div class="actions"><button class="danger-button" data-mini-expense-delete="${x.id}">Удал.</button></div></div></article>`).join('')+(items.length>6?'<div class="muted finance-summary-line">Показаны последние 6 трат.</div>':'');
  }
  function eventCard(entry){
    const item=entry.item,type=entry.type;
    const title=escapeHTML(item.title||(type==='income'?'Поступление':'Оплата'));
    return `<article class="finance-event ${type}"><div><strong>${type==='income'?'+':'−'} ${title}</strong><div class="muted">${item.date?shortDate(item.date):'без даты'} · ${formatRub(item.amount)}</div></div><button class="ghost-button small" data-finance-plan-complete="${item.id}" data-plan-type="${type}">${type==='income'?'Получено':'Оплачено'}</button></article>`
  }
  function eventsList(ctx){
    const base=today();
    const rows=[...futureItems(ctx.obligations,base).map(item=>({type:'obligation',item})),...futureItems(ctx.incomes,base).map(item=>({type:'income',item}))]
      .sort((a,b)=>String(a.item.date||'9999').localeCompare(String(b.item.date||'9999'))).slice(0,5);
    return rows.length?rows.map(eventCard).join(''):'<div class="empty">Ближайших поступлений и оплат нет.</div>';
  }
  function visibleHistory(ctx){
    const ops=ctx.operations.filter(op=>op.type!=='adjustment').slice(0,40);
    if(!ops.length)return '<div class="empty">Обычная история пока пустая.</div>';
    const label={expense:'трата',income:'поступление',obligation:'обязательная оплата'};
    return ops.map(op=>`<article class="finance-card operation-card"><div class="item-top"><div><div class="badge-row"><span class="badge secondary">${label[op.type]||'операция'}</span><span class="badge">${shortDate(op.date)}</span></div><h3>${money(op.amount)>0?'+':''}${formatRub(op.amount)}</h3><p class="muted">${escapeHTML(op.title||'Операция')}${op.comment?` · ${escapeHTML(op.comment)}`:''}</p></div></div></article>`).join('');
  }
  function technicalJournal(ctx){
    const ops=ctx.operations.filter(op=>op.type==='adjustment').slice(0,40);
    if(!ops.length)return '<div class="empty">Технических корректировок нет.</div>';
    return ops.map(op=>`<article class="finance-card operation-card technical"><div class="item-top"><div><div class="badge-row"><span class="badge secondary">корректировка</span><span class="badge">${shortDate(op.date)}</span></div><h3>${money(op.amount)>0?'+':''}${formatRub(op.amount)}</h3><p class="muted">${escapeHTML(op.title||'Корректировка')}${op.comment?` · ${escapeHTML(op.comment)}`:''}</p></div><div class="actions"><button class="ghost-button" data-adjust-forget="${op.id}">Убрать</button><button class="danger-button" data-adjust-rollback="${op.id}">Откатить</button></div></div></article>`).join('');
  }
  function moreBlock(ctx){return `<details class="card collapsible-list finance-more"><summary>Ещё: баланс, история, цели</summary><section class="mini-inner"><h3>Баланс и резерв</h3><form class="form-grid finance-context" data-mini-balance-form><label>На карте<input name="availableBalance" inputmode="decimal" placeholder="Напр. 12500" value="${escapeHTML(ctx.availableBalance||'')}"></label><label>Резерв / авто<input name="reserveBalance" inputmode="decimal" placeholder="Напр. 5000" value="${escapeHTML(ctx.reserveBalance||'')}"></label><button class="primary-button" type="submit">Сохранить баланс</button></form></section><details class="collapsible-list finance-add-details" data-details-key="finance-add-income"><summary>Добавить поступление</summary>${renderFinancePlanForm('income')}</details><details class="collapsible-list finance-add-details" data-details-key="finance-add-obligation"><summary>Добавить обязательную оплату</summary>${renderFinancePlanForm('obligation')}</details><details class="collapsible-list" data-details-key="finance-history"><summary>Обычная история · ${ctx.operations.filter(op=>op.type!=='adjustment').length}</summary><div class="finance-list">${visibleHistory(ctx)}</div></details><details class="collapsible-list" data-details-key="finance-tech"><summary>Технический журнал · ${ctx.operations.filter(op=>op.type==='adjustment').length}</summary><p class="muted">Убрать — только скрыть запись. Откатить — изменить баланс обратно.</p><div class="finance-list">${technicalJournal(ctx)}</div></details><details class="collapsible-list" data-details-key="finance-goals"><summary>Финансовые цели</summary>${renderFinanceGoalsForm(ctx)}</details></details>`}
  function renderMiniFinance(){
    const root=$('#tab-finance');if(!root)return;
    const base=today(),summary=getFinanceSummary(base),ctx=getFinanceContext(),calc=calcFinance(ctx,summary,base);
    root.innerHTML=`<section class="card finance-mini-hero finance-state-${calc.tone}"><div class="finance-status-row"><span class="finance-status-pill">${calc.status}</span><span class="muted">расчёт от ${shortDate(base)} до ${shortDate(calc.end)}</span></div><h2>Финансы</h2><p class="muted">${calc.note}</p><div class="finance-life-grid main-grid"><div class="finance-life-stat main"><span class="muted">Лимит на день</span><b>${ctx.availableBalance?formatRub(String(Math.max(0,calc.dayLimit))):'—'}</b></div><div class="finance-life-stat"><span class="muted">Осталось сегодня</span><b>${ctx.availableBalance?formatRub(String(calc.leftToday)):'—'}</b></div><div class="finance-life-stat"><span class="muted">На карте</span><b>${ctx.availableBalance?formatRub(ctx.availableBalance):'—'}</b></div><div class="finance-life-stat"><span class="muted">Свободно на жизнь</span><b>${ctx.availableBalance?formatRub(String(calc.free)):'—'}</b></div><div class="finance-life-stat"><span class="muted">Резерв / авто</span><b>${ctx.reserveBalance?formatRub(ctx.reserveBalance):'—'}</b></div><div class="finance-life-stat"><span class="muted">Обязательное скоро</span><b>${formatRub(String(calc.required))}</b></div></div></section><section class="card finance-mini-expense"><div class="card-title-row"><div><h2>Быстрая трата</h2><p class="muted">Запись всегда идёт в сегодняшний день.</p></div></div>${miniExpenseForm()}<button class="ghost-button finance-no-expenses ${getFinance(base).noExpenses?'active':''}" type="button" data-mini-no-expenses>${getFinance(base).noExpenses?'✓ Сегодня не было трат':'Сегодня не было трат'}</button><details class="collapsible-list" data-details-key="finance-today-expenses" open><summary>Сегодняшние траты · ${summary.count}</summary><div class="finance-list">${expenseList(base)}</div></details></section><section class="card finance-mini-next"><div class="card-title-row"><div><h2>Ближайшее</h2><p class="muted">Единый список оплат и поступлений по датам.</p></div></div><div class="finance-events-list">${eventsList(ctx)}</div></section>${moreBlock(ctx)}`;
    bindCommonActions(root);
    bindMiniFinance(root,base);
  }
  function bindMiniFinance(root,base){
    const qsa=(s)=>Array.from(root.querySelectorAll(s));
    qsa('[data-mini-finance-form]').forEach(form=>form.onsubmit=e=>{e.preventDefault();const fd=new FormData(form),amount=normalizeMoneyInput(fd.get('amount'));if(!amount)return;const expense={id:uid('exp'),amount,category:normalizeFinanceCategory(fd.get('category')),reason:'',comment:'',time:nowTime(),createdAt:new Date().toISOString()};const day=getFinance(base);day.noExpenses=false;day.expenses.push(expense);addAvailableBalance(-money(amount));addFinanceOperation('expense',-money(amount),getFinanceCategoryLabel(expense.category),'',expense.id,base);markChanged();showToast('Трата добавлена')});
    qsa('[data-mini-no-expenses]').forEach(btn=>btn.onclick=()=>{const day=getFinance(base);if(day.expenses.length)return;day.noExpenses=!day.noExpenses;markChanged();showToast(day.noExpenses?'День отмечен без трат':'Отметка без трат снята')});
    qsa('[data-mini-expense-delete]').forEach(btn=>btn.onclick=async()=>{if(!await openConfirmDialog('Удалить трату?'))return;const day=getFinance(base),exp=day.expenses.find(x=>x.id===btn.dataset.miniExpenseDelete);if(exp)addAvailableBalance(money(exp.amount));day.expenses=day.expenses.filter(x=>x.id!==btn.dataset.miniExpenseDelete);getFinanceContext().operations=getFinanceContext().operations.filter(op=>op.sourceId!==btn.dataset.miniExpenseDelete);markChanged();showToast('Трата удалена')});
    qsa('[data-mini-balance-form]').forEach(form=>form.onsubmit=e=>{e.preventDefault();const fd=new FormData(form),ctx=getFinanceContext();ctx.availableBalance=normalizeSignedMoneyInput(fd.get('availableBalance'));ctx.reserveBalance=normalizeMoneyInput(fd.get('reserveBalance'));markChanged();showToast('Баланс сохранён без корректировки в истории')});
    qsa('[data-adjust-forget]').forEach(btn=>btn.onclick=()=>{const ctx=getFinanceContext();ctx.operations=ctx.operations.filter(op=>op.id!==btn.dataset.adjustForget);markChanged();showToast('Корректировка убрана из журнала')});
    qsa('[data-adjust-rollback]').forEach(btn=>btn.onclick=async()=>{const ctx=getFinanceContext(),op=ctx.operations.find(x=>x.id===btn.dataset.adjustRollback);if(!op)return;if(!await openConfirmDialog({title:'Откатить корректировку?',message:'Баланс изменится обратно на сумму этой корректировки.',confirmText:'Откатить',danger:true}))return;addAvailableBalance(-money(op.amount));ctx.operations=ctx.operations.filter(x=>x.id!==op.id);markChanged();showToast('Корректировка откачена')});
  }
  function install(){try{renderFinance=renderMiniFinance}catch(e){window.renderFinance=renderMiniFinance}if(document.body?.dataset.activeTab==='finance')renderMiniFinance()}
  document.addEventListener('DOMContentLoaded',install);window.addEventListener('load',install);
})();
