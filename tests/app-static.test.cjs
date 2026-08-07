const assert=require('node:assert/strict');
const fs=require('node:fs');
const RELEASE='0.12.0-finance-v2-part2-20260807';
const app=fs.readFileSync('js/app.js','utf8');
const index=fs.readFileSync('index.html','utf8');
assert.ok(index.indexOf('js/finance-core.js')<index.indexOf('js/app.js'),'finance core must load before app');
assert.ok(app.includes('migrateLegacyState'),'app must invoke Finance v2 migration');
assert.ok(app.includes('data-finance-v2-expense-form'),'Today must use Finance v2 quick input');
assert.ok(fs.readFileSync('js/finance-core.js','utf8').includes('MIGRATION_ANCHOR'),'migration anchor contract missing');
console.log('Static app build check passed');

assert.equal(index.includes('finance-module-v1.js'),false,'Finance v1 override must not be loaded');
assert.ok(app.includes('function renderFinanceV2AccountCard'),'Finance v2 accounts UI missing');
assert.ok(app.includes('Последние операции'),'Finance v2 recent operations missing');

assert.ok(app.includes('function renderFinanceHistoryV2'),'unified history missing');
assert.ok(app.includes("const APP_VERSION = '0.12.0-finance-v2-part2'"),'app version mismatch');
assert.equal(index.includes('finance-module-v1.js'),false,'legacy finance module reference remains');
assert.ok(index.includes('0.12.0-finance-v2-part2-20260807'),'release shell mismatch');
const sw=fs.readFileSync('service-worker.js','utf8');
assert.ok(sw.includes('js/finance-core.js'),'service worker must cache finance core');
assert.equal(sw.includes('finance-module-v1.js'),false,'service worker still references Finance v1');
assert.equal(fs.existsSync('js/finance-module-v1.js'),false,'Finance v1 file must be removed');

// GPT report must use Finance v2 derived balance, not cleared legacy availableBalance.
const reportStart=app.indexOf('function buildGptReport()');
const reportEnd=app.indexOf('function ',reportStart+20);
const reportFn=app.slice(reportStart,reportEnd>reportStart?reportEnd:app.length);
assert.ok(reportFn.includes('getFinanceCoverage()'),'GPT report must use Finance v2 Part2 coverage including total balance');
assert.ok(reportFn.includes('accountLines'),'GPT report must include account breakdown');
assert.equal(reportFn.includes('context.availableBalance'),false,'GPT report must not use legacy availableBalance');
assert.ok(reportFn.includes('getFinanceCoverage()'),'GPT report must use Part2 coverage');
assert.ok(reportFn.includes('getActiveReserves'),'GPT report must include active reserves');
assert.ok(reportFn.includes('getActiveObligations'),'GPT report must include active obligations');
assert.ok(reportFn.includes('НЕ входят в «Свободно»'),'planned income must be marked as non-existing money');


// Finance v2 Part 2 reserve UI must use the central core API.
assert.ok(app.includes('function renderFinanceReservesScreen'),'reserve management screen missing');
assert.ok(app.includes('data-finance-reserves-open'),'reserve management entry missing');
assert.ok(app.includes('TSBFinanceCore.createReserve'),'reserve create must use finance core');
assert.ok(app.includes('TSBFinanceCore.adjustReserveAmount'),'reserve adjustment must use finance core');
assert.ok(app.includes('TSBFinanceCore.importLegacyReserve'),'legacy reserve import must use finance core');
assert.equal(index.includes('finance-module-v2.js'),false,'Finance Part2 must not introduce an override module');


// Finance v2 Part 2 obligation UI must preserve the one-transaction payment model.
assert.ok(app.includes('function renderFinanceObligationsScreen'),'obligation management screen missing');
assert.ok(app.includes('data-finance-obligation-pay'),'obligation payment action missing');
assert.ok(app.includes('TSBFinanceCore.payObligation'),'payment UI must use core payObligation');
assert.ok(app.includes('TSBFinanceCore.linkObligationToTransaction'),'link UI must use core linking');
assert.ok(app.includes('data-finance-obligation-link'),'existing-expense link action missing');
assert.ok(app.includes('reactivatedObligationIds'),'transaction deletion UI must surface obligation reactivation');


// Finance v2 Part 2 free money is derived in core and reused by Finance/Today.
assert.ok(app.includes('function getFinanceFreeMoney'),'free money app selector missing');
assert.ok(app.includes('TSBFinanceCore.getFreeMoney'),'free money must come from finance core');
assert.ok(app.includes('function renderFinanceMoneyNowCard'),'money-now card missing');
assert.ok(app.includes('Всего на счетах'),'money-now total label missing');
assert.ok(app.includes('Обязательное скоро'),'money-now upcoming label missing');
assert.ok(app.includes('Свободно: <strong>${formatRub(financeFreeMoney)}'),'Today must show free money');
assert.ok(app.includes('data-finance-v2-expense-form'),'Today quick expense input must remain unchanged');


