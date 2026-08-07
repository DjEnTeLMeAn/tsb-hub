from pathlib import Path
import json,re

app_path=Path('js/app.js')
index_path=Path('index.html')
package_path=Path('package.json')
static_test_path=Path('tests/app-static.test.cjs')
app=app_path.read_text()
index=index_path.read_text()

def function_range(source,name):
    token=f'function {name}('
    start=source.find(token)
    if start<0: raise RuntimeError(f'Function not found: {name}')
    brace=source.find('{',start+len(token))
    if brace<0: raise RuntimeError(f'Function brace not found: {name}')
    depth=0; quote=None; esc=False; line=False; block=False; i=brace
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
    raise RuntimeError(f'Function end not found: {name}')

def replace_function(source,name,code):
    a,b=function_range(source,name)
    return source[:a]+code.strip()+source[b:]

def insert_before_function(source,name,code):
    a,_=function_range(source,name)
    return source[:a]+code.strip()+'\n\n'+source[a:]

if 'function getFinanceStateV2()' in app:
    print('Stage D already applied')
    raise SystemExit(0)

app=replace_function(app,'createDefaultData',r'''
function createDefaultData() {
  const now = new Date().toISOString();
  return {
    meta: {
      appVersion: APP_VERSION,
      dataVersion: 3,
      createdAt: now,
      lastModified: now,
      lastExported: '',
      deviceId: getOrCreateDeviceId(),
      changeCounter: 0
    },
    tasks: {},
    health: {},
    dailyReports: {},
    finance: TSBFinanceCore.createEmptyFinance(now),
    financeContext: {
      availableBalance: '',
      reserveBalance: '',
      savingGoal: '',
      incomes: [],
      obligations: [],
      operations: [],
      financeV2Legacy: true
    },
    gptPlans: {},
    importantDates: [],
    settings: {
      hideDone: false,
      showSelectedDayOnly: false,
      showOverdueOnToday: true,
      pastTasksWindowDays: 14,
      theme: 'dark',
      migratedFromOldStorage: false
    },
    archives: {}
  };
}
''')

app=replace_function(app,'loadData',r'''
function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const normalized = normalizeData(JSON.parse(raw));
      saveData(normalized, false);
      return normalized;
    } catch (error) {
      console.warn('Не удалось прочитать хранилище, создана пустая база.', error);
    }
  }
  const data = createDefaultData();
  migrateOldLocalStorage(data);
  const normalized = normalizeData(data);
  saveData(normalized, false);
  return normalized;
}
''')

app=replace_function(app,'normalizeData',r'''
function normalizeData(data) {
  const defaults = createDefaultData();
  data = data || {};
  if (!data.meta) data.meta = {};
  const now = new Date().toISOString();
  const migration = TSBFinanceCore.migrateLegacyState({
    finance: data.finance,
    financeContext: data.financeContext,
    archives: data.archives,
    now,
    idFactory: uid
  });
  let finance = migration.finance;
  if (!finance.accounts.length) {
    const created = TSBFinanceCore.createAccount(finance, { id: 'account_main', name: 'Основной счёт', isDefault: true }, { now, idFactory: uid });
    if (created.ok) finance = created.finance;
  }
  return {
    ...defaults,
    ...data,
    meta: { ...defaults.meta, ...(data.meta || {}), appVersion: APP_VERSION, dataVersion: 3 },
    tasks: data.tasks || {},
    health: data.health || {},
    dailyReports: normalizeDailyReports(data.dailyReports),
    finance,
    financeContext: normalizeFinanceContext(migration.financeContext),
    gptPlans: normalizeGptPlans(data.gptPlans),
    importantDates: Array.isArray(data.importantDates) ? data.importantDates : [],
    settings: { ...defaults.settings, ...(data.settings || {}) },
    archives: migration.archives || {}
  };
}
''')

app=replace_function(app,'normalizeFinance',r'''
function normalizeFinance(value) {
  return TSBFinanceCore.normalizeFinance(value);
}
''')

