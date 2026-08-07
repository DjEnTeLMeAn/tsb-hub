from pathlib import Path
APP=Path('js/app.js'); CSS=Path('css/mobile-finance.css'); TEST=Path('tests/app-static.test.cjs')
app=APP.read_text(); css=CSS.read_text(); tests=TEST.read_text()

def once(s,old,new,label):
    if old not in s: raise RuntimeError(f'missing anchor: {label}')
    if s.count(old)!=1: raise RuntimeError(f'non-unique anchor: {label} ({s.count(old)})')
    return s.replace(old,new,1)

app=once(app,
"function getFinanceTotalBalance() {\n  return TSBFinanceCore.getTotalBalance(getFinanceStateV2());\n}\nfunction getFinanceTransactions(filters = {}) {",
"function getFinanceTotalBalance() {\n  return TSBFinanceCore.getTotalBalance(getFinanceStateV2());\n}\nfunction getFinanceFreeMoney() {\n  return TSBFinanceCore.getFreeMoney(getFinanceStateV2(), { fromDate: toISODate(new Date()) });\n}\nfunction getFinanceCoverage() {\n  return TSBFinanceCore.getObligationCoverage(getFinanceStateV2(), { fromDate: toISODate(new Date()) });\n}\nfunction getFinanceTransactions(filters = {}) {",
'free money wrappers')

# Remove obsolete local-insight calculations based on legacy planned financeContext.
legacy_block="""  const context = getFinanceContext();
  const balance = getFinanceTotalBalance();
  const selectedIsFuture = iso > todayISO;
  const selectedIsTodayOrPast = iso <= todayISO;
  const pendingTasks = tasks.filter(task => !task.done && !task.failed && !task.dismissed).length;
  const impulseCount = finance.expenses.filter(item => ['impulse', 'stress', 'tired', 'lazy', 'reward'].includes(item.reason)).length;
  const upcomingObligations = getUpcomingPlanItems(context.obligations, 10);
  const weekObligations = upcomingObligations.filter(item => !item.date || item.date <= addDays(todayISO, 7));
  const weekObligationTotal = weekObligations.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const upcomingIncomes = getUpcomingPlanItems(context.incomes, 10);
  const weekIncomes = upcomingIncomes.filter(item => !item.date || item.date <= addDays(todayISO, 7));
  const weekIncomeTotal = weekIncomes.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const nextIncome = getNextIncome();
  const week = getWeekDataSummary(iso);
  const netAfterPlans = balance + weekIncomeTotal - weekObligationTotal;
"""
new_block="""  const selectedIsFuture = iso > todayISO;
  const selectedIsTodayOrPast = iso <= todayISO;
  const pendingTasks = tasks.filter(task => !task.done && !task.failed && !task.dismissed).length;
  const impulseCount = finance.expenses.filter(item => ['impulse', 'stress', 'tired', 'lazy', 'reward'].includes(item.reason)).length;
  const financeCoverage = getFinanceCoverage();
  const week = getWeekDataSummary(iso);
"""
app=once(app,legacy_block,new_block,'remove legacy insight finance math')

# Add one useful finance diagnostic from the same core selector.
insight_anchor="""  if (week.activeImportant > 0) {
    insights.push({ tone: 'soft', title: 'На неделе есть важные даты', text: `Активных важных дат на этой неделе: ${week.activeImportant}. Их стоит учесть в задачах и деньгах.` });
  }
"""
insight_new=insight_anchor+"""
  if (!financeCoverage.covered) {
    insights.push({ tone: 'warn', title: 'Назначено больше денег, чем сейчас есть', text: `Свободно ${formatRub(financeCoverage.free)}. Не хватает ${formatRub(financeCoverage.shortfall)} с учётом резервов и обязательных платежей.` });
  }
"""
app=once(app,insight_anchor,insight_new,'negative free insight')

