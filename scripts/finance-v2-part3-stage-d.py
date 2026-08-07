from pathlib import Path

APP=Path('js/app.js'); CSS=Path('css/mobile-finance.css'); STATIC=Path('tests/app-static.test.cjs')
app=APP.read_text(); css=CSS.read_text(); static=STATIC.read_text()

# Change management export destination from general sync shortcut to Finance export screen.
old='<button class="finance-v2-nav-row" type="button" data-finance-management-open="sync"><span><strong>Экспорт данных</strong><small>Перейти к существующему экспорту JSON</small></span><b>›</b></button>'
new='<button class="finance-v2-nav-row" type="button" data-finance-management-open="export"><span><strong>Экспорт данных</strong><small>Finance JSON, CSV операций и полный backup</small></span><b>›</b></button>'
if old not in app: raise RuntimeError('management export anchor missing')
app=app.replace(old,new,1)

# Insert finance export helpers/screen before management screen.
anchor="function renderFinanceManagementScreen(root=$('#tab-finance')) {\n"
if anchor not in app: raise RuntimeError('management insertion anchor missing')
insert=r'''function downloadFinanceFile(filename,textValue,type='application/json;charset=utf-8') {
  const blob=new Blob([textValue],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
}
function financeCsvCell(value) {
  const text=String(value??'');return /[";,\n\r]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
}
function financeTransactionExportRow(transaction) {
  const finance=getFinanceStateV2();const account=finance.accounts.find(x=>x.id===transaction.accountId);const from=finance.accounts.find(x=>x.id===transaction.fromAccountId);const to=finance.accounts.find(x=>x.id===transaction.toAccountId);
  const category=transaction.type==='EXPENSE'?getFinanceCategoryLabel(transaction.categoryId):'';const incomeType=transaction.type==='INCOME'?(finance.incomeTypes.find(x=>x.id===transaction.incomeTypeId)?.name||''):'';
  return [transaction.date,transaction.time||'',transaction.type,transaction.amount,account?.name||'',from?.name||'',to?.name||'',category,incomeType,transaction.systemKind||'',transaction.description||''];
}
function financeTransactionsCsv(rows=getFinanceTransactions()) {
  const header=['date','time','type','amount','account','from_account','to_account','category','income_type','system_kind','description'];
  return '\uFEFF'+[header,...rows.map(financeTransactionExportRow)].map(row=>row.map(financeCsvCell).join(';')).join('\n');
}
function buildFinanceExportObject() {
  const finance=TSBFinanceCore.normalizeFinance(getFinanceStateV2());const coverage=getFinanceCoverage();
  return {
    exportedAt:new Date().toISOString(),appVersion:APP_VERSION,financeSchemaVersion:finance.schemaVersion,
    balances:{total:coverage.totalAccounts,reserved:coverage.reserved,upcoming:coverage.upcoming,free:coverage.free,accounts:finance.accounts.map(account=>({id:account.id,name:account.name,balance:getFinanceAccountBalance(account.id),active:account.active,archived:account.archived,isDefault:account.isDefault}))},
    finance
  };
}
function exportFinanceJson() {
  downloadFinanceFile(`tsb_finance_${toISODate(new Date())}.json`,JSON.stringify(buildFinanceExportObject(),null,2));showToast('Finance JSON экспортирован');
}
function exportFinanceCsv(rows=getFinanceTransactions(),suffix='operations') {
  downloadFinanceFile(`tsb_finance_${suffix}_${toISODate(new Date())}.csv`,financeTransactionsCsv(rows),'text/csv;charset=utf-8');showToast('CSV экспортирован');
}
function renderFinanceExportScreen(root=$('#tab-finance')) {
  if(!root)return;const finance=getFinanceStateV2();root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Экспорт финансов</h2><p class="muted">Экспорт не меняет данные и не создаёт операций.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    <section class="card finance-v2-export-card"><button class="primary-button" type="button" data-finance-export-json>Finance JSON</button><p class="muted">Счета, операции, резервы, обязательства и вычисляемые текущие показатели. Schema ${finance.schemaVersion}.</p><button class="ghost-button" type="button" data-finance-export-csv>Операции CSV</button><p class="muted">Пользовательская история операций без скрытого migration anchor.</p><button class="ghost-button" type="button" data-finance-export-full>Полный backup TSB Hub</button><p class="muted">Откроет существующий экспорт всей базы приложения.</p></section>`;bindFinanceV2Screen(root);
}

'''
app=app.replace(anchor,insert+anchor,1)

# Bind buttons and no longer special-case sync in management handler.
old="  root.querySelectorAll('[data-finance-management-open]').forEach(button=>button.onclick=()=>{const target=button.dataset.financeManagementOpen;if(target==='sync'){setTab('sync');return;}openFinanceSubscreen(target,'management');});\n"
new="  root.querySelector('[data-finance-export-json]')?.addEventListener('click',exportFinanceJson);\n  root.querySelector('[data-finance-export-csv]')?.addEventListener('click',()=>exportFinanceCsv());\n  root.querySelector('[data-finance-export-full]')?.addEventListener('click',()=>setTab('sync'));\n  root.querySelectorAll('[data-finance-management-open]').forEach(button=>button.onclick=()=>openFinanceSubscreen(button.dataset.financeManagementOpen,'management'));\n"
if old not in app: raise RuntimeError('management open binder anchor missing')
app=app.replace(old,new,1)

# Render export subscreen.
old="  if (state.financeSubscreen === 'reconcile') { renderFinanceReconcileScreen(root); return; }\n"
new="  if (state.financeSubscreen === 'reconcile') { renderFinanceReconcileScreen(root); return; }\n  if (state.financeSubscreen === 'export') { renderFinanceExportScreen(root); return; }\n"
if old not in app: raise RuntimeError('export render anchor missing')
app=app.replace(old,new,1)
APP.write_text(app)

css += r'''

/* Finance v2 Part3 — export */
.finance-v2-export-card{display:grid;gap:8px}
.finance-v2-export-card p{margin:0 0 8px}
'''
CSS.write_text(css)

extra=r'''

// Finance v2 Part3 export stays separate from the full TSB backup.
assert.ok(app.includes('function buildFinanceExportObject'),'Finance JSON export builder missing');
assert.ok(app.includes('function financeTransactionsCsv'),'Finance CSV export missing');
assert.ok(app.includes('function renderFinanceExportScreen'),'Finance export screen missing');
assert.ok(app.includes('data-finance-management-open="export"'),'Finance export management entry missing');
assert.ok(app.includes('Полный backup TSB Hub'),'full backup bridge missing');
assert.ok(app.includes('financeSchemaVersion:finance.schemaVersion'),'Finance export schema marker missing');
'''
if 'Finance v2 Part3 export stays separate' not in static:static+=extra
STATIC.write_text(static)
print('Finance v2 Part3 stage D applied')
