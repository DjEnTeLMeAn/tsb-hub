from pathlib import Path

APP=Path('js/app.js'); CSS=Path('css/mobile-finance.css'); STATIC=Path('tests/app-static.test.cjs')
app=APP.read_text(); css=CSS.read_text(); static=STATIC.read_text()

# Finance-screen mutations should not redraw the whole application.
old=r'''function applyFinanceMutation(result, message = '') {
  if (!result?.ok) {
    if (typeof showToast === 'function') showToast(financeMutationErrorText(result?.error));
    return false;
  }
  setFinanceStateV2(result.finance);
  markChanged();
  if (message && typeof showToast === 'function') showToast(message);
  return true;
}
'''
new=r'''function applyFinanceMutation(result, message = '') {
  if (!result?.ok) {
    if (typeof showToast === 'function') showToast(financeMutationErrorText(result?.error));
    return false;
  }
  setFinanceStateV2(result.finance);
  if (state.activeTab === 'finance') {
    const scrollY=window.scrollY||document.documentElement.scrollTop||0;
    saveData(app,true);
    renderFinance();
    requestAnimationFrame(()=>window.scrollTo(0,scrollY));
  } else {
    // Today still uses the established full render path because its mobile cleanup hooks live outside Finance.
    markChanged();
  }
  if (message && typeof showToast === 'function') showToast(message);
  return true;
}
'''
if old not in app: raise RuntimeError('applyFinanceMutation anchor missing')
app=app.replace(old,new,1)

# Insert income type UI before management screen.
anchor="function renderFinanceManagementScreen(root=$('#tab-finance')) {\n"
if anchor not in app: raise RuntimeError('management insertion anchor missing')
income_ui=r'''function renderFinanceIncomeTypeCard(item) {
  return `<article class="finance-v2-manage-item"><div><div class="badge-row">${item.system?'<span class="badge secondary">системный</span>':''}</div><strong>${escapeHTML(item.name)}</strong></div><div class="actions"><button class="ghost-button small" type="button" data-finance-income-type-edit="${escapeHTML(item.id)}">Изм.</button>${item.system?'':`<button class="danger-button small" type="button" data-finance-income-type-archive="${escapeHTML(item.id)}">Архив</button>`}</div></article>`;
}
async function openFinanceIncomeTypeDialog(itemId='') {
  const finance=getFinanceStateV2();const current=finance.incomeTypes.find(item=>item.id===itemId)||null;
  const result=await openEditDialog({title:current?'Изменить тип поступления':'Новый тип поступления',fields:[{name:'name',label:'Название',value:current?.name||'',placeholder:'Напр. Подработка'}],submitText:'Подтвердить'});if(!result)return;
  applyFinanceMutation(TSBFinanceCore.createOrUpdateIncomeType(finance,{...(current?{id:current.id}:{}),name:String(result.name||'').trim()},{idFactory:uid}),current?'Тип поступления изменён':'Тип поступления добавлен');
}
async function archiveFinanceIncomeType(itemId) {
  const finance=getFinanceStateV2();const item=finance.incomeTypes.find(x=>x.id===itemId);if(!item||item.system)return;
  const ok=await openConfirmDialog({title:'Архивировать тип поступления?',message:'Старые операции сохранят его id и останутся в истории.',confirmText:'Архивировать',danger:true});if(!ok)return;
  applyFinanceMutation(TSBFinanceCore.archiveIncomeType(finance,itemId),'Тип поступления архивирован');
}
function renderFinanceIncomeTypesScreen(root=$('#tab-finance')) {
  if(!root)return;const items=getFinanceStateV2().incomeTypes.filter(item=>item.active&&!item.archived);
  root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Типы поступлений</h2><p class="muted">Используются только при добавлении INCOME.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section><section class="card"><div class="card-title-row"><h2>Активные типы</h2><button class="primary-button small" type="button" data-finance-income-type-add>+ Тип</button></div><div class="finance-v2-manage-list">${items.map(renderFinanceIncomeTypeCard).join('')}</div></section>`;
  bindFinanceV2Screen(root);
}

'''
app=app.replace(anchor,income_ui+anchor,1)

# Add management row directly after Categories.
old='<button class="finance-v2-nav-row" type="button" data-finance-management-open="categories"><span><strong>Категории</strong><small>Категории расходов</small></span><b>›</b></button>'
new=old+'\n    <button class="finance-v2-nav-row" type="button" data-finance-management-open="income-types"><span><strong>Типы поступлений</strong><small>Источники INCOME</small></span><b>›</b></button>'
if old not in app: raise RuntimeError('management categories row missing')
app=app.replace(old,new,1)

# Add binders alongside categories.
old="  root.querySelectorAll('[data-finance-category-archive]').forEach(button=>button.onclick=()=>archiveFinanceCategory(button.dataset.financeCategoryArchive));\n"
new=old+"  root.querySelector('[data-finance-income-type-add]')?.addEventListener('click',()=>openFinanceIncomeTypeDialog());\n  root.querySelectorAll('[data-finance-income-type-edit]').forEach(button=>button.onclick=()=>openFinanceIncomeTypeDialog(button.dataset.financeIncomeTypeEdit));\n  root.querySelectorAll('[data-finance-income-type-archive]').forEach(button=>button.onclick=()=>archiveFinanceIncomeType(button.dataset.financeIncomeTypeArchive));\n"
if old not in app: raise RuntimeError('category binder anchor missing')
app=app.replace(old,new,1)

# Add render route.
old="  if (state.financeSubscreen === 'categories') { renderFinanceCategoriesScreen(root); return; }\n"
new=old+"  if (state.financeSubscreen === 'income-types') { renderFinanceIncomeTypesScreen(root); return; }\n"
if old not in app: raise RuntimeError('category subscreen route missing')
app=app.replace(old,new,1)
APP.write_text(app)

css += r'''

/* Finance v2 Part3 — final management/polish */
.finance-v2-management-list .finance-v2-nav-row{min-height:54px}
.finance-v2-manage-item .actions{flex-shrink:0}
'''
CSS.write_text(css)

extra=r'''

// Finance v2 Part3 finishes management without adding a parallel data model.
assert.ok(app.includes('function renderFinanceIncomeTypesScreen'),'income type management screen missing');
assert.ok(app.includes('TSBFinanceCore.createOrUpdateIncomeType'),'income type management must use core');
assert.ok(app.includes('TSBFinanceCore.archiveIncomeType'),'income type archive must use core');
assert.ok(app.includes('data-finance-management-open="income-types"'),'income type management entry missing');
// Finance mutations on Finance should render only Finance instead of the whole app.
const mutationStart=app.indexOf('function applyFinanceMutation');const mutationEnd=app.indexOf('function ',mutationStart+20);const mutationFn=app.slice(mutationStart,mutationEnd);
assert.ok(mutationFn.includes("state.activeTab === 'finance'"),'Finance local render branch missing');
assert.ok(mutationFn.includes('saveData(app,true)'),'Finance local mutation must persist data');
assert.ok(mutationFn.includes('renderFinance()'),'Finance local mutation must redraw Finance only');
'''
if 'Finance v2 Part3 finishes management' not in static:static+=extra
STATIC.write_text(static)
print('Finance v2 Part3 stage F applied')
