from pathlib import Path

CORE=Path('js/finance-core.js'); APP=Path('js/app.js'); CSS=Path('css/mobile-finance.css'); TEST=Path('tests/finance-core.test.cjs'); STATIC=Path('tests/app-static.test.cjs')
core=CORE.read_text(); app=APP.read_text(); css=CSS.read_text(); test=TEST.read_text(); static=STATIC.read_text()

old="  const SYSTEM_KINDS=Object.freeze({MIGRATION_ANCHOR:'MIGRATION_ANCHOR'});"
new="  const SYSTEM_KINDS=Object.freeze({MIGRATION_ANCHOR:'MIGRATION_ANCHOR',RECONCILIATION:'RECONCILIATION'});"
if old not in core: raise RuntimeError('system kinds anchor missing')
core=core.replace(old,new,1)

anchor="  function validateTransactionShape(transaction){\n"
if anchor not in core: raise RuntimeError('reconcile insertion anchor missing')
reconcile=r'''  function reconcileAccount(finance,accountId,actualBalance,{date='',time='',description='',now=nowISO(),idFactory=makeId}={}){
    const state=normalizeFinance(finance,now);
    const account=getAccount(state,accountId);
    if(!account||account.archived||!account.active)return {ok:false,error:'ACCOUNT_NOT_FOUND',finance:state};
    const raw=String(actualBalance??'').trim().replace(',','.');
    if(raw===''||!Number.isFinite(Number(raw)))return {ok:false,error:'INVALID_ACTUAL_BALANCE',finance:state};
    const actual=roundMoney(Number(raw));
    const calculated=getAccountBalance(state,accountId);
    const difference=roundMoney(actual-calculated);
    if(Math.abs(difference)<0.005)return {ok:true,finance:state,account,calculated,actual,difference:0,changed:false,transaction:null};
    const created=createTransaction(state,{
      type:TYPES.ADJUSTMENT,amount:difference,accountId,
      systemKind:SYSTEM_KINDS.RECONCILIATION,
      date:validDate(date)?date:isoDateFromNow(now),time:validTime(time)?time:'',
      description:text(description)||`Сверка счёта: фактически ${actual}`
    },{now,idFactory});
    if(!created.ok)return created;
    return {ok:true,finance:created.finance,account,calculated,actual,difference,changed:true,transaction:created.transaction};
  }

'''
core=core.replace(anchor,reconcile+anchor,1)
old="    createTransaction,updateTransaction,deleteTransaction,createAccount,updateAccount,archiveAccount,\n"
new="    createTransaction,updateTransaction,deleteTransaction,createAccount,updateAccount,archiveAccount,reconcileAccount,\n"
if old not in core: raise RuntimeError('core reconcile export anchor missing')
core=core.replace(old,new,1)
CORE.write_text(core)

# Enable reconciliation in management.
old='    <div class="finance-v2-nav-row disabled" aria-disabled="true"><span><strong>Сверка баланса</strong><small>Будет реализована отдельно, без пустого экрана</small></span></div>'
new='    <button class="finance-v2-nav-row" type="button" data-finance-management-open="reconcile"><span><strong>Сверка баланса</strong><small>Сравнить расчётный и фактический остаток</small></span><b>›</b></button>'
if old not in app: raise RuntimeError('management reconciliation placeholder missing')
app=app.replace(old,new,1)