helpers=r'''
function getFinanceStateV2() {
  app.finance = TSBFinanceCore.normalizeFinance(app.finance);
  return app.finance;
}
function setFinanceStateV2(finance) {
  app.finance = TSBFinanceCore.normalizeFinance(finance);
  return app.finance;
}
function getFinanceAccounts(includeArchived = false) {
  return getFinanceStateV2().accounts.filter(account => includeArchived || (!account.archived && account.active));
}
function getDefaultFinanceAccount() {
  return TSBFinanceCore.getDefaultAccount(getFinanceStateV2());
}
function getFinanceAccountBalance(accountId) {
  return TSBFinanceCore.getAccountBalance(getFinanceStateV2(), accountId);
}
function getFinanceTotalBalance() {
  return TSBFinanceCore.getTotalBalance(getFinanceStateV2());
}
function getFinanceTransactions(filters = {}) {
  return TSBFinanceCore.getTransactions(getFinanceStateV2(), filters);
}
function getFinanceTransaction(id) {
  return getFinanceStateV2().transactions.find(transaction => transaction.id === id) || null;
}
function getFinanceCategoryById(id) {
  return getFinanceStateV2().categories.find(item => item.id === id) || getFinanceStateV2().categories.find(item => item.id === 'other') || null;
}
function getFinanceIncomeTypeById(id) {
  return getFinanceStateV2().incomeTypes.find(item => item.id === id) || getFinanceStateV2().incomeTypes.find(item => item.id === 'other') || null;
}
function financeCategoryOptions(selected = '') {
  return getFinanceStateV2().categories.filter(item => item.active && !item.archived).map(item => ({ value: item.id, label: item.name, selected: item.id === selected }));
}
function financeIncomeTypeOptions(selected = '') {
  return getFinanceStateV2().incomeTypes.filter(item => item.active && !item.archived).map(item => ({ value: item.id, label: item.name, selected: item.id === selected }));
}
function financeAccountOptions(selected = '') {
  return getFinanceAccounts().map(account => ({ value: account.id, label: account.name, selected: account.id === selected }));
}
function financeOptionHTML(options, selected = '') {
  return options.map(item => `<option value="${escapeHTML(item.value)}" ${String(item.value) === String(selected) ? 'selected' : ''}>${escapeHTML(item.label)}</option>`).join('');
}
function applyFinanceMutation(result, message = '') {
  if (!result?.ok) {
    if (typeof showToast === 'function') showToast(result?.error === 'SYSTEM_LOCKED' ? 'Системную операцию нельзя изменить' : 'Не удалось изменить финансы');
    return false;
  }
  setFinanceStateV2(result.finance);
  markChanged();
  if (message && typeof showToast === 'function') showToast(message);
  return true;
}
function financeTransactionLegacyView(transaction) {
  return {
    id: transaction.id,
    amount: String(transaction.amount),
    category: transaction.categoryId || 'other',
    reason: '',
    comment: transaction.description || '',
    detail: transaction.description || '',
    time: transaction.time || '',
    createdAt: transaction.createdAt || '',
    updatedAt: transaction.updatedAt || ''
  };
}
async function openFinanceV2TransactionEditor(id) {
  const transaction = getFinanceTransaction(id);
  if (!transaction || TSBFinanceCore.isSystemLocked(transaction)) return;
  const accounts = financeAccountOptions(transaction.accountId || transaction.fromAccountId || '');
  let fields = [];
  if (transaction.type === 'EXPENSE') {
    fields = [
      { name: 'amount', label: 'Сумма', value: transaction.amount },
      { name: 'categoryId', label: 'Категория', type: 'select', value: transaction.categoryId, options: financeCategoryOptions(transaction.categoryId) },
      { name: 'description', label: 'Описание', type: 'textarea', value: transaction.description || '', placeholder: 'Необязательно' },
      { name: 'time', label: 'Время', type: 'time', value: transaction.time || '' },
      { name: 'accountId', label: 'Счёт', type: 'select', value: transaction.accountId, options: accounts }
    ];
  } else if (transaction.type === 'INCOME') {
    fields = [
      { name: 'amount', label: 'Сумма', value: transaction.amount },
      { name: 'incomeTypeId', label: 'Тип поступления', type: 'select', value: transaction.incomeTypeId, options: financeIncomeTypeOptions(transaction.incomeTypeId) },
      { name: 'description', label: 'Описание', type: 'textarea', value: transaction.description || '', placeholder: 'Необязательно' },
      { name: 'time', label: 'Время', type: 'time', value: transaction.time || '' },
      { name: 'accountId', label: 'Счёт', type: 'select', value: transaction.accountId, options: accounts }
    ];
  } else if (transaction.type === 'TRANSFER') {
    fields = [
      { name: 'amount', label: 'Сумма', value: transaction.amount },
      { name: 'fromAccountId', label: 'Откуда', type: 'select', value: transaction.fromAccountId, options: financeAccountOptions(transaction.fromAccountId) },
      { name: 'toAccountId', label: 'Куда', type: 'select', value: transaction.toAccountId, options: financeAccountOptions(transaction.toAccountId) },
      { name: 'date', label: 'Дата', type: 'date', value: transaction.date },
      { name: 'time', label: 'Время', type: 'time', value: transaction.time || '' }
    ];
  } else {
    return;
  }
  const result = await openEditDialog({ title: transaction.type === 'EXPENSE' ? 'Изменить трату' : transaction.type === 'INCOME' ? 'Изменить поступление' : 'Изменить перевод', fields, submitText: 'Подтвердить' });
  if (!result) return;
  const patch = { ...result };
  if (patch.amount !== undefined) patch.amount = normalizeMoneyInput(patch.amount);
  applyFinanceMutation(TSBFinanceCore.updateTransaction(getFinanceStateV2(), id, patch), 'Операция изменена');
}
async function deleteFinanceV2Transaction(id) {
  const transaction = getFinanceTransaction(id);
  if (!transaction || TSBFinanceCore.isSystemLocked(transaction)) return;
  const ok = await openConfirmDialog({ title: 'Удалить операцию?', message: 'Её влияние на баланс будет полностью отменено.', confirmText: 'Подтвердить', danger: true });
  if (!ok) return;
  applyFinanceMutation(TSBFinanceCore.deleteTransaction(getFinanceStateV2(), id), 'Операция удалена');
}
function bindFinanceV2GlobalEvents() {
  if (window.__tsbFinanceV2EventsBound) return;
  window.__tsbFinanceV2EventsBound = true;
  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-finance-v2-expense-form]');
    if (!form) return;
    event.preventDefault();
    const fd = new FormData(form);
    const amount = normalizeMoneyInput(fd.get('amount'));
    const account = getDefaultFinanceAccount();
    if (!amount || !account) return;
    const now = new Date();
    const date = form.dataset.date || state.selectedDate || toISODate(now);
    const transaction = {
      type: 'EXPENSE', amount, accountId: account.id,
      categoryId: normalizeFinanceCategory(fd.get('categoryId')),
      date, time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      description: ''
    };
    const result = TSBFinanceCore.createTransaction(getFinanceStateV2(), transaction, { idFactory: uid });
    if (applyFinanceMutation(result, 'Трата добавлена')) form.reset();
  });
  document.addEventListener('click', event => {
    const quick = event.target.closest?.('[data-finance-v2-quick-category]');
    if (quick) {
      const form = quick.closest('.today-input-card, .card')?.querySelector('[data-finance-v2-expense-form]');
      const select = form?.querySelector('[name="categoryId"]');
      if (select) select.value = quick.dataset.financeV2QuickCategory;
      return;
    }
    const edit = event.target.closest?.('[data-finance-v2-edit]');
    if (edit) { event.preventDefault(); openFinanceV2TransactionEditor(edit.dataset.financeV2Edit); return; }
    const del = event.target.closest?.('[data-finance-v2-delete]');
    if (del) { event.preventDefault(); deleteFinanceV2Transaction(del.dataset.financeV2Delete); }
  });
}
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', bindFinanceV2GlobalEvents);
  bindFinanceV2GlobalEvents();
}
'''
app=insert_before_function(app,'getFinance',helpers)

