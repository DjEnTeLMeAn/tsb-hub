const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const appSource = read('js/app.js');
const storageSource = read('js/storage.js');
const swSource = read('service-worker.js');
const indexSource = read('index.html');
const headersSource = read('_headers');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} is missing`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not read ${name}`);
}

function appVm() {
  const context = {
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
  vm.createContext(context);
  vm.runInContext([
    functionSource(appSource, 'isPlainObject'), functionSource(appSource, 'boundedString'),
    functionSource(appSource, 'validISODateKey'), functionSource(appSource, 'safeEntityId'),
    functionSource(appSource, 'normalizeSubtasks'), functionSource(appSource, 'normalizeTasks'),
    functionSource(appSource, 'normalizeHealth'), functionSource(appSource, 'normalizeImportantDates'),
    functionSource(appSource, 'validateFullBackup'), functionSource(appSource, 'financeCsvCell'),
    functionSource(appSource, 'escapeHTML')
  ].join('\n'), context);
  return context;
}

test('backup rejects pollution keys at every traversed level and rejects type confusion', () => {
  const ctx = appVm();
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const payload = { backupType: 'full', formatVersion: 1, meta: {} };
    Object.defineProperty(payload.meta, key, { value: { polluted: true }, enumerable: true });
    assert.equal(vm.runInContext(`validateFullBackup(${JSON.stringify(payload)}).ok`, ctx), false, key);
  }
  for (const body of [
    { tasks: [] }, { health: [] }, { importantDates: {} },
    { tasks: { '2026-08-31': [{ text: 42 }] } },
    { health: { '2026-08-31': { meals: [{ name: 42 }] } } },
    { importantDates: [{ title: 42, date: '2026-08-31' }] }
  ]) {
    assert.equal(vm.runInContext(`validateFullBackup(Object.assign({backupType:'full',formatVersion:1},${JSON.stringify(body)})).ok`, ctx), false);
  }
});

test('backup bounds depth, width, bytes, entities, and exact calendar dates', () => {
  const ctx = appVm();
  const nested = {}; let cursor = nested;
  for (let i = 0; i < 14; i += 1) { cursor.next = {}; cursor = cursor.next; }
  assert.equal(vm.runInContext(`validateFullBackup({backupType:'full',formatVersion:1,meta:${JSON.stringify(nested)}}).ok`, ctx), false);
  const tooManyBuckets = {};
  for (let i = 0; i < 1001; i += 1) {
    const date = new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10);
    tooManyBuckets[date] = [];
  }
  assert.equal(vm.runInContext(`validateFullBackup({backupType:'full',formatVersion:1,tasks:${JSON.stringify(tooManyBuckets)}}).ok`, ctx), false);
  for (const date of ['2026-02-29', '2026-04-31', '9999-99-99']) {
    assert.equal(vm.runInContext(`validateFullBackup({backupType:'full',formatVersion:1,tasks:{${JSON.stringify(date)}:[]}}).ok`, ctx), false, date);
  }
  const wide = {}; for (let i = 0; i < 20001; i += 1) wide[`k${i}`] = 1;
  assert.equal(vm.runInContext(`validateFullBackup({backupType:'full',formatVersion:1,meta:${JSON.stringify(wide)}}).ok`, ctx), false);
});

test('normalization replaces reserved, duplicate, malformed, and cross-collection IDs', () => {
  const ctx = appVm();
  const data = vm.runInContext(`(()=>{const t=new Set(),s=new Set(),m=new Set(),i=new Set();return {
    tasks:normalizeTasks({'2026-08-31':[{id:'__proto__',text:'x',subtasks:[{id:'constructor',text:'s'},{id:'prototype',text:'s2'}]},{id:'same',text:'y'}]},t,s),
    health:normalizeHealth({'2026-08-31':{meals:[{id:'same',name:'m'}]}},m),
    important:normalizeImportantDates([{id:'__proto__',title:'d',date:'2026-08-31'}],i)}})()`, ctx);
  const taskIds = data.tasks['2026-08-31'].map(x => x.id);
  assert.ok(taskIds.every(id => !['__proto__', 'constructor', 'prototype'].includes(id)));
  assert.ok(data.tasks['2026-08-31'][0].subtasks.every(x => !['__proto__', 'constructor', 'prototype'].includes(x.id)));
  assert.equal(data.health['2026-08-31'].meals[0].id, 'same', 'IDs may be reused across distinct entity types');
  assert.notEqual(data.important[0].id, '__proto__');
});

