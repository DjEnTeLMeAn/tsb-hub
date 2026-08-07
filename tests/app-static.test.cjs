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
