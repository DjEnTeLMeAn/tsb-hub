from pathlib import Path

p=Path('js/finance-core.js')
s=p.read_text()
s=s.replace("const SYSTEM_KINDS=Object.freeze({MIGRATION_ANCHOR:'MIGRATION_ANCHOR',RECONCILIATION:'RECONCILIATION'});","const SYSTEM_KINDS=Object.freeze({MIGRATION_ANCHOR:'MIGRATION_ANCHOR',RECONCILIATION:'RECONCILIATION',LEGACY_RESERVE_BALANCE:'LEGACY_RESERVE_BALANCE'});")
old = "        legacyReserveStatus:text(source.migration?.legacyReserveStatus),\n        legacyReserveAmount:nonNegativeMoney(source.migration?.legacyReserveAmount),\n        legacyObligationsMigrated:Number(source.migration?.legacyObligationsMigrated||0),"
new = "        legacyReserveStatus:text(source.migration?.legacyReserveStatus),\n        legacyReserveAmount:nonNegativeMoney(source.migration?.legacyReserveAmount),\n        legacyReserveBalanceStatus:text(source.migration?.legacyReserveBalanceStatus),\n        legacyReserveBalanceTransactionId:text(source.migration?.legacyReserveBalanceTransactionId),\n        legacyReserveBalanceRestoredAt:text(source.migration?.legacyReserveBalanceRestoredAt),\n        legacyObligationsMigrated:Number(source.migration?.legacyObligationsMigrated||0),"
if old not in s: raise SystemExit('migration fields target not found')
s=s.replace(old,new,1)
s=s.replace("function isSystemLocked(transaction){return transaction?.type===TYPES.ADJUSTMENT&&transaction?.systemKind===SYSTEM_KINDS.MIGRATION_ANCHOR}","function isSystemLocked(transaction){return transaction?.type===TYPES.ADJUSTMENT&&[SYSTEM_KINDS.MIGRATION_ANCHOR,SYSTEM_KINDS.LEGACY_RESERVE_BALANCE].includes(transaction?.systemKind)}")
marker="  function validateObligationDraft(draft){"
insert="""  function restoreLegacyReserveBalance(finance,{accountId='',now=nowISO(),idFactory=makeId}={}){
    let state=normalizeFinance(finance,now);const migration=state.migration||{};const amount=nonNegativeMoney(migration.legacyReserveAmount);
    const existing=state.transactions.find(tx=>tx.type===TYPES.ADJUSTMENT&&tx.systemKind===SYSTEM_KINDS.LEGACY_RESERVE_BALANCE);
    if(migration.legacyReserveBalanceStatus==='RESTORED'||existing){
      if(existing&&migration.legacyReserveBalanceStatus!=='RESTORED')state.migration={...migration,legacyReserveBalanceStatus:'RESTORED',legacyReserveBalanceTransactionId:existing.id,legacyReserveBalanceRestoredAt:text(existing.createdAt)||now};
      return {ok:true,finance:normalizeFinance(state,now),transaction:existing||null,restored:false};
    }
    if(migration.legacyReserveStatus!=='MIGRATED'||amount<=0)return {ok:false,error:'NO_IMPORTED_LEGACY_RESERVE',finance:state};
    const account=getAccount(state,accountId)||getDefaultAccount(state);if(!account||account.archived||!account.active)return {ok:false,error:'ACCOUNT_NOT_FOUND',finance:state};
    const created=createTransaction(state,{id:'legacy_reserve_balance_v1',type:TYPES.ADJUSTMENT,amount,accountId:account.id,date:isoDateFromNow(now),description:'Восстановление денег старого резерва',systemKind:SYSTEM_KINDS.LEGACY_RESERVE_BALANCE},{now,idFactory});
    if(!created.ok)return created;state=created.finance;state.migration={...state.migration,legacyReserveBalanceStatus:'RESTORED',legacyReserveBalanceTransactionId:created.transaction.id,legacyReserveBalanceRestoredAt:now};
    return {ok:true,finance:normalizeFinance(state,now),transaction:created.transaction,restored:true};
  }

"""
if marker not in s: raise SystemExit('restore insert marker not found')
s=s.replace(marker,insert+marker,1)
old="getActiveReserves,getTotalReservedAmount,createReserve,updateReserve,adjustReserveAmount,archiveReserve,importLegacyReserve,"
new="getActiveReserves,getTotalReservedAmount,createReserve,updateReserve,adjustReserveAmount,archiveReserve,importLegacyReserve,restoreLegacyReserveBalance,"
if old not in s: raise SystemExit('export marker not found')
s=s.replace(old,new,1)
p.write_text(s)

