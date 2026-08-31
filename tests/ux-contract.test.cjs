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

test('renderAll tolerates a missing selected date label', () => {
  const renderAll = functionBody(app, 'renderAll');
  assert.match(renderAll, /const selectedDateLabel = \$\('#selectedDateLabel'\);\s*if \(selectedDateLabel\) selectedDateLabel\.textContent = formatHumanDate\(state\.selectedDate\);/);
});

test('Tasks list uses press semantics instead of checkbox controls', () => {
  const row = functionBody(app, 'renderTaskRow');
  const tasks = functionBody(app, 'renderTasks');

  assert.doesNotMatch(row, /<input[^>]+type=["']checkbox["']/);
  assert.doesNotMatch(row, /data-task-toggle/);
  assert.match(row, /data-task-open=/);
  assert.match(row, /task\.done \? 'done' : ''/);
  assert.match(tasks, /pointerdown/);
  assert.match(tasks, /pointerup/);
  assert.match(tasks, /openTaskActionSheet\(taskId, date\)/);
  assert.match(tasks, /task\.done = !task\.done/);
});

test('task priority is not used by task presentation or reports', () => {
  assert.doesNotMatch(app, /function priorityRank\(/);
  assert.doesNotMatch(functionBody(app, 'renderTaskCard'), /PRIORITIES/);
  assert.doesNotMatch(functionBody(app, 'renderTaskList'), /priorityRank/);
  assert.doesNotMatch(functionBody(app, 'getPendingPastTasksHTML'), /task\.priority|PRIORITIES/);
  assert.doesNotMatch(functionBody(app, 'buildGptReport'), /task\.priority|PRIORITIES/);
});

test('Tasks action sheet exposes only edit/delete and task edit saves name plus comment', () => {
  const sheet = functionBody(app, 'openTaskActionSheet');
  const common = functionBody(app, 'bindCommonActions');
  const editStart = common.indexOf("$$('[data-task-edit]", 0);
  const subStart = common.indexOf("$$('[data-task-sub]", editStart);
  assert.notEqual(editStart, -1, 'task edit handler must exist');
  assert.notEqual(subStart, -1, 'task subtask handler must exist after task edit handler');
  const taskEditHandler = common.slice(editStart, subStart);

  assert.equal((sheet.match(/data-task-edit=/g) || []).length, 1);
  assert.equal((sheet.match(/data-task-delete=/g) || []).length, 1);
  assert.doesNotMatch(sheet, /data-task-sub/);
  assert.match(common, /closeTaskActionSheetFor\(btn\);[\s\S]*?data-task-edit/);
  assert.match(taskEditHandler, /\{ name: 'text', label: 'Название', value: task\.text \}/);
  assert.match(taskEditHandler, /\{ name: 'note', label: 'Комментарий', value: task\.note \|\| ''/);
  assert.doesNotMatch(taskEditHandler, /name: 'priority'/);
  assert.doesNotMatch(taskEditHandler, /name: 'time'/);
  assert.match(taskEditHandler, /task\.note = String\(result\.note \|\| ''\)\.trim\(\)/);
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