# Insert reconcile screen before management screen.
anchor="function renderFinanceManagementScreen(root=$('#tab-finance')) {\n"
if anchor not in app: raise RuntimeError('management screen anchor missing')
ui=r'''function renderFinanceReconcileScreen(root=$('#tab-finance')) {
  if(!root)return;const accounts=getFinanceAccounts();const selectedId=state.financeReconcileAccountId&&accounts.some(x=>x.id===state.financeReconcileAccountId)?state.financeReconcileAccountId:(getDefaultFinanceAccount()?.id||accounts[0]?.id||'');
  state.financeReconcileAccountId=selectedId;const selected=accounts.find(x=>x.id===selectedId)||null;const calculated=selected?getFinanceAccountBalance(selected.id):0;
  const options=accounts.map(account=>`<option value="${escapeHTML(account.id)}" ${account.id===selectedId?'selected':''}>${escapeHTML(account.name)} · ${formatRub(getFinanceAccountBalance(account.id))}</option>`).join('');
  root.innerHTML=`<section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Сверка баланса</h2><p class="muted">Фактический остаток не перезаписывает историю: разница фиксируется одной системной корректировкой.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    <section class="card finance-v2-reconcile-card"><form data-finance-reconcile-form><label>Счёт<select name="accountId" data-finance-reconcile-account>${options}</select></label><div class="finance-v2-reconcile-current"><span>По операциям</span><strong>${formatRub(calculated)}</strong></div><label>Фактически сейчас<input name="actualBalance" inputmode="decimal" placeholder="0" required></label><div class="finance-v2-reconcile-diff"><span>Разница</span><strong data-finance-reconcile-diff>—</strong></div><label>Комментарий <span class="muted">необязательно</span><input name="description" placeholder="Напр. сверка с банковским приложением"></label><button class="primary-button" type="submit">Сверить</button></form><p class="muted">Сверка создаёт ADJUSTMENT только на разницу. Она не считается доходом или расходом.</p></section>`;
  bindFinanceV2Screen(root);
}
async function submitFinanceReconcile(form) {
  const fd=new FormData(form);const accountId=String(fd.get('accountId')||'');const actual=String(fd.get('actualBalance')||'').trim();const description=String(fd.get('description')||'').trim();
  const result=TSBFinanceCore.reconcileAccount(getFinanceStateV2(),accountId,actual,{date:toISODate(new Date()),description,idFactory:uid});
  if(!result.ok){showToast(result.error==='INVALID_ACTUAL_BALANCE'?'Укажи фактический остаток':financeMutationErrorText(result.error));return;}
  if(!result.changed){showToast('Баланс уже совпадает');return;}
  applyFinanceMutation(result,`Сверка: ${result.difference>0?'+':''}${formatRub(result.difference)}`);
}

'''
app=app.replace(anchor,ui+anchor,1)

# Add error mapping.
old="    ACCOUNT_NOT_FOUND: 'Счёт не найден'\n"
new="    ACCOUNT_NOT_FOUND: 'Счёт не найден',\n    INVALID_ACTUAL_BALANCE: 'Укажи фактический остаток'\n"
if old not in app: raise RuntimeError('finance error mapping anchor missing')
app=app.replace(old,new,1)

# Bind reconcile events before management-open handler.
old="  root.querySelectorAll('[data-finance-management-open]').forEach(button=>button.onclick=()=>{const target=button.dataset.financeManagementOpen;if(target==='sync'){setTab('sync');return;}openFinanceSubscreen(target,'management');});\n"
new="  root.querySelector('[data-finance-reconcile-form]')?.addEventListener('submit',event=>{event.preventDefault();submitFinanceReconcile(event.currentTarget);});\n  root.querySelector('[data-finance-reconcile-account]')?.addEventListener('change',event=>{state.financeReconcileAccountId=event.target.value;renderFinance();});\n  root.querySelector('[data-finance-reconcile-form] [name=\"actualBalance\"]')?.addEventListener('input',event=>{const raw=String(event.target.value||'').replace(',','.');const actual=Number(raw);const accountId=state.financeReconcileAccountId;const current=accountId?getFinanceAccountBalance(accountId):0;const target=root.querySelector('[data-finance-reconcile-diff]');if(target)target.textContent=raw!==''&&Number.isFinite(actual)?`${actual-current>0?'+':''}${formatRub(actual-current)}`:'—';});\n  root.querySelectorAll('[data-finance-management-open]').forEach(button=>button.onclick=()=>{const target=button.dataset.financeManagementOpen;if(target==='sync'){setTab('sync');return;}openFinanceSubscreen(target,'management');});\n"
if old not in app: raise RuntimeError('management binder anchor missing')
app=app.replace(old,new,1)

