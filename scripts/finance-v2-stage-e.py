from pathlib import Path
import re,json

APP=Path('js/app.js'); INDEX=Path('index.html'); CSS=Path('css/mobile-finance.css'); TEST=Path('tests/app-static.test.cjs')
app=APP.read_text(); index=INDEX.read_text(); css=CSS.read_text(); tests=TEST.read_text()

def function_range(source,name):
    token=f'function {name}('
    start=source.find(token)
    if start<0: raise RuntimeError(f'Function not found: {name}')
    brace=source.find('{',start+len(token)); depth=0; quote=None; esc=False; line=False; block=False; i=brace
    while i<len(source):
        c=source[i]; n=source[i+1] if i+1<len(source) else ''
        if line:
            if c=='\n': line=False
            i+=1; continue
        if block:
            if c=='*' and n=='/': block=False; i+=2; continue
            i+=1; continue
        if quote:
            if esc: esc=False; i+=1; continue
            if c=='\\': esc=True; i+=1; continue
            if c==quote: quote=None
            i+=1; continue
        if c=='/' and n=='/': line=True; i+=2; continue
        if c=='/' and n=='*': block=True; i+=2; continue
        if c in ('"',"'",'`'): quote=c; i+=1; continue
        if c=='{': depth+=1
        elif c=='}':
            depth-=1
            if depth==0: return start,i+1
        i+=1
    raise RuntimeError(f'End not found: {name}')

def replace_function(source,name,code):
    a,b=function_range(source,name); return source[:a]+code.strip()+source[b:]
def insert_before(source,name,code):
    a,_=function_range(source,name); return source[:a]+code.strip()+'\n\n'+source[a:]

if 'function renderFinanceV2AccountCard' in app:
    print('Stage E already applied'); raise SystemExit(0)

