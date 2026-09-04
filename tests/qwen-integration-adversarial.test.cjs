const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('js/app.js');
const qwen = read('js/qwen-food-ai-client.js');
const index = read('index.html');
const headers = read('_headers');
const sw = read('service-worker.js');

test('Qwen integration has one fixed provider origin and one fixed model', () => {
  assert.match(qwen, /const ORIGIN = 'https:\/\/dashscope-intl\.aliyuncs\.com'/);
  assert.match(qwen, /const DEFAULT_MODEL = 'qwen3\.8-flash'/);
  assert.match(qwen, /o\.model!==undefined&&o\.model!==DEFAULT_MODEL/);
  assert.doesNotMatch(qwen, /(?:baseURL|origin|endpoint)\s*=\s*o\./i);
  assert.match(qwen, /model:DEFAULT_MODEL/);
  assert.match(app, /provider==='qwen'\s*\?\s*window\.TSBQwenFoodAIClient/);
  assert.match(app, /foodQwenModel\(value\)[\s\S]{0,180}model === 'qwen3\.8-flash'/);
});

test('Qwen key is never transported outside the Authorization header', () => {
  assert.match(qwen, /Authorization:'Bearer '\+k/);
  assert.doesNotMatch(qwen, /[?&](?:key|apiKey|token)=/i);
  assert.doesNotMatch(qwen, /console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(qwen, /(?:localStorage|sessionStorage|indexedDB|backup|state|serviceWorker)[\s\S]{0,180}(?:apiKey|Authorization|Bearer)/i);
  assert.match(qwen, /cache:'no-store'/);
  assert.match(qwen, /referrerPolicy:'no-referrer'/);
});

test('Qwen transport and image/response limits are explicit and finite', () => {
  for (const invariant of [
    /MAX_DIMENSION = 1280/, /JPEG_QUALITY = 0\.78/, /MAX_PREPARED = 3 \* 1024 \* 1024/,
    /MAX_RESPONSE = 512 \* 1024/, /setTimeout\([^\n]*20000/
  ]) assert.match(qwen, invariant);
  assert.match(qwen, /response_format:\{type:'json_object'\}/);
  assert.match(qwen, /stream:false/);
  assert.match(qwen, /Number\.isFinite/);
  assert.match(qwen, /finish_reason!=='stop'/);
  assert.match(qwen, /startsWith\('```'\)|includes\('```'\)/);
});

test('Qwen OpenAI-compatible envelope and nested food payload are strict', () => {
  assert.match(qwen, /!Array\.isArray\(c\)\|\|c\.length!==1/);
  assert.match(qwen, /finish_reason!=='stop'/);
  assert.match(qwen, /c\[0\]\?\.message\?\.role!=='assistant'/);
  assert.match(qwen, /typeof c\[0\]\?\.message\?\.content!=='string'/);
  assert.match(qwen, /const keys=Object\.keys\(v\)/);
  assert.match(qwen, /keys\.length!==FIELDS\.length/);
  assert.match(qwen, /keys\.some\(k=>!FIELDS\.includes\(k\)\)/);
  assert.match(qwen, /FIELDS\.some\(k=>!Object\.hasOwn\(v,k\)\)/);
});

test('cancel, timeout, stale request, and date switch cannot commit a result', () => {
  assert.match(qwen, /o\.signal\?\.addEventListener\('abort'/);
  assert.match(qwen, /timed\?\s*'TIMEOUT'\s*:\s*'ABORTED'/);
  assert.match(app, /ai\.requestId!==requestId/);
  assert.match(app, /ai\.date!==state\.selectedDate/);
  assert.match(app, /state\.foodAi\?\.controller\?\.abort\(\)/);
});

test('editable result is explicitly confirmed and saved exactly once', () => {
  assert.match(app, /data-food-ai-field="name"/);
  assert.match(app, />Подтвердить и сохранить<\/button>/);
  const saveStart = app.indexOf("$('[data-food-ai-save]', root)?.addEventListener");
  const saveHandler = app.slice(saveStart, saveStart + 1800);
  assert.match(saveHandler, /!ai\.result\|\|ai\.status!=='result'/);
  assert.equal((saveHandler.match(/getHealth\(\)\.meals\.push\(/g) || []).length, 1);
  assert.ok(saveHandler.indexOf('getHealth().meals.push(') < saveHandler.indexOf("ai.status='saved'"));
});

test('release shell and service worker allow only the fixed Qwen API', () => {
  assert.match(index, /js\/qwen-food-ai-client\.js\?v=/);
  assert.match(sw, /js\/qwen-food-ai-client\.js\?v=\$\{RELEASE\}/);
  assert.match(sw, /url\.origin!==self\.location\.origin\)return/);
  assert.match(index, /connect-src 'self' https:\/\/generativelanguage\.googleapis\.com https:\/\/dashscope-intl\.aliyuncs\.com/);
  assert.match(headers, /connect-src 'self' https:\/\/generativelanguage\.googleapis\.com https:\/\/dashscope-intl\.aliyuncs\.com/);
});
