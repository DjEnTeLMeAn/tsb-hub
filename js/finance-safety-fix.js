// TSB Hub 0.8.33 - finance integrity guard.
(function(){
  function halt(e){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation()}
  function expenseIds(){
    const ids=new Set();
    Object.values(app.finance||{}).forEach(day=>{(day.expenses||[]).forEach(exp=>ids.add(exp.id))});
    return ids;
  }
  function cleanGhostExpenseOps(){
    const ctx=getFinanceContext();
    const ids=expenseIds();
    const before=ctx.operations.length;
    ctx.operations=ctx.operations.filter(op=>!(op.type==='expense'&&op.sourceId&&!ids.has(op.sourceId)));
    return before!==ctx.operations.length;
  }
  function cleanAndRender(){
    if(cleanGhostExpenseOps())saveData(app,true);
    renderAll();
  }
  document.addEventListener('submit',e=>{
    const form=e.target.closest&&e.target.closest('[data-finance-context-form]');
    if(!form)return;
    halt(e);
    const fd=new FormData(form);
    const ctx=getFinanceContext();
    ctx.availableBalance=normalizeSignedMoneyInput(fd.get('availableBalance'));
    ctx.reserveBalance=normalizeMoneyInput(fd.get('reserveBalance'));
    markChanged();
    showToast('Баланс сохранён');
  },true);
  document.addEventListener('click',async e=>{
    const opBtn=e.target.closest&&e.target.closest('[data-finance-operation-delete]');
    if(opBtn){
      halt(e);
      const ok=await openConfirmDialog({title:'Удалить запись?',message:'Баланс не изменится.',confirmText:'Удалить',danger:true});
      if(!ok)return;
      const ctx=getFinanceContext();
      ctx.operations=ctx.operations.filter(op=>op.id!==opBtn.dataset.financeOperationDelete);
      markChanged();
      showToast('Запись удалена');
      return;
    }
    const expenseBtn=e.target.closest&&e.target.closest('[data-finance-delete],[data-mini-expense-delete]');
    if(expenseBtn){setTimeout(()=>{if(cleanGhostExpenseOps()){saveData(app,true);renderAll()}},80)}
  },true);
  document.addEventListener('DOMContentLoaded',()=>setTimeout(cleanAndRender,300));
  window.addEventListener('load',()=>setTimeout(cleanAndRender,500));
})();