helpers=r'''
function financeTypeLabel(transaction) {
  if (transaction.type === 'EXPENSE') return getFinanceCategoryLabel(transaction.categoryId);
  if (transaction.type === 'INCOME') return getFinanceIncomeTypeById(transaction.incomeTypeId)?.name || 'Поступление';
  if (transaction.type === 'TRANSFER') return 'Перевод';
  return 'Корректировка';
}
function financeSignedAmount(transaction) {
  const amount = moneyNumber(transaction.amount);
  if (transaction.type === 'EXPENSE') return `−${formatRub(amount)}`;
  if (transaction.type === 'INCOME') return `+${formatRub(amount)}`;
  if (transaction.type === 'TRANSFER') return formatRub(amount);
  return `${amount > 0 ? '+' : ''}${formatRub(amount)}`;
}
function financeTransactionTone(transaction) {
  return transaction.type === 'EXPENSE' ? 'expense' : transaction.type === 'INCOME' ? 'income' : transaction.type === 'TRANSFER' ? 'transfer' : 'adjustment';
}
function renderFinanceV2AccountCard(account) {
  const balance = getFinanceAccountBalance(account.id);
  return `<article class="finance-v2-account ${account.isDefault ? 'default' : ''}">
    <div><div class="badge-row">${account.isDefault ? '<span class="badge important">по умолчанию</span>' : ''}${account.type ? `<span class="badge secondary">${escapeHTML(account.type)}</span>` : ''}</div><h3>${escapeHTML(account.name)}</h3><div class="finance-v2-account-balance">${formatRub(balance)}</div></div>
    <div class="actions"><button class="ghost-button" type="button" data-finance-v2-account-edit="${escapeHTML(account.id)}">Изм.</button>${getFinanceAccounts().length > 1 ? `<button class="danger-button" type="button" data-finance-v2-account-archive="${escapeHTML(account.id)}">Удал.</button>` : ''}</div>
  </article>`;
}
function renderFinanceV2TransactionRow(transaction, options = {}) {
  const compact = options.compact !== false;
  const account = getFinanceStateV2().accounts.find(item => item.id === transaction.accountId);
  const from = getFinanceStateV2().accounts.find(item => item.id === transaction.fromAccountId);
  const to = getFinanceStateV2().accounts.find(item => item.id === transaction.toAccountId);
  const accountText = transaction.type === 'TRANSFER' ? `${from?.name || '—'} → ${to?.name || '—'}` : (account?.name || '');
  return `<article class="finance-card finance-v2-operation ${financeTransactionTone(transaction)}" data-finance-v2-open="${escapeHTML(transaction.id)}">
    <div class="item-top"><div><div class="badge-row"><span class="badge ${transaction.type === 'EXPENSE' ? 'important' : 'secondary'}">${escapeHTML(financeTypeLabel(transaction))}</span>${transaction.time ? `<span class="badge">${escapeHTML(transaction.time)}</span>` : ''}</div><h3>${financeSignedAmount(transaction)}</h3>${transaction.description ? `<p class="muted">${escapeHTML(transaction.description)}</p>` : ''}${accountText ? `<p class="muted finance-v2-account-note">${escapeHTML(accountText)}</p>` : ''}</div>
    ${compact ? '<span class="finance-v2-chevron">›</span>' : `<div class="actions"><button class="ghost-button" type="button" data-finance-v2-edit="${escapeHTML(transaction.id)}">Изм.</button><button class="danger-button" type="button" data-finance-v2-delete="${escapeHTML(transaction.id)}">Удал.</button></div>`}</div>
  </article>`;
}
async function openFinanceV2AccountDialog(accountId = '') {
  const finance = getFinanceStateV2();
  const current = finance.accounts.find(item => item.id === accountId) || null;
  const result = await openEditDialog({
    title: current ? 'Изменить счёт' : 'Новый счёт',
    fields: [
      { name: 'name', label: 'Название', value: current?.name || '', placeholder: 'Т-Банк, Сбер, Наличные' },
      { name: 'type', label: 'Тип', type: 'select', value: current?.type || '', options: [
        { value: '', label: 'Не указывать' }, { value: 'Банк', label: 'Банк' }, { value: 'Наличные', label: 'Наличные' }, { value: 'Накопительный', label: 'Накопительный' }, { value: 'Другое', label: 'Другое' }
      ]},
      { name: 'isDefault', label: 'Использовать по умолчанию', type: 'select', value: current?.isDefault ? 'yes' : 'no', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да' }] }
    ], submitText: 'Подтвердить'
  });
  if (!result || !String(result.name || '').trim()) return;
  const draft = { name: String(result.name).trim(), type: String(result.type || ''), isDefault: result.isDefault === 'yes' };
  const mutation = current ? TSBFinanceCore.updateAccount(finance, current.id, draft) : TSBFinanceCore.createAccount(finance, draft, { idFactory: uid });
  applyFinanceMutation(mutation, current ? 'Счёт изменён' : 'Счёт добавлен');
}
async function archiveFinanceV2Account(accountId) {
  const account = getFinanceStateV2().accounts.find(item => item.id === accountId); if (!account) return;
  const ok = await openConfirmDialog({ title: 'Архивировать счёт?', message: `${account.name}. Операции сохранятся в истории.`, confirmText: 'Подтвердить', danger: true });
  if (!ok) return;
  applyFinanceMutation(TSBFinanceCore.archiveAccount(getFinanceStateV2(), accountId), 'Счёт архивирован');
}
async function openFinanceV2IncomeDialog() {
  const account = getDefaultFinanceAccount(); if (!account) return;
  const now = new Date(); const today = toISODate(now); const hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const result = await openEditDialog({ title: 'Добавить поступление', fields: [
    { name: 'amount', label: 'Сумма', value: '', placeholder: 'Напр. 35000' },
    { name: 'incomeTypeId', label: 'Тип поступления', type: 'select', value: 'personal', options: financeIncomeTypeOptions('personal') },
    { name: 'accountId', label: 'Счёт', type: 'select', value: account.id, options: financeAccountOptions(account.id) },
    { name: 'description', label: 'Описание', type: 'textarea', value: '', placeholder: 'Необязательно' },
    { name: 'date', label: 'Дата', type: 'date', value: today },
    { name: 'time', label: 'Время', type: 'time', value: hm }
  ], submitText: 'Подтвердить' });
  if (!result) return;
  const amount = normalizeMoneyInput(result.amount); const date = normalizeDateInput(result.date) || today;
  if (!amount) return;
  applyFinanceMutation(TSBFinanceCore.createTransaction(getFinanceStateV2(), { type:'INCOME', amount, incomeTypeId:result.incomeTypeId, accountId:result.accountId, description:result.description, date, time:result.time }, { idFactory:uid }), 'Поступление добавлено');
}
async function openFinanceV2TransferDialog() {
  const accounts = getFinanceAccounts(); if (accounts.length < 2) { showToast('Для перевода нужно минимум два счёта'); return; }
  const now = new Date(); const today = toISODate(now); const hm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const result = await openEditDialog({ title: 'Перевод между счетами', fields: [
    { name:'amount', label:'Сумма', value:'', placeholder:'Напр. 5000' },
    { name:'fromAccountId', label:'Откуда', type:'select', value:accounts[0].id, options:financeAccountOptions(accounts[0].id) },
    { name:'toAccountId', label:'Куда', type:'select', value:accounts[1].id, options:financeAccountOptions(accounts[1].id) },
    { name:'date', label:'Дата', type:'date', value:today },
    { name:'time', label:'Время', type:'time', value:hm }
  ], submitText:'Подтвердить' });
  if (!result) return;
  const amount=normalizeMoneyInput(result.amount); const date=normalizeDateInput(result.date)||today; if(!amount) return;
  const mutation=TSBFinanceCore.createTransaction(getFinanceStateV2(), { type:'TRANSFER', amount, fromAccountId:result.fromAccountId, toAccountId:result.toAccountId, date, time:result.time }, { idFactory:uid });
  if (!mutation.ok && mutation.error==='TRANSFER_FIELDS') { showToast('Выбери разные счета'); return; }
  applyFinanceMutation(mutation,'Перевод добавлен');
}
function bindFinanceV2Screen(root) {
  root.querySelector('[data-finance-v2-account-add]')?.addEventListener('click', () => openFinanceV2AccountDialog());
  root.querySelectorAll('[data-finance-v2-account-edit]').forEach(button => button.onclick = () => openFinanceV2AccountDialog(button.dataset.financeV2AccountEdit));
  root.querySelectorAll('[data-finance-v2-account-archive]').forEach(button => button.onclick = () => archiveFinanceV2Account(button.dataset.financeV2AccountArchive));
  root.querySelector('[data-finance-v2-income-add]')?.addEventListener('click', openFinanceV2IncomeDialog);
  root.querySelector('[data-finance-v2-transfer-add]')?.addEventListener('click', openFinanceV2TransferDialog);
  root.querySelectorAll('[data-finance-v2-open]').forEach(row => row.onclick = event => { if (event.target.closest('button')) return; openFinanceV2TransactionEditor(row.dataset.financeV2Open); });
  root.querySelector('[data-finance-v2-history-open]')?.addEventListener('click', () => { state.financeHistoryOpen = true; renderFinance(); });
}
'''
app=insert_before(app,'renderFinance',helpers)

