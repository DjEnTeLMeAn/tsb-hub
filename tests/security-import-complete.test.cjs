const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync('js/app.js', 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`missing ${name}`);
}
function makeContext() {
  const ctx = {
    MAX_BACKUP_DEPTH: 12, MAX_BACKUP_NODES: 20000, MAX_DATE_BUCKETS: 1000,
    MAX_TASKS_PER_DAY: 500, MAX_MEALS_PER_DAY: 500, MAX_SUBTASKS_PER_TASK: 100,
    MAX_IMPORTANT_DATES: 1000, MAX_STRING_LENGTH: 10000, FULL_BACKUP_TYPE: 'full', BACKUP_FORMAT_VERSION: 1,
    APP_VERSION: 'test-app',
    SAFE_ID_RE: /^[A-Za-z0-9_.:-]{1,128}$/, FORBIDDEN_KEYS: new Set(['__proto__', 'prototype', 'constructor']),
    uid: prefix => `${prefix}_generated`, fromISODate: value => new Date(`${value}T00:00:00Z`),
    toISODate: value => value.toISOString().slice(0, 10),
    validISODateTime: value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value,
    getOrCreateDeviceId: () => 'device_test',
    TSBFinanceCore: { createEmptyFinance: () => ({}) }
  };
  vm.createContext(ctx);
  vm.runInContext([
    extract('isPlainObject'), extract('boundedString'), extract('validISODateKey'), extract('safeEntityId'),
    extract('normalizeMoneyInput'), extract('normalizeSignedMoneyInput'), extract('createDefaultData'),
    extract('normalizeFinanceContext'), extract('normalizeMeta'), extract('normalizeArchives'), extract('validateFullBackup')
  ].join('\n'), ctx);
  return ctx;
}
const valid = body => `validateFullBackup(Object.assign({backupType:'full',formatVersion:1},${body})).ok`;

test('all seven formerly free-form sections reject unknown keys and type confusion', () => {
  const ctx = makeContext();
  const cases = {
    dailyReports: { '2026-08-31': { text: 'x', unknown: true } },
    gptPlans: { '2026-08-31': { text: 'x', unknown: true } },
    settings: { hideDone: 'yes' }, meta: { appVersion: 42 }, archives: { unknown: true },
    financeContext: { unknown: true },
    finance: { schemaVersion: 3, migration: {}, accounts: [], transactions: [], categories: [], incomeTypes: [], reserves: [], obligations: [], unknown: true }
  };
  for (const [section, value] of Object.entries(cases)) {
    assert.equal(vm.runInContext(valid(`{${JSON.stringify(section)}:${JSON.stringify(value)}}`), ctx), false, section);
  }
});

test('date, string and collection limits are rejected before normalization', () => {
  const ctx = makeContext();
  assert.equal(vm.runInContext(valid(`{dailyReports:{'2026-02-29':{text:'x'}}}`), ctx), false);
  assert.equal(vm.runInContext(valid(`{gptPlans:{'2026-08-31':{text:'${'x'.repeat(10001)}'}}}`), ctx), false);
  assert.equal(vm.runInContext(valid(`{dailyReports:(()=>{const out={};const start=Date.UTC(2020,0,1);for(let i=0;i<1001;i+=1)out[new Date(start+i*86400000).toISOString().slice(0,10)]={text:'x'};return out})()}`), ctx), false);
  assert.equal(vm.runInContext(valid(`{financeContext:{availableBalance:'',reserveBalance:'',savingGoal:'',financeV2Legacy:true,incomes:Array.from({length:1001},()=>({})),obligations:[],operations:[]}}`), ctx), false);
});

test('finance context normalization keeps known bounded fields and safe IDs only', () => {
  const ctx = makeContext();
  const result = vm.runInContext(`normalizeFinanceContext({
    availableBalance:{bad:true}, savingGoal:'${'x'.repeat(1200)}', unknown:'drop',
    incomes:[{id:'same',amount:'1',title:'ok'},{id:'same',amount:'2',title:'second'}],
    obligations:Array.from({length:1001},()=>({id:'obl',title:'x'})),
    operations:[{id:'__proto__',amount:'3',title:'op',unknown:true}], financeV2Legacy:false
  })`, ctx);
  assert.deepEqual(Object.keys(result).sort(), ['availableBalance','financeV2Legacy','incomes','obligations','operations','reserveBalance','savingGoal'].sort());
  assert.equal(result.availableBalance, '');
  assert.equal(result.savingGoal.length, 1000);
  assert.equal(result.obligations.length, 1000);
  assert.equal(new Set(result.incomes.map(item => item.id)).size, 2);
  assert.ok(result.operations[0].id !== '__proto__');
  assert.deepEqual(Object.keys(result.operations[0]).sort(), ['amount','comment','createdAt','date','id','sourceId','title','type'].sort());
});