p=Path('js/app.js')
s=p.read_text()
s=s.replace("const APP_VERSION = '0.13.2-finance-planning-deficit';","const APP_VERSION = '0.13.3-finance-transaction-control';",1)
old = """  const accountText = transaction.type === 'TRANSFER' ? `${from?.name || '—'} → ${to?.name || '—'}` : (account?.name || '');
  return `<article class=\"finance-card finance-v2-operation ${financeTransactionTone(transaction)}\" data-finance-v2-open=\"${escapeHTML(transaction.id)}\">
    <div class=\"item-top\"><div><div class=\"badge-row\"><span class=\"badge ${transaction.type === 'EXPENSE' ? 'important' : 'secondary'}\">${escapeHTML(financeTypeLabel(transaction))}</span>${transaction.time ? `<span class=\"badge\">${escapeHTML(transaction.time)}</span>` : ''}</div><h3>${financeSignedAmount(transaction)}</h3>${transaction.description ? `<p class=\"muted\">${escapeHTML(transaction.description)}</p>` : ''}${accountText ? `<p class=\"muted finance-v2-account-note\">${escapeHTML(accountText)}</p>` : ''}</div>
    ${compact ? '<span class=\"finance-v2-chevron\">›</span>' : `<div class=\"actions\"><button class=\"ghost-button\" type=\"button\" data-finance-v2-edit=\"${escapeHTML(transaction.id)}\">Изм.</button><button class=\"danger-button\" type=\"button\" data-finance-v2-delete=\"${escapeHTML(transaction.id)}\">Удал.</button></div>`}</div>
  </article>`;"""
new = """  const accountText = transaction.type === 'TRANSFER' ? `${from?.name || '—'} → ${to?.name || '—'}` : (account?.name || '');
  const editable=!TSBFinanceCore.isSystemLocked(transaction);
  const actionButtons=editable?`<div class=\"actions finance-v2-operation-actions\"><button class=\"ghost-button mf-icon-action\" type=\"button\" data-finance-v2-edit=\"${escapeHTML(transaction.id)}\" title=\"Изменить\" aria-label=\"Изменить операцию\">✎</button><button class=\"danger-button mf-icon-action mf-trash-action\" type=\"button\" data-finance-v2-delete=\"${escapeHTML(transaction.id)}\" title=\"Удалить\" aria-label=\"Удалить операцию\">🗑</button></div>`:'<span class=\"finance-v2-chevron\">›</span>';
  return `<article class=\"finance-card finance-v2-operation ${financeTransactionTone(transaction)}\" data-finance-v2-open=\"${escapeHTML(transaction.id)}\">
    <div class=\"item-top\"><div><div class=\"badge-row\"><span class=\"badge ${transaction.type === 'EXPENSE' ? 'important' : 'secondary'}\">${escapeHTML(financeTypeLabel(transaction))}</span>${transaction.time ? `<span class=\"badge\">${escapeHTML(transaction.time)}</span>` : ''}</div><h3>${financeSignedAmount(transaction)}</h3>${transaction.description ? `<p class=\"muted\">${escapeHTML(transaction.description)}</p>` : ''}${accountText ? `<p class=\"muted finance-v2-account-note\">${escapeHTML(accountText)}</p>` : ''}</div>${actionButtons}</div>
  </article>`;"""
