from pathlib import Path
APP=Path('js/app.js'); CSS=Path('css/mobile-finance.css'); TEST=Path('tests/app-static.test.cjs')
app=APP.read_text(); css=CSS.read_text(); tests=TEST.read_text()

def once(s,old,new,label):
    if old not in s: raise RuntimeError(f'missing anchor: {label}')
    if s.count(old)!=1: raise RuntimeError(f'non-unique anchor: {label} ({s.count(old)})')
    return s.replace(old,new,1)

app=once(app,
"  activeTab: getInitialActiveTab(),\n  expandedSections: {}",
"  activeTab: getInitialActiveTab(),\n  expandedSections: {},\n  financeSubscreen: ''",
'state finance subscreen')

app=once(app,
"function applyFinanceMutation(result, message = '') {\n  if (!result?.ok) {\n    if (typeof showToast === 'function') showToast(result?.error === 'SYSTEM_LOCKED' ? 'Системную операцию нельзя изменить' : 'Не удалось изменить финансы');\n    return false;\n  }",
"function financeMutationErrorText(error) {\n  return ({\n    SYSTEM_LOCKED: 'Системную операцию нельзя изменить',\n    INSUFFICIENT_FREE_MONEY: 'Недостаточно свободных денег',\n    INVALID_RESERVE_AMOUNT: 'Сумма резерва не может быть отрицательной',\n    INVALID_TARGET_AMOUNT: 'Цель должна быть больше нуля',\n    NAME_REQUIRED: 'Укажи название',\n    NO_LEGACY_RESERVE_TO_IMPORT: 'Старый резерв уже обработан или отсутствует'\n  })[error] || 'Не удалось изменить финансы';\n}\nfunction applyFinanceMutation(result, message = '') {\n  if (!result?.ok) {\n    if (typeof showToast === 'function') showToast(financeMutationErrorText(result?.error));\n    return false;\n  }",
'finance error mapping')