# Money-now renderer inserted before reserve helpers.
anchor="function getFinanceActiveReserves() {"
if anchor not in app: raise RuntimeError('reserve helpers anchor missing')
money_ui=r'''function renderFinanceMoneyNowCard() {
  const coverage=getFinanceCoverage();
  const warning=coverage.free<0?`<div class="finance-v2-free-warning">⚠ Назначено больше денег, чем сейчас есть · не хватает ${formatRub(coverage.shortfall)}</div>`:'';
  return `<section class="card finance-v2-money-now ${coverage.free<0?'negative':''}">
    <div class="card-title-row"><div><h2>Деньги сейчас</h2><p class="muted">Счета минус резервы и ACTIVE платежи на ${TSBFinanceCore.UPCOMING_OBLIGATION_DAYS} дней.</p></div></div>
    <div class="finance-v2-money-grid">
      <div class="finance-v2-money-stat"><span>Всего на счетах</span><strong>${formatRub(coverage.totalAccounts)}</strong></div>
      <div class="finance-v2-money-stat"><span>В резервах</span><strong>${formatRub(coverage.reserved)}</strong></div>
      <div class="finance-v2-money-stat"><span>Обязательное скоро</span><strong>${formatRub(coverage.upcoming)}</strong></div>
      <div class="finance-v2-money-stat free"><span>Свободно</span><strong>${formatRub(coverage.free)}</strong></div>
    </div>${warning}
    <div class="finance-v2-primary-actions"><button class="primary-button" type="button" data-finance-v2-income-add>+ Поступление</button><button class="ghost-button" type="button" data-finance-v2-transfer-add>Перевод</button></div>
  </section>`;
}

'''
app=app.replace(anchor,money_ui+anchor,1)

# Coverage in nearest payments block, using the exact same core selector.
old_obl="""function renderFinanceObligationsCompact() {
  const upcoming=getFinanceUpcomingObligations(); const preview=upcoming.slice(0,3);
  return `<section class=\"card finance-v2-obligations-card\"><div class=\"card-title-row\"><div><h2>Ближайшие платежи</h2><p class=\"muted\">ACTIVE обязательства на ближайшие ${TSBFinanceCore.UPCOMING_OBLIGATION_DAYS} дней.</p></div><span class=\"badge important\">${formatRub(getFinanceUpcomingTotal())}</span></div>
    <div class=\"finance-v2-obligation-list\">${preview.length?preview.map(item=>renderFinanceObligationCard(item,{compact:true})).join(''):'<div class=\"empty\">Ближайших обязательных платежей нет.</div>'}</div>
    <div class=\"finance-v2-section-actions\"><button class=\"ghost-button\" type=\"button\" data-finance-obligations-open>Все платежи</button><button class=\"primary-button\" type=\"button\" data-finance-obligation-create>+ Добавить</button></div>
  </section>`;
}"""
new_obl="""function renderFinanceObligationsCompact() {
  const upcoming=getFinanceUpcomingObligations(); const preview=upcoming.slice(0,3); const coverage=getFinanceCoverage();
  const coverageText=coverage.covered?'✓ Ближайшие платежи покрыты':`⚠ Не хватает ${formatRub(coverage.shortfall)}`;
  return `<section class=\"card finance-v2-obligations-card\"><div class=\"card-title-row\"><div><h2>Ближайшие платежи</h2><p class=\"muted\">ACTIVE обязательства на ближайшие ${TSBFinanceCore.UPCOMING_OBLIGATION_DAYS} дней.</p></div><span class=\"badge important\">${formatRub(getFinanceUpcomingTotal())}</span></div>
    <div class=\"finance-v2-coverage ${coverage.covered?'covered':'short'}\">${coverageText}</div>
    <div class=\"finance-v2-obligation-list\">${preview.length?preview.map(item=>renderFinanceObligationCard(item,{compact:true})).join(''):'<div class=\"empty\">Ближайших обязательных платежей нет.</div>'}</div>
    <div class=\"finance-v2-section-actions\"><button class=\"ghost-button\" type=\"button\" data-finance-obligations-open>Все платежи</button><button class=\"primary-button\" type=\"button\" data-finance-obligation-create>+ Добавить</button></div>
  </section>`;
}"""
app=once(app,old_obl,new_obl,'obligation coverage UI')