if old not in s: raise SystemExit('transaction row target not found')
s=s.replace(old,new,1)
marker="function renderFinanceReservesScreen(root = $('#tab-finance')) {"
restore="""async function restoreLegacyFinanceReserveBalance() {
  const finance=getFinanceStateV2();const amount=Number(finance.migration?.legacyReserveAmount||0);
  if(finance.migration?.legacyReserveStatus!=='MIGRATED'||amount<=0||finance.migration?.legacyReserveBalanceStatus==='RESTORED')return;
  const account=TSBFinanceCore.getDefaultAccount(finance);if(!account){showToast('Нет активного счёта');return;}
  const ok=await openConfirmDialog({title:'Восстановить деньги старого резерва?',message:`Добавить ${formatRub(amount)} в общий баланс как системное восстановление старых данных. Это НЕ доход и не попадёт в аналитику. Если раньше для обхода ты создавал фиктивное поступление на эту сумму — после восстановления удали его.`,confirmText:'Подтвердить'});
  if(!ok)return;applyFinanceMutation(TSBFinanceCore.restoreLegacyReserveBalance(finance,{accountId:account.id,idFactory:uid}),'Деньги старого резерва восстановлены');
}
"""
if marker not in s: raise SystemExit('reserve screen marker not found')
s=s.replace(marker,restore+marker,1)
old="  if(!root)return; const finance=getFinanceStateV2(); const active=TSBFinanceCore.getActiveReserves(finance); const legacyReview=finance.migration?.legacyReserveStatus==='REVIEW_REQUIRED'&&Number(finance.migration?.legacyReserveAmount)>0;\n"
new="  if(!root)return; const finance=getFinanceStateV2(); const active=TSBFinanceCore.getActiveReserves(finance); const legacyReview=finance.migration?.legacyReserveStatus==='REVIEW_REQUIRED'&&Number(finance.migration?.legacyReserveAmount)>0; const legacyRestore=finance.migration?.legacyReserveStatus==='MIGRATED'&&Number(finance.migration?.legacyReserveAmount)>0&&finance.migration?.legacyReserveBalanceStatus!=='RESTORED';\n"
if old not in s: raise SystemExit('legacy flags target not found')
s=s.replace(old,new,1)
old="    ${legacyReview?`<section class=\"card finance-v2-legacy-review\"><div><h3>Найден старый резерв · ${formatRub(finance.migration.legacyReserveAmount)}</h3><p class=\"muted\">Он не был перенесён автоматически: происхождение старого поля неоднозначно.</p></div><button class=\"ghost-button\" type=\"button\" data-finance-legacy-reserve-import>Импортировать как «Старый резерв»</button></section>`:''}\n"
new=old+"    ${legacyRestore?`<section class=\"card finance-v2-legacy-review\"><div><h3>Старый резерв · ${formatRub(finance.migration.legacyReserveAmount)}</h3><p class=\"muted\">Резерв уже есть, но его старые деньги ещё не включены в общий баланс.</p></div><button class=\"ghost-button\" type=\"button\" data-finance-legacy-reserve-restore>Восстановить в баланс</button></section>`:''}\n"
if old not in s: raise SystemExit('legacy card target not found')
s=s.replace(old,new,1)
old="  root.querySelector('[data-finance-legacy-reserve-import]')?.addEventListener('click',importLegacyFinanceReserve);\n"
new=old+"  root.querySelector('[data-finance-legacy-reserve-restore]')?.addEventListener('click',restoreLegacyFinanceReserveBalance);\n"
if old not in s: raise SystemExit('legacy bind target not found')
s=s.replace(old,new,1)
target="    SYSTEM_LOCKED: 'Системную операцию нельзя изменить',\n"
repl=target+"    INVALID_AMOUNT: 'Сумма должна быть больше 0. Если операции не было — удали её.',\n"
if target in s and "INVALID_AMOUNT: 'Сумма должна быть больше 0." not in s:
    s=s.replace(target,repl,1)