app=replace_function(app,'renderFinance',r'''
function renderFinance() {
  const root = $('#tab-finance');
  if (!root) return;
  if (state.financeHistoryOpen && typeof renderFinanceHistoryV2 === 'function') { renderFinanceHistoryV2(root); return; }
  const finance = getFinanceStateV2();
  const accounts = getFinanceAccounts();
  const recent = getFinanceTransactions().slice(0, 8);
  root.innerHTML = `
    <section class="card finance-v2-hero">
      <div class="card-title-row"><div><h2>Финансы</h2><p class="muted">Общий баланс всех активных счетов.</p></div></div>
      <div class="finance-v2-total">${formatRub(getFinanceTotalBalance())}</div>
      <div class="finance-v2-primary-actions"><button class="primary-button" type="button" data-finance-v2-income-add>+ Поступление</button><button class="ghost-button" type="button" data-finance-v2-transfer-add>Перевод</button></div>
    </section>

    <section class="card finance-v2-accounts-card">
      <div class="card-title-row"><div><h2>Счета</h2><p class="muted">Обычные траты идут со счёта по умолчанию.</p></div><button class="ghost-button small" type="button" data-finance-v2-account-add>+ Счёт</button></div>
      <div class="finance-v2-accounts">${accounts.map(renderFinanceV2AccountCard).join('') || '<div class="empty">Счетов пока нет.</div>'}</div>
    </section>

    <section class="card finance-v2-recent-card">
      <div class="card-title-row"><div><h2>Последние операции</h2><p class="muted">Последние расходы, поступления и переводы.</p></div></div>
      <div class="finance-list">${recent.length ? recent.map(transaction => renderFinanceV2TransactionRow(transaction)).join('') : '<div class="empty">Операций пока нет.</div>'}</div>
      <button class="ghost-button finance-v2-history-button" type="button" data-finance-v2-history-open>Вся история</button>
    </section>
  `;
  bindFinanceV2Screen(root);
}
''')

