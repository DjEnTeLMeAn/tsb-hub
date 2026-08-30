const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('js/app.js');
const index = read('index.html');

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(open, i + 1);
  }
  assert.fail(`${name} has no balanced function body`);
}

test('renderAll has one owner per primary screen', () => {
  const renderAll = functionBody(app, 'renderAll');
  assert.doesNotMatch(renderAll, /renderToday/);
  for (const legacyRender of ['renderPlans', 'renderImportant', 'renderSync']) {
    assert.doesNotMatch(renderAll, new RegExp(`\\b${legacyRender}\\b`), `renderAll must not call removed ${legacyRender}`);
  }
  for (const legacyRoot of ['tab-today', 'tab-plans', 'tab-important', 'tab-sync']) {
    assert.doesNotMatch(index, new RegExp(`id="${legacyRoot}"`), `${legacyRoot} must remain removed`);
  }
  assert.equal((renderAll.match(/\['tasks',\s*renderTasks\]/g) || []).length, 1);
  assert.equal((renderAll.match(/\['food',\s*renderFood\]/g) || []).length, 1);
  assert.equal((renderAll.match(/\['finance',\s*renderFinance\]/g) || []).length, 1);
});

test('Food and Finance primary renders do not duplicate their sections', () => {
  const food = functionBody(app, 'renderFood');
  const finance = functionBody(app, 'renderFinance');

  assert.equal((food.match(/renderFoodAiCard\(\)/g) || []).length, 1);
  assert.equal((food.match(/renderFoodMealPreview\(/g) || []).length, 1);
  assert.equal((finance.match(/renderFinanceSectionNav\(\)/g) || []).length, 1);
  assert.equal((finance.match(/renderFinanceOperations\(\)/g) || []).length, 1);
  assert.equal((finance.match(/renderFinancePlan\(\)/g) || []).length, 1);
  assert.equal((finance.match(/finance-v2-overview/g) || []).length, 1);
  assert.equal((finance.match(/renderFinanceMoneyNowCard\(\)/g) || []).length, 1);
  assert.equal((finance.match(/renderFinanceMonthCard\(\)/g) || []).length, 1);
  assert.equal((finance.match(/renderFinanceObligationsCompact\(\)/g) || []).length, 1);
  assert.equal((finance.match(/renderFinanceReservesCompact\(\)/g) || []).length, 1);
  assert.equal((finance.match(/Последние операции/g) || []).length, 1);

  assert.equal((index.match(/id="tab-food"/g) || []).length, 1);
  assert.equal((index.match(/id="tab-finance"/g) || []).length, 1);
});