// Finance v2 Part 2 main screen order and real management destinations.
assert.ok(app.includes('function renderFinanceQuickActions'),'Finance quick actions block missing');
assert.ok(app.includes('data-finance-v2-expense-add'),'Finance quick expense action missing');
assert.ok(app.includes('function financeCurrentMonthStats'),'current month calculation missing');
assert.ok(app.includes('TSBFinanceCore.getAnalyticsSummary'),'month analytics must delegate to finance core');
assert.ok(app.includes('function renderFinanceManagementScreen'),'management screen missing');
assert.ok(app.includes('function renderFinanceAccountsScreen'),'accounts must be moved to management');
assert.ok(app.includes('function renderFinanceCategoriesScreen'),'category management screen missing');
assert.ok(app.includes('data-finance-analytics-open'),'analytics/history destination missing');
assert.ok(app.includes('Сверка баланса'),'reconciliation status row missing');


// Finance v2 Part2 final architecture and release hygiene.
assert.equal(app.includes("$$('[data-finance-form]', root)"),false,'legacy Finance v1 expense binder remains');
assert.equal(app.includes("$$('[data-finance-context-form]', root)"),false,'legacy balance context binder remains');
assert.equal(app.includes("$$('[data-finance-plan-complete]', root)"),false,'legacy plan completion binder remains');
assert.equal(index.includes('finance-module-v2.js'),false,'Finance Part2 override module must not exist');
assert.equal(fs.existsSync('js/finance-module-v2.js'),false,'Finance Part2 override file must not exist');
assert.ok(app.includes(`service-worker.js?v=0.12.0-finance-v2-part2-20260807`),'direct service worker registration must use current release');
assert.ok(sw.includes(`const RELEASE='0.12.0-finance-v2-part2-20260807'`),'service worker release mismatch');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
const version=JSON.parse(fs.readFileSync('version.json','utf8'));
assert.equal(manifest.version,RELEASE,'manifest release mismatch');
assert.equal(version.release,RELEASE,'version.json release mismatch');
const financeRenderStart=app.indexOf('function renderFinance()');
const financeRenderEnd=app.indexOf('function ',financeRenderStart+20);
const financeRender=app.slice(financeRenderStart,financeRenderEnd>financeRenderStart?financeRenderEnd:app.length);
const ordered=['renderFinanceMoneyNowCard()','renderFinanceQuickActions()','renderFinanceMonthCard()','renderFinanceObligationsCompact()','renderFinanceReservesCompact()','Последние операции','renderFinanceManagementLinks()'];
let last=-1;for(const marker of ordered){const pos=financeRender.indexOf(marker);assert.ok(pos>last,`Finance main order broken at ${marker}`);last=pos;}


// Finance v2 Part3 analytics UI must use the core summary and keep the main card compact.
assert.ok(app.includes('function renderFinanceAnalyticsScreen'),'Part3 analytics screen missing');
assert.ok(app.includes('TSBFinanceCore.getAnalyticsSummary'),'analytics UI must use core analytics');
assert.ok(app.includes("['week','Неделя']"),'analytics week period missing');
assert.ok(app.includes("['month','Месяц']"),'analytics month period missing');
assert.ok(app.includes("['3m','3 месяца']"),'analytics 3 month period missing');
assert.ok(app.includes("['year','Год']"),'analytics year period missing');
assert.ok(app.includes("['custom','Свой период']"),'analytics custom period missing');
assert.ok(app.includes('Среднее в день'),'analytics daily average missing');
assert.ok(app.includes('data-finance-analytics-history'),'analytics to history integration missing');


// Finance v2 Part3 reconciliation is a real screen backed by one core ADJUSTMENT.
assert.ok(app.includes('function renderFinanceReconcileScreen'),'reconciliation screen missing');
assert.ok(app.includes('TSBFinanceCore.reconcileAccount'),'reconciliation must use finance core');
assert.ok(app.includes('data-finance-management-open="reconcile"'),'reconciliation management entry missing');
assert.ok(app.includes('ADJUSTMENT только на разницу'),'reconciliation explanation missing');


// Finance v2 Part3 export stays separate from the full TSB backup.
assert.ok(app.includes('function buildFinanceExportObject'),'Finance JSON export builder missing');
assert.ok(app.includes('function financeTransactionsCsv'),'Finance CSV export missing');
assert.ok(app.includes('function renderFinanceExportScreen'),'Finance export screen missing');
assert.ok(app.includes('data-finance-management-open="export"'),'Finance export management entry missing');
assert.ok(app.includes('Полный backup TSB Hub'),'full backup bridge missing');
assert.ok(app.includes('financeSchemaVersion:finance.schemaVersion'),'Finance export schema marker missing');


// Finance v2 Part3 history is an analysis tool, not a second ledger.
assert.ok(app.includes("['year','Год']"),'history year period missing');
assert.ok(app.includes("['ADJUSTMENT','Корректировки']"),'history adjustment filter missing');
assert.ok(app.includes("accountId:h.accountId"),'history account filter must use core transactions filter');
assert.ok(app.includes('finance-v2-history-summary-grid'),'history analysis summary missing');
assert.ok(app.includes('data-finance-history-export'),'filtered history CSV export missing');
assert.ok(app.includes("exportFinanceCsv(financeHistoryTransactions(),'history-filtered')"),'history export must use current filtered rows');


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