app=replace_function(app,'getFinance',r'''
function getFinance(iso = state.selectedDate) {
  return {
    noExpenses: false,
    expenses: getFinanceTransactions({ type: 'EXPENSE', dateFrom: iso, dateTo: iso }).map(financeTransactionLegacyView)
  };
}
''')
app=replace_function(app,'normalizeFinanceCategory',r'''
function normalizeFinanceCategory(value) {
  const id = String(value || '').trim();
  return getFinanceStateV2().categories.some(item => item.id === id && !item.archived) ? id : 'other';
}
''')
app=replace_function(app,'getFinanceCategoryLabel',r'''
function getFinanceCategoryLabel(value) {
  return getFinanceCategoryById(value)?.name || 'Другое';
}
''')
app=replace_function(app,'getFinanceSummary',r'''
function getFinanceSummary(iso = state.selectedDate) {
  const expenses = getFinanceTransactions({ type: 'EXPENSE', dateFrom: iso, dateTo: iso });
  const total = expenses.reduce((sum, item) => sum + moneyNumber(item.amount), 0);
  const food = expenses.filter(item => item.categoryId === 'food').reduce((sum, item) => sum + moneyNumber(item.amount), 0);
  const transport = expenses.filter(item => item.categoryId === 'transport').reduce((sum, item) => sum + moneyNumber(item.amount), 0);
  const other = Math.max(0, total - food - transport);
  return { total, food, transport, other, impulse: 0, count: expenses.length };
}
''')
app=replace_function(app,'renderFinanceNoExpensesButton',r'''
function renderFinanceNoExpensesButton() {
  return '';
}
''')
app=replace_function(app,'renderFinanceQuickForm',r'''
function renderFinanceQuickForm(scope) {
  const categories = financeOptionHTML(financeCategoryOptions(), 'food');
  return `
    <form class="form-grid finance" data-finance-v2-expense-form data-scope="${escapeHTML(scope)}" data-date="${escapeHTML(state.selectedDate)}">
      <label>Сумма, ₽<input name="amount" required inputmode="decimal" placeholder="Напр. 250"></label>
      <label>Категория<select name="categoryId">${categories}</select></label>
      <button class="primary-button" type="submit">Добавить</button>
    </form>
    <div class="quick-category-row" aria-label="Быстрые категории">
      ${[['food','Еда'],['transport','Транспорт'],['home','Дом'],['health','Здоровье']].map(([id,name]) => `<button class="ghost-button small" type="button" data-finance-v2-quick-category="${id}">+ ${name}</button>`).join('')}
    </div>
  `;
}
''')
app=replace_function(app,'renderFinanceList',r'''
function renderFinanceList(iso, compact = false) {
  const expenses = getFinanceTransactions({ type: 'EXPENSE', dateFrom: iso, dateTo: iso });
  if (!expenses.length) return '<div class="empty">Трат пока нет.</div>';
  const visible = compact ? expenses.slice(0, 4) : expenses;
  return visible.map(transaction => renderFinanceCard(transaction, compact)).join('') + (compact && expenses.length > 4 ? '<div class="muted finance-summary-line">Показаны последние 4 записи.</div>' : '');
}
''')
app=replace_function(app,'renderFinanceCard',r'''
function renderFinanceCard(transaction, compact = false) {
  return `
    <article class="finance-card" data-finance-transaction-id="${escapeHTML(transaction.id)}">
      <div class="item-top">
        <div>
          <div class="badge-row">
            <span class="badge important">${escapeHTML(getFinanceCategoryLabel(transaction.categoryId))}</span>
            ${transaction.time ? `<span class="badge">${escapeHTML(transaction.time)}</span>` : ''}
          </div>
          <h3>${formatRub(transaction.amount)}</h3>
          ${transaction.description ? `<p class="muted">${escapeHTML(transaction.description)}</p>` : ''}
        </div>
        <div class="actions">
          <button class="ghost-button" type="button" data-finance-v2-edit="${escapeHTML(transaction.id)}">Изм.</button>
          <button class="danger-button" type="button" data-finance-v2-delete="${escapeHTML(transaction.id)}">Удал.</button>
        </div>
      </div>
    </article>
  `;
}
''')

