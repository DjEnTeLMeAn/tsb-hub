const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('js/app.js', 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} is missing`);
  let brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not read ${name}`);
}

const ctx = {
  MAX_BACKUP_DEPTH: 12, MAX_BACKUP_NODES: 20000, MAX_DATE_BUCKETS: 1000,
  MAX_TASKS_PER_DAY: 500, MAX_MEALS_PER_DAY: 500, MAX_SUBTASKS_PER_TASK: 100,
  MAX_IMPORTANT_DATES: 1000, MAX_STRING_LENGTH: 10000,
  FULL_BACKUP_TYPE: 'full', BACKUP_FORMAT_VERSION: 1,
  SAFE_ID_RE: /^[A-Za-z0-9_.:-]{1,128}$/,
  FORBIDDEN_KEYS: new Set(['__proto__', 'prototype', 'constructor']),
  uid: prefix => `${prefix}_generated`,
  normalizePriority: value => ['critical', 'important', 'secondary'].includes(value) ? value : 'important',
  fromISODate: value => new Date(`${value}T00:00:00Z`),
  toISODate: date => date.toISOString().slice(0, 10)
};
vm.createContext(ctx);
vm.runInContext([
  functionSource('isPlainObject'), functionSource('boundedString'), functionSource('validISODateKey'),
  functionSource('safeEntityId'), functionSource('normalizeSubtasks'), functionSource('normalizeTasks'),
  functionSource('normalizeHealth'), functionSource('normalizeImportantDates'), functionSource('validateFullBackup')
].join('\n'), ctx);

test('malicious and duplicate entity IDs are replaced with safe globally unique IDs', () => {
  const data = vm.runInContext(`(()=>{const taskIds=new Set(), subtaskIds=new Set(); return normalizeTasks({
    '2026-08-30': [{id: 'same', text: 'a', subtasks: [{id: 'sub', text: 'x'}]}],
    '2026-08-31': [{id: 'same', text: '<img src=x onerror=1>', subtasks: [{id: 'sub', text: 'y'}]}]
  }, taskIds, subtaskIds)})()`, ctx);
  const tasks = [...data['2026-08-30'], ...data['2026-08-31']];
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every(task => /^[A-Za-z0-9_.:-]{1,128}$/.test(task.id)));
  assert.equal(new Set(tasks.map(task => task.id)).size, 2);
  assert.equal(new Set(tasks.flatMap(task => task.subtasks.map(sub => sub.id))).size, 2);
});

test('strict backup validation rejects unknown keys, deep payloads and oversized collections', () => {
  assert.equal(vm.runInContext(`validateFullBackup({backupType:'full',formatVersion:1,unknown:1}).ok`, ctx), false);
  assert.equal(vm.runInContext(`validateFullBackup({backupType:'full',formatVersion:1,meta:{'__proto__':{polluted:true}}}).ok`, ctx), false);
  assert.equal(vm.runInContext(`validateFullBackup({backupType:'full',formatVersion:1,tasks:{'2026-08-31':[]}}).ok`, ctx), true);
  assert.equal(vm.runInContext(`validateFullBackup({backupType:'full',formatVersion:1,tasks:Object.fromEntries(Array.from({length:1001},(_,i)=>[String(i),[]]))}).ok`, ctx), false);
});

test('strict validator rejects invalid nested task and health shapes', () => {
  const cases = [
    `({tasks:{'2026-08-31':{}}})`,
    `({tasks:{'2026-08-31':Array.from({length:501},()=>({text:'x'}))}})`,
    `({tasks:{'2026-08-31':[{text:'x',subtasks:Array.from({length:101},()=>({text:'x'}))}]}})`,
    `({health:{'2026-08-31':{meals:Array.from({length:501},()=>({name:'x'}))}}})`,
    `({tasks:{'2026-08-31':[{text:'${'x'.repeat(2001)}'}]}})`,
  ];
  for (const body of cases) {
    assert.equal(vm.runInContext(`validateFullBackup(Object.assign({backupType:'full',formatVersion:1},${body})).ok`, ctx), false, body);
  }
});

test('CSV formula prefixes are applied after leading spaces/tabs and then quoted', () => {
  vm.runInContext(functionSource('financeCsvCell'), ctx);
  for (const value of ['=1+1', '+cmd', '-10', '@evil', ' \t=SUM(A1)']) {
    assert.equal(vm.runInContext(`financeCsvCell(${JSON.stringify(value)})`, ctx).trimStart().startsWith("'"), true);
  }
});

test('file-size gate and sink escaping are present', () => {
  assert.match(source, /Number\(file\.size\) > MAX_BACKUP_BYTES/);
  assert.match(source, /const validation = validateFullBackup\(parsed\)/);
  for (const fragment of [
    'data-task-toggle="${escapeHTML(task.id)}"', 'data-subtask-id="${escapeHTML(sub.id)}"',
    'data-meal-edit="${escapeHTML(meal.id)}"', 'data-important-status="${escapeHTML(item.id)}"',
    'data-task-complete-past="${escapeHTML(task.id)}"'
  ]) assert.ok(source.includes(fragment), `missing escaped sink: ${fragment}`);
});