# Render subscreen.
old="  if (state.financeSubscreen === 'analytics') { renderFinanceAnalyticsScreen(root); return; }\n"
new="  if (state.financeSubscreen === 'analytics') { renderFinanceAnalyticsScreen(root); return; }\n  if (state.financeSubscreen === 'reconcile') { renderFinanceReconcileScreen(root); return; }\n"
if old not in app: raise RuntimeError('reconcile render anchor missing')
app=app.replace(old,new,1)
APP.write_text(app)

css += r'''

/* Finance v2 Part3 — reconciliation */
.finance-v2-reconcile-card form{display:grid;gap:12px}
.finance-v2-reconcile-card label{display:grid;gap:6px}
.finance-v2-reconcile-current,.finance-v2-reconcile-diff{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 12px;border-radius:12px;background:rgba(255,255,255,.035)}
.finance-v2-reconcile-current span,.finance-v2-reconcile-diff span{opacity:.72}
'''
CSS.write_text(css)

append=r'''

test('Part3 reconciliation creates one ADJUSTMENT and reaches actual account balance',()=>{
  let f=core.createEmptyFinance('2026-08-01T00:00:00.000Z');
  f=core.createAccount(f,{id:'card',name:'Card',isDefault:true},{now:'2026-08-01T00:00:00.000Z'}).finance;
  f=core.createTransaction(f,{type:'INCOME',amount:10000,accountId:'card',incomeTypeId:'personal',date:'2026-08-01'},{now:'2026-08-01T12:00:00.000Z',idFactory:()=> 'inc'}).finance;
  const beforeAnalytics=core.getAnalyticsSummary(f,{dateFrom:'2026-08-01',dateTo:'2026-08-07'});
  const r=core.reconcileAccount(f,'card','9750',{date:'2026-08-07',now:'2026-08-07T12:00:00.000Z',idFactory:()=> 'rec'});
  assert.equal(r.ok,true);assert.equal(r.changed,true);assert.equal(r.difference,-250);
  assert.equal(r.transaction.type,'ADJUSTMENT');assert.equal(r.transaction.systemKind,core.SYSTEM_KINDS.RECONCILIATION);
  assert.equal(core.getAccountBalance(r.finance,'card'),9750);
  assert.equal(r.finance.transactions.filter(x=>x.systemKind===core.SYSTEM_KINDS.RECONCILIATION).length,1);
  const afterAnalytics=core.getAnalyticsSummary(r.finance,{dateFrom:'2026-08-01',dateTo:'2026-08-07'});
  assert.deepEqual({income:afterAnalytics.income,expense:afterAnalytics.expense,difference:afterAnalytics.difference},{income:beforeAnalytics.income,expense:beforeAnalytics.expense,difference:beforeAnalytics.difference});
});

test('Part3 reconciliation with matching balance creates no transaction',()=>{
  let f=core.createEmptyFinance('2026-08-01T00:00:00.000Z');f=core.createAccount(f,{id:'cash',name:'Cash',isDefault:true},{now:'2026-08-01T00:00:00.000Z'}).finance;
  const count=f.transactions.length;const r=core.reconcileAccount(f,'cash','0',{now:'2026-08-07T12:00:00.000Z'});
  assert.equal(r.ok,true);assert.equal(r.changed,false);assert.equal(r.difference,0);assert.equal(r.finance.transactions.length,count);
});
'''
if 'Part3 reconciliation creates one ADJUSTMENT' not in test:test+=append
TEST.write_text(test)

extra=r'''

// Finance v2 Part3 reconciliation is a real screen backed by one core ADJUSTMENT.
assert.ok(app.includes('function renderFinanceReconcileScreen'),'reconciliation screen missing');
assert.ok(app.includes('TSBFinanceCore.reconcileAccount'),'reconciliation must use finance core');
assert.ok(app.includes('data-finance-management-open="reconcile"'),'reconciliation management entry missing');
assert.ok(app.includes('ADJUSTMENT только на разницу'),'reconciliation explanation missing');
'''
if 'Finance v2 Part3 reconciliation is a real screen' not in static:static+=extra
STATIC.write_text(static)
print('Finance v2 Part3 stage C applied')