anchor="function bindFinanceV2Screen(root) {"
if anchor not in app: raise RuntimeError('bindFinanceV2Screen anchor missing')
reserve_ui=r'''function getFinanceActiveReserves() {
  return TSBFinanceCore.getActiveReserves(getFinanceStateV2());
}
function getFinanceReservedTotal() {
  return TSBFinanceCore.getTotalReservedAmount(getFinanceStateV2());
}
function renderFinanceReserveProgress(reserve) {
  if (!reserve.targetAmount) return '';
  const pct = Math.max(0, Math.min(100, Math.round((Number(reserve.amount || 0) / Number(reserve.targetAmount || 1)) * 100)));
  return `<div class="finance-v2-reserve-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
}
function renderFinanceReserveCard(reserve, { compact = false } = {}) {
  const amountLine = reserve.targetAmount ? `${formatRub(reserve.amount)} / ${formatRub(reserve.targetAmount)}` : formatRub(reserve.amount);
  return `<article class="finance-v2-reserve-card">
    <div class="finance-v2-reserve-main"><div class="item-top"><div><h3>${escapeHTML(reserve.name)}</h3><div class="finance-v2-reserve-amount">${amountLine}</div></div>${compact ? '' : '<span class="badge secondary">резерв</span>'}</div>${renderFinanceReserveProgress(reserve)}</div>
    ${compact ? '' : `<div class="finance-v2-reserve-actions"><button class="ghost-button small" type="button" data-finance-reserve-adjust="${escapeHTML(reserve.id)}" data-direction="add">+ Пополнить</button><button class="ghost-button small" type="button" data-finance-reserve-adjust="${escapeHTML(reserve.id)}" data-direction="remove">− Снять</button><button class="ghost-button small" type="button" data-finance-reserve-edit="${escapeHTML(reserve.id)}">Изм.</button><button class="danger-button small" type="button" data-finance-reserve-archive="${escapeHTML(reserve.id)}">Архив</button></div>`}
  </article>`;
}
function renderFinanceReservesCompact() {
  const reserves = getFinanceActiveReserves();
  const preview = reserves.slice(0, 3);
  return `<section class="card finance-v2-reserves-card">
    <div class="card-title-row"><div><h2>Резервы</h2><p class="muted">Назначение части уже существующих денег.</p></div><span class="badge">${formatRub(getFinanceReservedTotal())}</span></div>
    <div class="finance-v2-reserve-list">${preview.length ? preview.map(item => renderFinanceReserveCard(item,{compact:true})).join('') : '<div class="empty">Резервов пока нет.</div>'}</div>
    <div class="finance-v2-section-actions"><button class="ghost-button" type="button" data-finance-reserves-open>${reserves.length ? 'Все резервы' : 'Управление резервами'}</button><button class="primary-button" type="button" data-finance-reserve-create>+ Создать</button></div>
  </section>`;
}
async function openFinanceReserveDialog(reserveId = '') {
  const finance = getFinanceStateV2();
  const current = finance.reserves.find(item => item.id === reserveId) || null;
  const fields = [
    { name:'name', label:'Название', value:current?.name || '', placeholder:'Машина, Подушка, Техника' },
    ...(current ? [] : [{ name:'amount', label:'Начальная сумма', value:'', placeholder:'0' }]),
    { name:'targetAmount', label:'Цель — необязательно', value:current?.targetAmount || '', placeholder:'Напр. 110000' }
  ];
  const result = await openEditDialog({ title:current ? 'Изменить резерв' : 'Создать резерв', fields, submitText:'Подтвердить' });
  if (!result) return;
  const draft = { name:String(result.name || '').trim(), targetAmount:normalizeMoneyInput(result.targetAmount) || null };
  if (!current) draft.amount = normalizeMoneyInput(result.amount) || 0;
  const mutation = current ? TSBFinanceCore.updateReserve(finance,current.id,draft,{fromDate:toISODate(new Date())}) : TSBFinanceCore.createReserve(finance,draft,{idFactory:uid,fromDate:toISODate(new Date())});
  applyFinanceMutation(mutation,current ? 'Резерв изменён' : 'Резерв создан');
}
async function adjustFinanceReserve(reserveId,direction) {
  const reserve=getFinanceStateV2().reserves.find(item=>item.id===reserveId); if(!reserve)return;
  const adding=direction!=='remove';
  const result=await openEditDialog({title:adding?`Пополнить · ${reserve.name}`:`Снять · ${reserve.name}`,fields:[{name:'amount',label:'Сумма',value:'',placeholder:'Напр. 5000'}],submitText:'Подтвердить'});
  if(!result)return; const amount=moneyNumber(normalizeMoneyInput(result.amount)); if(amount<=0){showToast('Укажи сумму больше нуля');return;}
  applyFinanceMutation(TSBFinanceCore.adjustReserveAmount(getFinanceStateV2(),reserveId,adding?amount:-amount,{fromDate:toISODate(new Date())}),adding?'Резерв пополнен':'Сумма снята из резерва');
}
async function archiveFinanceReserve(reserveId) {
  const reserve=getFinanceStateV2().reserves.find(item=>item.id===reserveId);if(!reserve)return;
  const ok=await openConfirmDialog({title:'Архивировать резерв?',message:`${reserve.name}. Деньги со счетов не изменятся — исчезнет только это назначение.`,confirmText:'Архивировать',danger:true});
  if(!ok)return;applyFinanceMutation(TSBFinanceCore.archiveReserve(getFinanceStateV2(),reserveId),'Резерв архивирован');
}
async function importLegacyFinanceReserve() {
  const finance=getFinanceStateV2(); const amount=finance.migration?.legacyReserveAmount || 0;
  if(finance.migration?.legacyReserveStatus!=='REVIEW_REQUIRED'||!amount)return;
  const ok=await openConfirmDialog({title:'Импортировать старый резерв?',message:`В старых данных найдено ${formatRub(amount)}. Поле исторически могло обозначать не только физический счёт, поэтому оно не переносилось автоматически. Импорт создаст резерв «Старый резерв» и не изменит деньги на счетах.`,confirmText:'Импортировать'});
  if(!ok)return;applyFinanceMutation(TSBFinanceCore.importLegacyReserve(finance,{idFactory:uid}),'Старый резерв импортирован');
}
function renderFinanceReservesScreen(root = $('#tab-finance')) {
  if(!root)return; const finance=getFinanceStateV2(); const active=TSBFinanceCore.getActiveReserves(finance); const legacyReview=finance.migration?.legacyReserveStatus==='REVIEW_REQUIRED'&&Number(finance.migration?.legacyReserveAmount)>0;
  root.innerHTML=`
    <section class="card finance-v2-subscreen-head"><div class="card-title-row"><div><h2>Резервы</h2><p class="muted">Резерв — назначение части денег. Это не расход и не перевод между счетами.</p></div><button class="ghost-button small" type="button" data-finance-subscreen-back>Назад</button></div></section>
    ${legacyReview?`<section class="card finance-v2-legacy-review"><div><h3>Найден старый резерв · ${formatRub(finance.migration.legacyReserveAmount)}</h3><p class="muted">Он не был перенесён автоматически: происхождение старого поля неоднозначно.</p></div><button class="ghost-button" type="button" data-finance-legacy-reserve-import>Импортировать как «Старый резерв»</button></section>`:''}
    <section class="card"><div class="card-title-row"><div><h2>Активные резервы</h2><p class="muted">Всего назначено: ${formatRub(TSBFinanceCore.getTotalReservedAmount(finance))}</p></div><button class="primary-button small" type="button" data-finance-reserve-create>+ Создать</button></div>
      <div class="finance-v2-reserve-list full">${active.length?active.map(item=>renderFinanceReserveCard(item)).join(''):'<div class="empty">Резервов пока нет.</div>'}</div>
    </section>`;
  bindFinanceV2Screen(root);
}

'''
app=app.replace(anchor,reserve_ui+anchor,1)