old_decl="  const financeContext = getFinanceContext();\n  const nextIncome = getNextIncome();"
if old_decl not in app: raise RuntimeError('Today finance declarations not found')
app=app.replace(old_decl,"  const financeAccount = getDefaultFinanceAccount();\n  const financeAccountBalance = financeAccount ? getFinanceAccountBalance(financeAccount.id) : 0;",1)
pattern=re.compile(r'<div class="finance-summary-line">Доступно: \$\{financeContext\.availableBalance[\s\S]*?</div>')
if not pattern.search(app): raise RuntimeError('Today legacy finance summary not found')
app=pattern.sub('<div class="finance-summary-line">${financeAccount ? `${escapeHTML(financeAccount.name)}: ${formatRub(financeAccountBalance)}` : \'Счёт не создан\'}</div>',app,count=1)

if 'js/finance-core.js' not in index:
    index=re.sub(r'(\s*<script defer src="js/app\.js\?v=[^"]+"></script>)',r'\n  <script defer src="js/finance-core.js?v=0.10.8-modal-actions-20260807"></script>\1',index,count=1)

pkg=json.loads(package_path.read_text())
pkg['scripts']['lint']='node --check js/finance-core.js && node --check js/app.js'
pkg['scripts']['build']='node tests/app-static.test.cjs'
package_path.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')

static_test_path.write_text(r'''const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('js/app.js','utf8');
const index=fs.readFileSync('index.html','utf8');
assert.ok(index.indexOf('js/finance-core.js')<index.indexOf('js/app.js'),'finance core must load before app');
assert.ok(app.includes('migrateLegacyState'),'app must invoke Finance v2 migration');
assert.ok(app.includes('data-finance-v2-expense-form'),'Today must use Finance v2 quick input');
assert.ok(fs.readFileSync('js/finance-core.js','utf8').includes('MIGRATION_ANCHOR'),'migration anchor contract missing');
console.log('Static app build check passed');
''')

app_path.write_text(app)
index_path.write_text(index)
print('Stage D applied')
