// TSB Hub 0.8.28 - final finance mini-tracker screen.
(function(){
  const DAY=86400000;
  const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''));
  const money=v=>moneyNumber(v)||0;
  const planned=x=>x.status==='planned';
  function plusDays(iso,n){const d=new Date(`${iso}T00:00:00`);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10)}
  function diffDays(a,b){return Math.max(0,Math.round((new Date(`${b}T00:00:00`)-new Date(`${a}T00:00:00`))/DAY))}
  function futureItems(list){const from=state.selectedDate;return list.filter(planned).filter(x=>!validDate(x.date)||x.date>=from).sort((a,b)=>String(a.date||'9999').localeCompare(String(b.date||'9999')))}
  function nextIncome(ctx){return futureItems(ctx.incomes).find(x=>validDate(x.date))||null}
  function horizonDate(ctx){return nextIncome(ctx)?.date||plusDays(state.selectedDate,7)}
  function obligationsUntil(ctx,end){return futureItems(ctx.obligations).filter(x=>!validDate(x.date)||x.date<=end)}
  function calcFinance(ctx,summary){
    const available=money(ctx.availableBalance);
    const reserve=money(ctx.reserveBalance);
    const end=horizonDate(ctx);
    const obligations=obligationsUntil(ctx,end);
    const required=obligations.reduce((s,x)=>s+money(x.amount),0);
    const free=available-required;
    const days=Math.max(1,diffDays(state.selectedDate,end)+1);
    const dayLimit=Math.floor(free/days);
    const leftToday=dayLimit-money(summary.total);
    let status='Нормально',tone='ok',note=`До ${shortDate(end)} можно примерно ${formatRub(String(Math.max(0,dayLimit)))} в день.`;
    if(!ctx.availableBalance){status='Нет баланса';tone='empty';note='Укажи доступный баланс, чтобы расчёт стал полезным.'}
    else if(free<0){status='Не хватает';tone='danger';note=`До ${shortDate(end)} не хватает ${formatRub(String(Math.abs(free)))}.`}
    else if(dayLimit<500){status='Жёстко экономить';tone='danger';note=`Лимит очень низкий до ${shortDate(end)}.`}
    else if(dayLimit<1000){status='Осторожно';tone='warn';note=`Лучше держать траты около ${formatRub(String(dayLimit)))} в день.`}
    return{available,reserve,end,required,free,days,dayLimit,leftToday,status,tone,note,obligations,nextIncome:nextIncome(ctx)};
  }
  function miniExpenseForm(){
    const opts=FINANCE_CATEGORIES.map(c=>`<option value="${escapeHTML(c.value)}">${escapeHTML(c.label)}</option>`).join('');
    return `<form class="finance-mini-form" data-finance-form><label>Сумма<input name="amount" required inputmode="decimal" placeholder="250"></label><label>Категория<select name="category">${opts}</select></label><input name="reason" type="hidden" value=""><input name="comment" type="hidden" value=""><input name="time" type="hidden" value=""><button class="primary-button" type="submit">Записать трату</button></form>`;
  }
  function eventTitle(item,type){return escapeHTML(item.title|| (type==='income'?'Поступление':'Оплата'))}
  function eventCard(item,type){return `<article class="finance-event ${type}"><div><strong>${eventTitle(item,type)}</strong><div class="muted">${item.date?shortDate(item.date):'без даты'} · ${formatRub(item.amount)}</div></div><button class="ghost-button small" data-finance-plan-complete="${item.id}" data-plan-type="${type}">${type==='income'?'Получено':'Оплачено'}</button></article>`}
  function eventsList(ctx,calc){
    const incomes=futureItems(ctx.incomes).slice(0,2).map(x=>eventCard(x,'income'));
    const obligations=futureItems(ctx.obligations).slice(0,3).map(x=>eventCard(x,'obligation'));
    const rows=[...obligations,...incomes];
    return rows.length?rows.join(''):'<div class="empty">Ближайших поступлений и оплат нет.</div>';
  }
  function addForms(ctx){return `<details class="collapsible-list finance-add-details" data-details-key="finance-add-income"><summary>Добавить поступление</summary>${renderFinancePlanForm('income')}</details><details class="collapsible-list finance-add-details" data-details-key="finance-add-obligation"><summary>Добавить обязательную оплату</summary>${renderFinancePlanForm('obligation')}</details>`}
  function renderMiniFinance(){
    const root=$('#tab-finance');if(!root)return;
    const summary=getFinanceSummary();
    const ctx=getFinanceContext();
    const calc=calcFinance(ctx,summary);
    root.innerHTML=`
      <section class="card finance-mini-hero finance-state-${calc.tone}">
        <div class="finance-status-row"><span class="finance-status-pill">${calc.status}</span><span class="muted">горизонт: ${shortDate(calc.end)}</span></div>
        <h2>Финансы</h2>
        <p class="muted">${calc.note}</p>
        <div class="finance-life-grid main-grid">
          <div class="finance-life-stat main"><span class="muted">Лимит в день</span><b>${ctx.availableBalance?formatRub(String(Math.max(0,calc.dayLimit))):'—'}</b></div>
          <div class="finance-life-stat"><span class="muted">Осталось сегодня</span><b>${ctx.availableBalance?formatRub(String(calc.leftToday)):'—'}</b></div>
          <div class="finance-life-stat"><span class="muted">На карте</span><b>${ctx.availableBalance?formatRub(ctx.availableBalance):'—'}</b></div>
          <div class="finance-life-stat"><span class="muted">Свободно реально</span><b>${ctx.availableBalance?formatRub(String(calc.free)):'—'}</b></div>
        </div>
      </section>

      <section class="card finance-mini-expense">
        <div class="card-title-row"><div><h2>Быстрая трата</h2><p class="muted">Только сумма и категория. Остальное не мешает.</p></div></div>
        ${miniExpenseForm()}
        ${renderFinanceNoExpensesButton(state.selectedDate)}
        ${renderCollapsedBlock('Сегодняшние траты',`<div class="finance-list">${renderFinanceList(state.selectedDate,true)}</div>`,`${summary.count}`,{key:`finance-mini-day-${state.selectedDate}`})}
      </section>

      <section class="card finance-mini-next">
        <div class="card-title-row"><div><h2>Ближайшее</h2><p class="muted">То, что скоро влияет на деньги.</p></div></div>
        <div class="finance-events-list">${eventsList(ctx,calc)}</div>
        ${addForms(ctx)}
      </section>

      <details class="card collapsible-list finance-mini-balance"><summary>Баланс и резерв</summary><form class="form-grid finance-context" data-finance-context-form><label>Доступно сейчас<input name="availableBalance" inputmode="decimal" placeholder="Напр. 12500" value="${escapeHTML(ctx.availableBalance||'')}"></label><label>Резерв<input name="reserveBalance" inputmode="decimal" placeholder="Напр. 5000" value="${escapeHTML(ctx.reserveBalance||'')}"></label><button class="primary-button" type="submit">Сохранить баланс</button></form></details>
      <details class="card collapsible-list finance-history-details"><summary>История операций · ${ctx.operations.length}</summary><div class="finance-list">${renderFinanceOperationsHistory()}</div></details>
      <details class="card collapsible-list finance-goals-details"><summary>Финансовые цели</summary>${renderFinanceGoalsForm(ctx)}</details>`;
    bindCommonActions(root);
    bindClick(root,'[data-finance-help]',openFinanceHelpDialog);
  }
  function install(){try{renderFinance=renderMiniFinance}catch(e){window.renderFinance=renderMiniFinance}if(document.body?.dataset.activeTab==='finance')renderMiniFinance()}
  document.addEventListener('DOMContentLoaded',install);
  window.addEventListener('load',install);
})();