p.write_text(s)

p=Path('css/mobile-finance.css')
s=p.read_text()
s += "\n/* Finance transaction actions: explicit edit/delete on every user operation. */\n.finance-v2-operation .finance-v2-operation-actions{display:flex!important;flex:0 0 auto!important;width:auto!important;align-items:center!important;justify-content:flex-end!important;gap:7px!important}.finance-v2-operation .finance-v2-operation-actions button{width:38px!important;min-width:38px!important;max-width:38px!important;height:38px!important;min-height:38px!important;padding:0!important;border-radius:999px!important;display:inline-grid!important;place-items:center!important}.finance-v2-operation .item-top>div:first-child{min-width:0!important}\n"
p.write_text(s)

p=Path('tests/finance-part2-regression.test.cjs')
s=p.read_text()
s += """

test('imported legacy reserve balance can be restored once without creating income',()=>{
  let f=funded(1000);
  f.migration={...f.migration,part2Checkpoint:core.PART2_MIGRATION_CHECKPOINT,legacyReserveStatus:'MIGRATED',legacyReserveAmount:5000};
  f.reserves=[core.normalizeReserve({id:'reserve_legacy_v1',name:'Старый резерв',amount:5000},0)];
  const beforeIncome=f.transactions.filter(x=>x.type==='INCOME').length;
  let r=core.restoreLegacyReserveBalance(f,{accountId:'card',now:'2026-08-08T00:00:00.000Z'});
  assert.equal(r.ok,true);assert.equal(r.restored,true);f=r.finance;
  assert.equal(core.getTotalBalance(f),6000);assert.equal(core.getTotalReservedAmount(f),5000);assert.equal(core.getFreeMoney(f,{fromDate:'2026-08-08'}),1000);
  assert.equal(f.transactions.filter(x=>x.type==='INCOME').length,beforeIncome);
  const repair=f.transactions.find(x=>x.systemKind==='LEGACY_RESERVE_BALANCE');assert.ok(repair);assert.equal(core.isSystemLocked(repair),true);
  r=core.restoreLegacyReserveBalance(f,{accountId:'card',now:'2026-08-08T01:00:00.000Z'});assert.equal(r.restored,false);assert.equal(r.finance.transactions.filter(x=>x.systemKind==='LEGACY_RESERVE_BALANCE').length,1);
});
"""
p.write_text(s)

p=Path('tests/app-static.test.cjs')
s=p.read_text()
s += "\nif(!app.includes('data-finance-v2-delete'))throw new Error('transaction delete action missing');\nif(!app.includes('data-finance-legacy-reserve-restore'))throw new Error('legacy reserve balance repair UI missing');\nif(!app.includes('restoreLegacyReserveBalance'))throw new Error('legacy reserve balance repair core integration missing');\n"
p.write_text(s)

old='0.13.2-finance-planning-deficit-20260808'
new='0.13.3-finance-transaction-control-20260808'
replacements={
 'index.html':[(old,new),('v0.13.2','v0.13.3')],
 'js/update-manager.js':[(old,new),('v0.13.2-finance-planning-deficit','v0.13.3-finance-transaction-control')],
 'service-worker.js':[(old,new)],
 'manifest.json':[(old,new)],
 'tests/app-static.test.cjs':[(old,new),('0.13.2-finance-planning-deficit','0.13.3-finance-transaction-control')],
}
for file,pairs in replacements.items():
    p=Path(file)
    x=p.read_text()
    for a,b in pairs:
        x=x.replace(a,b)
    p.write_text(x)
Path('version.json').write_text('{\n  "release": "0.13.3-finance-transaction-control-20260808",\n  "publishedAt": "2026-08-08T00:43:00+05:00",\n  "cache": "tsb-hub-0.13.3-finance-transaction-control-20260808"\n}\n')