test('meta and archives normalization whitelist keys and retain a real legacy backup', () => {
  const ctx = makeContext();
  const meta = vm.runInContext(`normalizeMeta({appVersion:'spoof',dataVersion:99,deviceId:'device_ok',changeCounter:4,unknown:'drop'}, {
    appVersion:'test-app',dataVersion:3,createdAt:'2026-08-31T00:00:00.000Z',lastModified:'2026-08-31T00:00:00.000Z',lastExported:'',deviceId:'device_default',changeCounter:0
  })`, ctx);
  assert.deepEqual(Object.keys(meta).sort(), ['appVersion','changeCounter','createdAt','dataVersion','deviceId','lastExported','lastModified'].sort());
  assert.equal(meta.dataVersion, 3);
  const archive = vm.runInContext(`normalizeArchives({unknown:true,financeV1MigrationBackup:{createdAt:'2026-08-31T00:00:00.000Z',finance:{'2026-08-30':{expenses:[{amount:'5',category:'food'}]}},financeContext:{reserveBalance:'50',incomes:[],obligations:[],operations:[]},unknown:'drop'}})`, ctx);
  assert.deepEqual(Object.keys(archive), ['financeV1MigrationBackup']);
  assert.equal(archive.financeV1MigrationBackup.financeContext.reserveBalance, '50');
  assert.equal(Object.prototype.hasOwnProperty.call(archive.financeV1MigrationBackup, 'unknown'), false);
});

test('archive validation rejects type-confused and oversized finance context values', () => {
  const ctx = makeContext();
  const base = `{createdAt:'2026-08-31T00:00:00.000Z',finance:{},financeContext:{availableBalance:'',reserveBalance:'',savingGoal:'',financeV2Legacy:true,incomes:[],obligations:[],operations:[]}}`;
  assert.equal(vm.runInContext(valid(`{archives:{financeV1MigrationBackup:Object.assign(${base},{financeContext:[]})}}`), ctx), false);
  assert.equal(vm.runInContext(valid(`{archives:{financeV1MigrationBackup:Object.assign(${base},{financeContext:{incomes:Array.from({length:1001},()=>({}))}})}}`), ctx), false);
  assert.equal(vm.runInContext(valid(`{archives:{financeV1MigrationBackup:Object.assign(${base},{financeContext:{savingGoal:'${'x'.repeat(1001)}'}})}}`), ctx), false);
});

test('direct NaN and Infinity payloads are rejected', () => {
  const ctx = makeContext();
  for (const number of ['NaN', 'Infinity', '-Infinity']) {
    assert.equal(vm.runInContext(valid(`{health:{'2026-08-31':{meals:[{name:'x',calories:${number}}]}}}`), ctx), false);
  }
});

test('finance rejects arbitrary fields and unsafe or duplicate IDs', () => {
  const ctx = makeContext();
  const migration = `{checkpoint:'',completedAt:'',part2Checkpoint:'',part2CompletedAt:'',legacyReserveStatus:'',legacyReserveAmount:0,legacyReserveBalanceStatus:'',legacyReserveBalanceTransactionId:'',legacyReserveBalanceRestoredAt:'',legacyObligationsMigrated:0,legacyObligationsSkipped:0}`;
  const finance = accounts => `{schemaVersion:3,migration:${migration},accounts:${accounts},categories:[],incomeTypes:[],transactions:[],reserves:[],obligations:[]}`;
  const account = id => `{id:${JSON.stringify(id)},name:'a',active:true,archived:false,isDefault:true,sortOrder:0,createdAt:'',updatedAt:''}`;
  assert.equal(vm.runInContext(valid(`{finance:${finance(`[${account('same')},${account('same')}]`)}}`), ctx), false);
  assert.equal(vm.runInContext(valid(`{finance:${finance(`[${account('__proto__')}]`)}}`), ctx), false);
  assert.equal(vm.runInContext(valid(`{finance:${finance(`[${account('x').replace("}", ",arbitrary:'bad'}")} ]`)}}`), ctx), false);
});

test('safeEntityId replaces forbidden, malformed, duplicate and overlong IDs', () => {
  const ctx = makeContext();
  const ids = vm.runInContext(`(()=>{const seen=new Set();return ['__proto__','constructor','prototype','same','same','${'a'.repeat(129)}'].map(id=>safeEntityId(id,'x',seen))})()`, ctx);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => !['__proto__', 'constructor', 'prototype'].includes(id)));
});
