const assert=require('node:assert/strict');
const fs=require('node:fs');
const version=JSON.parse(fs.readFileSync('version.json','utf8'));
const RELEASE=version.release;
const app=fs.readFileSync('js/app.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('css/style.css','utf8');
const mobileCleanupCss=fs.readFileSync('css/mobile-first-cleanup.css','utf8');
const confirmDialogCss=fs.readFileSync('css/confirm-dialog.css','utf8');
assert.ok(index.indexOf('js/finance-core.js')<index.indexOf('js/app.js'),'finance core must load before app');
assert.ok(index.indexOf('js/api-key-vault.js')<index.indexOf('js/app.js'),'API key vault must load before app');
assert.ok(index.indexOf('js/food-ai-client.js')<index.indexOf('js/app.js'),'food AI client must load before app');
assert.ok(index.indexOf('js/openai-food-ai-client.js')<index.indexOf('js/app.js'),'OpenAI food AI client must load before app');
assert.ok(fs.existsSync('js/openai-food-ai-client.js'),'OpenAI food AI client missing');
assert.ok(fs.existsSync('js/food-ai-client.js'),'food AI client missing');
assert.ok(!app.slice(app.indexOf('function buildFullBackupObject()'), app.indexOf('function buildFullBackupObject()') + 2000).match(/apiKey|ciphertext|selectedProvider|selectedModel/),'backup must not link to private vault');
assert.ok(app.includes('migrateLegacyState'),'app must invoke Finance v2 migration');
assert.ok(app.includes('data-finance-v2-expense-form'),'Today must use Finance v2 quick input');
assert.ok(fs.readFileSync('js/finance-core.js','utf8').includes('MIGRATION_ANCHOR'),'migration anchor contract missing');
console.log('Static app build check passed');

assert.equal(index.includes('finance-module-v1.js'),false,'Finance v1 override must not be loaded');
assert.ok(app.includes('function renderFinanceV2AccountCard'),'Finance v2 accounts UI missing');
assert.ok(app.includes('Последние операции'),'Finance v2 recent operations missing');

assert.ok(app.includes('function renderFinanceHistoryV2'),'unified history missing');
assert.ok(app.includes("const APP_VERSION = '0.13.3-finance-transaction-control'"),'app version mismatch');
assert.equal(index.includes('finance-module-v1.js'),false,'legacy finance module reference remains');
assert.ok(index.includes(RELEASE),'release shell mismatch');
assert.ok(css.includes('.visually-hidden'),'visually-hidden CSS class missing');
assert.ok(css.includes('clip-path: inset(50%);'),'visually-hidden must use clip-path');
assert.ok(confirmDialogCss.includes('body .visually-hidden'),'final visually-hidden cascade selector missing');
assert.ok(confirmDialogCss.includes('min-width:1px!important;'),'visually-hidden must keep a 1px min-width');
assert.ok(confirmDialogCss.includes('min-height:1px!important;'),'visually-hidden must keep a 1px min-height');
assert.ok(mobileCleanupCss.includes('body #tab-food [data-food-ai-camera]'),'mobile cleanup Food touch target selector missing');
assert.ok(confirmDialogCss.includes('body #tab-food [data-food-ai-camera]'),'final Food touch target selector missing');
assert.ok(confirmDialogCss.includes('width:44px!important;'),'final header touch target width must be 44px');
assert.ok(confirmDialogCss.includes('height:44px!important;'),'final header touch target height must be 44px');
assert.ok(confirmDialogCss.includes('min-width:44px!important;'),'final touch targets must have min-width 44px');
assert.ok(confirmDialogCss.includes('min-height:44px!important;'),'final touch targets must have min-height 44px');
assert.ok(css.includes('.app-header .date-switcher .icon-button'),'mobile date navigation touch target selector missing');
assert.ok(css.includes('.app-header .profile-settings-button'),'mobile settings touch target selector missing');
assert.ok(css.includes('#tab-food [data-food-ai-camera]'),'mobile camera touch target selector missing');
assert.ok(css.includes('#tab-food [data-food-ai-gallery]'),'mobile gallery touch target selector missing');
assert.ok(css.includes('#tab-food [data-food-ai-cancel]'),'mobile cancel touch target selector missing');
const mobileTouchTargetBlock=css.slice(css.lastIndexOf('.app-header .date-switcher .icon-button'));
assert.ok(mobileTouchTargetBlock.includes('min-width: 44px;'),'mobile touch targets must have min-width 44px');
assert.ok(mobileTouchTargetBlock.includes('min-height: 44px;'),'mobile touch targets must have min-height 44px');
const finalCss=confirmDialogCss.slice(confirmDialogCss.lastIndexOf('/* Final cascade:'));
for(const selector of ['body .app-header .date-switcher .icon-button','body .app-header .date-switcher .date-pill','body .app-header .profile-settings-button','body #tab-food [data-food-ai-camera]','body #tab-food [data-food-ai-gallery]','body #tab-food [data-food-ai-cancel]']) assert.ok(finalCss.includes(selector),`final mobile selector missing: ${selector}`);
assert.ok(finalCss.includes('@media(max-width:900px)'),'final mobile override must cover widths up to 900px');
const finalHiddenCss=confirmDialogCss.slice(confirmDialogCss.lastIndexOf('.visually-hidden'));
for(const declaration of ['width:1px!important;','height:1px!important;','min-width:1px!important;','min-height:1px!important;']) assert.ok(finalHiddenCss.includes(declaration),`final visually-hidden declaration missing: ${declaration}`);
const sw=fs.readFileSync('service-worker.js','utf8');
assert.ok(sw.includes('js/finance-core.js'),'service worker must cache finance core');
assert.ok(sw.includes('js/api-key-vault.js'),'service worker must cache API key vault');
assert.ok(sw.includes('js/food-ai-client.js'),'service worker must cache food AI client');
assert.ok(sw.includes('js/openai-food-ai-client.js'),'service worker must cache OpenAI food AI client');
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
assert.equal(app.includes('navigator.serviceWorker.register'),false,'app must not register the service worker directly');
const updateManager=fs.readFileSync('js/update-manager.js','utf8');
assert.ok(updateManager.includes(`const RELEASE='${RELEASE}'`),'update manager must own current service worker release');
assert.ok(updateManager.includes('service-worker.js?v=')&&updateManager.includes('nativeRegister(swUrl('),'update manager must own service worker registration');
assert.ok(sw.includes(`const RELEASE='${RELEASE}'`),'service worker release mismatch');
const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
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


// Finance v2 complete: architecture and daily-input invariants.
assert.ok(app.includes("const STORAGE_KEY = 'tsb_hub_data_v1'"),'storage key must remain unchanged');
const coreText=fs.readFileSync('js/finance-core.js','utf8');
assert.ok(coreText.includes('const FINANCE_SCHEMA_VERSION=3'),'Finance schema must remain v3');
assert.ok(coreText.includes("RECONCILIATION:'RECONCILIATION'"),'reconciliation system kind missing');
const quickStart=app.indexOf('function renderFinanceQuickForm');
const quickEnd=app.indexOf('function ',quickStart+20);
const quickFn=app.slice(quickStart,quickEnd>quickStart?quickEnd:app.length);
assert.ok(quickFn.includes('name="amount"'),'quick expense amount missing');
assert.ok(quickFn.includes('name="categoryId"'),'quick expense category missing');
assert.equal(quickFn.includes('name="accountId"'),false,'quick daily expense must not require account selection');
assert.equal(quickFn.includes('reserveId'),false,'quick daily expense must not require reserve allocation');
assert.equal(quickFn.includes('obligationId'),false,'quick daily expense must not require obligation selection');
assert.equal(index.includes('finance-module-v3.js'),false,'Finance v2 complete must not add an override module');
assert.equal(fs.existsSync('js/finance-module-v3.js'),false,'Finance v2 complete override file must not exist');

if(!app.includes('data-finance-v2-delete'))throw new Error('transaction delete action missing');
if(!app.includes('data-finance-legacy-reserve-restore'))throw new Error('legacy reserve balance repair UI missing');
if(!app.includes('restoreLegacyReserveBalance'))throw new Error('legacy reserve balance repair core integration missing');
