// TSB Hub 0.8.32 - finance safe actions.
(function(){
  function halt(e){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation()}
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
    const btn=e.target.closest&&e.target.closest('[data-finance-operation-delete]');
    if(!btn)return;
    halt(e);
    const ok=await openConfirmDialog({title:'Удалить запись?',message:'Баланс не изменится.',confirmText:'Удалить',danger:true});
    if(!ok)return;
    const ctx=getFinanceContext();
    ctx.operations=ctx.operations.filter(op=>op.id!==btn.dataset.financeOperationDelete);
    markChanged();
    showToast('Запись удалена');
  },true);
})();