test('CSV neutralizes formulas after spaces/tabs and preserves quoting, separators, and newlines', () => {
  const ctx = appVm();
  for (const input of ['=1+1', '+cmd', '-10', '@evil', ' \t=SUM(A1)', '\t +cmd']) {
    const output = vm.runInContext(`financeCsvCell(${JSON.stringify(input)})`, ctx);
    const unquoted = output.startsWith('"') ? output.slice(1, -1).replace(/""/g, '"') : output;
    assert.equal(unquoted.trimStart().startsWith("'"), true, input);
    if (/[";,\n\r]/.test(output)) assert.match(output, /^"[\s\S]*"$/);
  }
  const quoted = vm.runInContext(`financeCsvCell(${JSON.stringify('";\n=bad')})`, ctx);
  assert.match(quoted, /^"[\s\S]*"$/);
});

test('stored-XSS sinks escape text and attribute values, including quote/backtick payloads', () => {
  const ctx = appVm();
  for (const payload of ['<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '"`\'&']) {
    const escaped = vm.runInContext(`escapeHTML(${JSON.stringify(payload)})`, ctx);
    assert.doesNotMatch(escaped, /[<>]/);
    assert.equal(escaped.includes('"'), false);
    assert.equal(escaped.includes("'"), false);
  }
  assert.ok(appSource.match(/innerHTML\s*=/g)?.length > 20, 'audit should cover the real template surface');
  for (const rawSink of [
    /data-[\w-]+="\$\{task\.(?:id|text|note)/,
    /data-[\w-]+="\$\{meal\.(?:id|name|time)/,
    /data-[\w-]+="\$\{(?:item|transaction|account|category)\.(?:id|title|name|description)/
  ]) assert.doesNotMatch(appSource, rawSink, `raw attribute sink: ${rawSink}`);
  assert.match(functionSource(appSource, 'escapeHTML'), /[&<>'"]/);
  assert.match(appSource, /data-task-open="\$\{taskId\}"/);
  assert.match(appSource, /aria-label="Открыть задачу «\$\{taskText\}»"/);
});

test('debug and identifier entropy fail closed outside local development and without Web Crypto', () => {
  const ctx = appVm();
  vm.runInContext(functionSource(appSource, 'isLocalDevelopment'), ctx);
  assert.equal(vm.runInContext("isLocalDevelopment({hostname:'example.test'}, true)", ctx), false);
  assert.equal(vm.runInContext("isLocalDevelopment({hostname:'localhost'}, false)", ctx), false);
  const uuid = functionSource(appSource, 'secureRandomUUID');
  const noCrypto = {};
  vm.createContext(noCrypto);
  vm.runInContext(uuid, noCrypto);
  assert.throws(() => vm.runInContext('secureRandomUUID()', noCrypto), /Secure randomness is unavailable/);
  assert.doesNotMatch(appSource, /location\.search[\s\S]{0,100}debug/i);
  assert.match(appSource, /Number\(file\.size\) > MAX_BACKUP_BYTES/);
});

test('CSP and bootstrap do not reintroduce executable inline script or eval', () => {
  const csp = indexSource.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-(?:inline|eval)/i);
  assert.doesNotMatch(indexSource, /<script(?:\s[^>]*)?>(?!\s*<\/script>)[\s\S]*?<\/script>/i);
  assert.doesNotMatch(appSource, /\b(?:eval|Function)\s*\(/);
});

test('storage reset reports silent remove failure, does not resurrect recovery/legacy data, and preserves unrelated keys', () => {
  const values = new Map([
    ['tsb_hub_data_v1', '{bad'], ['tsb_hub_data_v1_recovery', '{"old":true}'],
    ['tasks_v043', '{"2026-08-31":[]}'], ['healthData', '{}'], ['unrelated', 'keep']
  ]);
  const storage = { getItem: key => values.has(key) ? values.get(key) : null, setItem: (k,v) => values.set(k, String(v)), removeItem: key => { if (key === 'healthData') return; values.delete(key); } };
  const context = { window: { localStorage: storage } };
  vm.runInNewContext(storageSource, context);
  const result = context.window.TSBStorage.clearAllData();
  assert.equal(result.ok, false);
  assert.deepEqual(Array.from(result.failedKeys), ['healthData']);
  assert.equal(values.get('unrelated'), 'keep');
  assert.equal(context.window.TSBStorage.get('tsb_hub_data_v1'), null);
});

test('service worker bypasses exact and descendant sensitive paths before respondWith/cache for every method and URL variant', () => {
  const listeners = {};
  let cacheCalls = 0;
  const context = { URL, Request, Response, fetch: async () => new Response('network'),
    caches: { open: async () => { cacheCalls += 1; return { put: async () => { cacheCalls += 1; } }; }, match: async () => { cacheCalls += 1; } },
    self: { location: { origin: 'https://example.test' }, registration: { scope: 'https://example.test/' },
      addEventListener: (name, handler) => { listeners[name] = handler; }, clients: { matchAll: async () => [] }, skipWaiting() {} } };
  vm.runInNewContext(swSource, context);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    for (const route of ['/api', '/api/', '/api/x', '/auth', '/auth/login', '/session', '/session/current']) {
      let responded = 0;
      listeners.fetch({ request: new Request(`https://example.test${route}?q=%2F`, { method }), respondWith: () => { responded += 1; } });
      assert.equal(responded, 0, `${method} ${route}`);
    }
  }
  assert.equal(cacheCalls, 0);
});

test('service worker does not treat encoded lookalikes or cross-origin routes as same-origin sensitive paths', () => {
  assert.match(swSource, /new URL\(request\.url\)/);
  assert.match(swSource, /url\.origin!==self\.location\.origin/);
  assert.match(swSource, /url\.pathname===root\|\|url\.pathname\.startsWith/);
  assert.doesNotMatch(swSource, /decodeURIComponent\(url\.pathname\)/);
});

test('deployment contracts keep sensitive paths out of static headers/cache shell and pin CI assumptions', () => {
  assert.match(headersSource, /^\/\*\s*$/m);
  assert.doesNotMatch(headersSource, /^\s*\/(?:api|auth|session)\//m);
  assert.match(read('docs/CLOUDFLARE_SECURITY.md'), /exact and descendant.*every success.*error.*redirect/is);
  const shell = swSource.slice(swSource.indexOf('const APP_SHELL=['), swSource.indexOf('];', swSource.indexOf('const APP_SHELL=[')) + 2);
  assert.doesNotMatch(shell, /\/(?:api|auth|session)(?:[/?`]|$)/);
  const workflow = read('.github/workflows/security-ci.yml');
  assert.match(workflow, /actions\/(?:checkout|setup-node)@\w{40}/);
  assert.match(workflow, /run: npm test/);
  assert.match(workflow, /run: npm run lint/);
});