# finance-module-v1 must no longer be loaded
index=re.sub(r'\s*<script defer src="js/finance-module-v1\.js\?v=[^"]+"></script>','',index)

marker='/* Finance v2 Part 1 — accounts and recent operations */'
if marker not in css:
    css += r'''

/* Finance v2 Part 1 — accounts and recent operations */
.finance-v2-hero,.finance-v2-accounts-card,.finance-v2-recent-card{overflow:hidden}
.finance-v2-total{font-size:clamp(2rem,9vw,3.25rem);font-weight:900;letter-spacing:-.045em;margin:8px 0 16px}
.finance-v2-primary-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.finance-v2-accounts{display:grid;gap:10px;margin-top:10px}
.finance-v2-account{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border:1px solid var(--border);border-radius:16px;background:rgba(255,255,255,.025)}
.finance-v2-account.default{border-color:rgba(139,92,246,.36);background:rgba(139,92,246,.055)}
.finance-v2-account h3{margin:5px 0 2px}
.finance-v2-account-balance{font-size:1.1rem;font-weight:850}
.finance-v2-account-note{font-size:.78rem;margin-top:4px!important}
.finance-v2-operation{cursor:pointer;transition:transform .12s ease,border-color .12s ease}
.finance-v2-operation:active{transform:scale(.995)}
.finance-v2-operation.income h3{color:#86efac}
.finance-v2-operation.expense h3{color:#fca5a5}
.finance-v2-operation.transfer h3{color:#c4b5fd}
.finance-v2-chevron{font-size:1.6rem;opacity:.45;align-self:center}
.finance-v2-history-button{width:100%;margin-top:12px}
@media(max-width:560px){.finance-v2-primary-actions{grid-template-columns:1fr 1fr}.finance-v2-account{align-items:flex-start}.finance-v2-account .actions{flex-shrink:0}}
'''

if "finance-module-v1.js" not in tests:
    tests += "\nassert.equal(index.includes('finance-module-v1.js'),false,'Finance v1 override must not be loaded');\nassert.ok(app.includes('function renderFinanceV2AccountCard'),'Finance v2 accounts UI missing');\nassert.ok(app.includes('Последние операции'),'Finance v2 recent operations missing');\n"

APP.write_text(app); INDEX.write_text(index); CSS.write_text(css); TEST.write_text(tests)
print('Stage E applied')