bind_old="""  root.querySelector('[data-finance-v2-history-open]')?.addEventListener('click', () => { state.financeHistoryOpen = true; renderFinance(); });
}"""
bind_new="""  root.querySelector('[data-finance-v2-history-open]')?.addEventListener('click', () => { state.financeHistoryOpen = true; renderFinance(); });
  root.querySelector('[data-finance-reserves-open]')?.addEventListener('click',()=>{state.financeSubscreen='reserves';renderFinance();});
  root.querySelector('[data-finance-subscreen-back]')?.addEventListener('click',()=>{state.financeSubscreen='';renderFinance();});
  root.querySelectorAll('[data-finance-reserve-create]').forEach(button=>button.onclick=()=>openFinanceReserveDialog());
  root.querySelectorAll('[data-finance-reserve-edit]').forEach(button=>button.onclick=()=>openFinanceReserveDialog(button.dataset.financeReserveEdit));
  root.querySelectorAll('[data-finance-reserve-adjust]').forEach(button=>button.onclick=()=>adjustFinanceReserve(button.dataset.financeReserveAdjust,button.dataset.direction));
  root.querySelectorAll('[data-finance-reserve-archive]').forEach(button=>button.onclick=()=>archiveFinanceReserve(button.dataset.financeReserveArchive));
  root.querySelector('[data-finance-legacy-reserve-import]')?.addEventListener('click',importLegacyFinanceReserve);
}"""
app=once(app,bind_old,bind_new,'reserve screen bindings')

app=once(app,
"  if (state.financeHistoryOpen && typeof renderFinanceHistoryV2 === 'function') { renderFinanceHistoryV2(root); return; }\n  const finance = getFinanceStateV2();",
"  if (state.financeHistoryOpen && typeof renderFinanceHistoryV2 === 'function') { renderFinanceHistoryV2(root); return; }\n  if (state.financeSubscreen === 'reserves') { renderFinanceReservesScreen(root); return; }\n  const finance = getFinanceStateV2();",
'reserve screen dispatch')

recent_anchor="""    <section class=\"card finance-v2-recent-card\">"""
if recent_anchor not in app: raise RuntimeError('recent card anchor missing')
app=app.replace(recent_anchor,"""    ${renderFinanceReservesCompact()}\n\n    <section class=\"card finance-v2-recent-card\">""",1)

css_add=r'''

/* Finance v2 Part 2 — reserves */
.finance-v2-reserves-card,.finance-v2-subscreen-head,.finance-v2-legacy-review{overflow:hidden}
.finance-v2-reserve-list{display:grid;gap:9px;margin-top:10px}
.finance-v2-reserve-list.full{gap:12px}
.finance-v2-reserve-card{display:grid;gap:10px;padding:13px;border:1px solid var(--border);border-radius:16px;background:rgba(255,255,255,.025)}
.finance-v2-reserve-card h3{margin:0 0 4px}
.finance-v2-reserve-amount{font-weight:850;font-size:1rem}
.finance-v2-reserve-progress{height:7px;border-radius:999px;overflow:hidden;background:rgba(148,163,184,.15);margin-top:9px}
.finance-v2-reserve-progress>span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,rgba(139,92,246,.75),rgba(167,139,250,.95))}
.finance-v2-reserve-actions,.finance-v2-section-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.finance-v2-section-actions{margin-top:12px}
.finance-v2-legacy-review{display:grid;gap:10px;border-color:rgba(245,158,11,.34)}
.finance-v2-legacy-review h3{margin:0 0 4px}
@media(min-width:650px){.finance-v2-reserve-actions{grid-template-columns:repeat(4,minmax(0,1fr))}}
'''
if 'Finance v2 Part 2 — reserves' not in css: css+=css_add

test_add=r'''

// Finance v2 Part 2 reserve UI must use the central core API.
assert.ok(app.includes('function renderFinanceReservesScreen'),'reserve management screen missing');
assert.ok(app.includes('data-finance-reserves-open'),'reserve management entry missing');
assert.ok(app.includes('TSBFinanceCore.createReserve'),'reserve create must use finance core');
assert.ok(app.includes('TSBFinanceCore.adjustReserveAmount'),'reserve adjustment must use finance core');
assert.ok(app.includes('TSBFinanceCore.importLegacyReserve'),'legacy reserve import must use finance core');
assert.equal(index.includes('finance-module-v2.js'),false,'Finance Part2 must not introduce an override module');
'''
if 'reserve management screen missing' not in tests: tests+=test_add

APP.write_text(app);CSS.write_text(css);TEST.write_text(tests);print('Finance v2 Part2 stage C applied')
