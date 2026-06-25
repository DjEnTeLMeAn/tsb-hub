// TSB Hub 0.8.27 - finance tab mini-tracker renderer.
(function(){
  function soon(list){return getUpcomingPlanItems(list.filter(x=>x.status==='planned'),2)}
  function rub(v){return v?formatRub(v):'—'}
  function money(v){return moneyNumber(v)||0}
  function countPlanned(list){return list.filter(x=>x.status==='planned').length}
  function miniList(items,type){
    if(!items.length)return '<div class="empty">Пока нет ближайших записей.</div>';
    return items.map(item=>`<article class="finance-item mini-money-item"><div><strong>${escapeHTML(item.title|| (type==='income'?'Поступление':'Оплата'))}</strong><div class="muted">${item.date?shortDate(item.date):'без даты'} · ${formatRub(item.amount)}</div></div><button class="ghost-button small" data-finance-plan-complete="${item.id}" data-plan-type="${type}">${type==='income'?'Получено':'Оплачено'}</button></article>`).join('');
  }
  function renderMiniFinance(){
    const root=$('#tab-finance');if(!root)return;
    const summary=getFinanceSummary();
    const ctx=getFinanceContext();
    const plannedIncomes=soon(ctx.incomes);
    const plannedObligations=soon(ctx.obligations);
    const available=money(ctx.availableBalance);
    const reserve=money(ctx.reserveBalance);
    const underControl=available+reserve;
    root.innerHTML=`
      <section class="card finance-mini-hero">
        <div class="card-title-row"><div><h2>Финансы</h2><p class="muted">Мини-режим: баланс, трата, ближайшие деньги.</p></div></div>
        <div class="finance-life-grid">
          <div class="finance-life-stat main"><span class="muted">Можно тратить</span><b>${ctx.availableBalance?formatRub(ctx.availableBalance):'—'}</b></div>
          <div class="finance-life-stat"><span class="muted">Сегодня ушло</span><b>${formatRub(summary.total)}</b></div>
        </div>
        <div class="finance-mini-line muted">${underControl?`Под контролем: ${formatRub(String(underControl))}`:'Укажи баланс, чтобы видеть реальную картину.'}</div>
      </section>

      <section class="card finance-mini-expense">
        <div class="card-title-row"><div><h2>Быстрая трата</h2><p class="muted">Главная форма финансов. Записал — баланс уменьшился.</p></div></div>
        ${renderFinanceQuickForm('finance')}
        ${renderFinanceNoExpensesButton(state.selectedDate)}
        ${renderCollapsedBlock('Операции дня',`<div class="finance-list">${renderFinanceList(state.selectedDate,true)}</div>`,`${summary.count}`,{key:`finance-mini-day-${state.selectedDate}`})}
      </section>

      <section class="card finance-mini-balance">
        <div class="card-title-row"><div><h2>Баланс</h2><p class="muted">Фактические деньги сейчас. Резерв — то, что не трогаем каждый день.</p></div></div>
        <form class="form-grid finance-context" data-finance-context-form>
          <label>Доступно сейчас<input name="availableBalance" inputmode="decimal" placeholder="Напр. 12500" value="${escapeHTML(ctx.availableBalance||'')}"></label>
          <label>Резерв<input name="reserveBalance" inputmode="decimal" placeholder="Напр. 5000" value="${escapeHTML(ctx.reserveBalance||'')}"></label>
          <button class="primary-button" type="submit">Сохранить баланс</button>
        </form>
      </section>

      <section class="card finance-mini-next">
        <div class="card-title-row"><div><h2>Ближайшие деньги</h2><p class="muted">Не вся бухгалтерия, а то, что скоро влияет на жизнь.</p></div></div>
        <details class="collapsible-list" data-details-key="finance-mini-incomes"><summary>Поступления · ${countPlanned(ctx.incomes)}</summary>${renderFinancePlanForm('income')}<div class="finance-list">${miniList(plannedIncomes,'income')}</div></details>
        <details class="collapsible-list" data-details-key="finance-mini-obligations"><summary>Обязательные оплаты · ${countPlanned(ctx.obligations)}</summary>${renderFinancePlanForm('obligation')}<div class="finance-list">${miniList(plannedObligations,'obligation')}</div></details>
      </section>

      <details class="card collapsible-list finance-history-details"><summary>История операций · ${ctx.operations.length}</summary><div class="finance-list">${renderFinanceOperationsHistory()}</div></details>
      <details class="card collapsible-list finance-goals-details"><summary>Финансовые цели</summary>${renderFinanceGoalsForm(ctx)}</details>`;
    bindCommonActions(root);
    bindClick(root,'[data-finance-help]',openFinanceHelpDialog);
  }
  function install(){
    try{renderFinance=renderMiniFinance}catch(e){window.renderFinance=renderMiniFinance}
    if(document.body?.dataset.activeTab==='finance')renderMiniFinance();
  }
  document.addEventListener('DOMContentLoaded',install);
  window.addEventListener('load',install);
})();
