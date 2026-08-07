const assert=require('node:assert/strict');
const fs=require('node:fs');
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
assert.ok(app.includes("const APP_VERSION = '0.11.1-finance-v2-part1'"),'app version mismatch');
assert.equal(index.includes('finance-module-v1.js'),false,'legacy finance module reference remains');
assert.ok(index.includes('0.11.1-finance-v2-part1-report-20260807'),'release shell mismatch');
const sw=fs.readFileSync('service-worker.js','utf8');
assert.ok(sw.includes('js/finance-core.js'),'service worker must cache finance core');
assert.equal(sw.includes('finance-module-v1.js'),false,'service worker still references Finance v1');
assert.equal(fs.existsSync('js/finance-module-v1.js'),false,'Finance v1 file must be removed');

// GPT report must use Finance v2 derived balance, not cleared legacy availableBalance.
const reportStart=app.indexOf('function buildGptReport()');
const reportEnd=app.indexOf('function ',reportStart+20);
const reportFn=app.slice(reportStart,reportEnd>reportStart?reportEnd:app.length);
assert.ok(reportFn.includes('getFinanceTotalBalance()'),'GPT report must use Finance v2 total balance');
assert.ok(reportFn.includes('accountLines'),'GPT report must include account breakdown');
assert.equal(reportFn.includes('context.availableBalance'),false,'GPT report must not use legacy availableBalance');
assert.ok(reportFn.includes('Legacy-резерв'),'legacy reserve must be explicitly labeled');


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