# Today: replace account balance indicator with current free-money indicator, quick form untouched.
app=once(app,
"  const financeAccount = getDefaultFinanceAccount();\n  const financeAccountBalance = financeAccount ? getFinanceAccountBalance(financeAccount.id) : 0;",
"  const financeFreeMoney = getFinanceFreeMoney();",
'today money variable')
app=once(app,
"        <div class=\"finance-summary-line\">${financeAccount ? `${escapeHTML(financeAccount.name)}: ${formatRub(financeAccountBalance)}` : 'Счёт не создан'}</div>",
"        <div class=\"finance-summary-line finance-v2-today-free\">Свободно: <strong>${formatRub(financeFreeMoney)}</strong></div>",
'today free line')

# Replace the old Part1 hero with the new derived money-now card.
old_hero="""    <section class=\"card finance-v2-hero\">
      <div class=\"card-title-row\"><div><h2>Финансы</h2><p class=\"muted\">Общий баланс всех активных счетов.</p></div></div>
      <div class=\"finance-v2-total\">${formatRub(getFinanceTotalBalance())}</div>
      <div class=\"finance-v2-primary-actions\"><button class=\"primary-button\" type=\"button\" data-finance-v2-income-add>+ Поступление</button><button class=\"ghost-button\" type=\"button\" data-finance-v2-transfer-add>Перевод</button></div>
    </section>"""
app=once(app,old_hero,"""    ${renderFinanceMoneyNowCard()}""",'money now main')

css_add=r'''

/* Finance v2 Part 2 — money now / free money */
.finance-v2-money-now{overflow:hidden}
.finance-v2-money-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0 14px}
.finance-v2-money-stat{display:grid;gap:4px;padding:11px;border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.025)}
.finance-v2-money-stat span{font-size:.78rem;color:var(--muted)}
.finance-v2-money-stat strong{font-size:1.05rem}
.finance-v2-money-stat.free{grid-column:1/-1;border-color:rgba(139,92,246,.42);background:rgba(139,92,246,.10);padding:14px}
.finance-v2-money-stat.free span{text-transform:uppercase;letter-spacing:.08em;font-weight:850}
.finance-v2-money-stat.free strong{font-size:clamp(1.7rem,7vw,2.5rem);letter-spacing:-.035em}
.finance-v2-money-now.negative .finance-v2-money-stat.free{border-color:rgba(248,113,113,.45);background:rgba(248,113,113,.08)}
.finance-v2-free-warning,.finance-v2-coverage{padding:9px 11px;border-radius:12px;font-size:.82rem;font-weight:750;margin:0 0 12px}
.finance-v2-free-warning,.finance-v2-coverage.short{background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.28)}
.finance-v2-coverage.covered{background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.22)}
.finance-v2-today-free strong{font-size:1.08rem}
@media(max-width:380px){.finance-v2-money-grid{grid-template-columns:1fr}.finance-v2-money-stat.free{grid-column:auto}}
'''
if 'Finance v2 Part 2 — money now / free money' not in css: css+=css_add

test_add=r'''

// Finance v2 Part 2 free money is derived in core and reused by Finance/Today.
assert.ok(app.includes('function getFinanceFreeMoney'),'free money app selector missing');
assert.ok(app.includes('TSBFinanceCore.getFreeMoney'),'free money must come from finance core');
assert.ok(app.includes('function renderFinanceMoneyNowCard'),'money-now card missing');
assert.ok(app.includes('Всего на счетах'),'money-now total label missing');
assert.ok(app.includes('Обязательное скоро'),'money-now upcoming label missing');
assert.ok(app.includes('Свободно: <strong>${formatRub(financeFreeMoney)}'),'Today must show free money');
assert.ok(app.includes('data-finance-v2-expense-form'),'Today quick expense input must remain unchanged');
'''
if 'free money app selector missing' not in tests: tests+=test_add

APP.write_text(app);CSS.write_text(css);TEST.write_text(tests);print('Finance v2 Part2 stage E applied')
