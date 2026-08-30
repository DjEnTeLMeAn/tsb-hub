const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const index = read('index.html');
const app = read('js/app.js');
const style = read('css/style.css');
const mobileCleanup = read('css/mobile-first-cleanup.css');

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

test('primary navigation is exactly Tasks, Food, Finance', () => {
  const nav = index.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav, 'primary navigation must exist');
  const destinations = [...nav.matchAll(/data-tab="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(destinations, ['tasks', 'food', 'finance']);
  assert.doesNotMatch(nav, /Сегодня|Today|Планы|Plans|More|Больше/);
  assert.equal((index.match(/class="tab-page(?: active)?"[^>]*id="tab-(tasks|food|finance)"/g) || []).length, 3);
});

test('Settings stays outside primary navigation but remains reachable', () => {
  const nav = index.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav, 'primary navigation must exist');
  assert.doesNotMatch(nav, /data-tab="settings"/);
  assert.match(index, /<button[^>]+data-tab-target="settings"[^>]+(?:aria-label="Открыть настройки"|title="Настройки")/);
  assert.match(index, /id="tab-settings"/);
  assert.match(app, /const APP_TABS = \['tasks', 'food', 'finance'\]/);
  assert.match(app, /const APP_SCREENS = \[\.\.\.APP_TABS, 'settings'\]/);
});

test('mobile navigation and layout have a static width-safe overflow contract', () => {
  assert.match(index, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(mobileCleanup, /@media\(max-width:900px\)[\s\S]*?\.tabs\{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(mobileCleanup, /@media\(max-width:900px\)[\s\S]*?\.tabs\{[\s\S]*?overflow:hidden/);
  assert.match(style, /html, body \{ max-width: 100%; overflow-x: hidden; \}/);
  assert.match(style, /body, \.app-shell, \.layout, \.content-panel, \.tab-page, \.card, \.panel \{ min-width: 0; \}/);
  assert.match(mobileCleanup, /\.mobile-tab-menu\{max-height:calc\(100dvh - 120px\);overflow-y:auto/);
  assert.match(mobileCleanup, /\.mobile-tab-menu button\{min-height:44px;white-space:normal;overflow-wrap:anywhere\}/);
});

test('main redesign contracts are present in app.js', () => {
  const tasks = functionBody(app, 'renderTasks');
  const food = functionBody(app, 'renderFood');
  const finance = functionBody(app, 'renderFinance');

  assert.match(tasks, /data-task-period="today"[\s\S]*?data-task-period="tomorrow"/);
  assert.match(app, /foodAi\s*:\s*\{\s*status:\s*['"]idle['"]/);
  for (const status of ['idle', 'selecting', 'analysing', 'result', 'error', 'saved']) {
    assert.match(app, new RegExp(String.raw`status\s*===\s*['"]${status}['"]|status\s*:\s*['"]${status}['"]`), `Food AI status ${status} is missing`);
  }
  assert.match(app, /\[\['overview','Обзор'\],\['operations','Операции'\],\['plan','План'\]\]/);

  // Forms are supplied through disclosure/secondary-action helpers, not placed
  // as permanent markup in the three primary screen templates.
  assert.doesNotMatch(tasks, /data-task-form/);
  assert.match(tasks, /data-task-add-form[\s\S]*?renderTaskAddForm/);
  assert.doesNotMatch(food, /data-meal-form/);
  assert.match(food, /renderCollapsedBlock\(['"]Добавить вручную['"][\s\S]*?renderMealAddForm/);
  assert.doesNotMatch(finance, /data-finance-v2-expense-form/);
  assert.match(finance, /renderFinanceSectionNav\(\)/);
  assert.match(finance, /renderFinanceOperations\(\)/);
  assert.match(finance, /renderFinancePlan\(\)/);
});

test('frontend contains no embedded OpenAI API key pattern', () => {
  const frontendFiles = [
    'index.html',
    ...fs.readdirSync(path.join(root, 'js')).filter(file => file.endsWith('.js')).map(file => `js/${file}`),
    ...fs.readdirSync(path.join(root, 'css')).filter(file => file.endsWith('.css')).map(file => `css/${file}`)
  ];
  const frontend = frontendFiles.map(file => read(file)).join('\n');
  assert.doesNotMatch(frontend, /sk-[A-Za-z0-9]{20,}/i);
  assert.doesNotMatch(frontend, /(?:OPENAI|OPEN_AI)[_-]?API[_-]?KEY\s*[:=]/i);
  assert.doesNotMatch(frontend, /api[_-]?key\s*[:=]\s*['"][^'"]{16,}['"]/i);
  assert.doesNotMatch(frontend, /Bearer\s+[A-Za-z0-9._-]{20,}/i);
});
