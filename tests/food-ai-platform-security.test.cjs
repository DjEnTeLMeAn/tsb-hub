const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const root = require('node:path').resolve(__dirname, '..');
const read = file => fs.readFileSync(require('node:path').join(root, file), 'utf8');
const index = read('index.html');
const headers = read('_headers');
const sw = read('service-worker.js');
const client = read('js/food-ai-client.js');
const qwenClient = read('js/qwen-food-ai-client.js');
const csp = "default-src 'self'; script-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com https://dashscope-intl.aliyuncs.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; worker-src 'self'; manifest-src 'self'";

test('Gemini CSP is exact and aligned', () => {
  assert.equal(index.match(/Content-Security-Policy" content="([^"]+)/)[1], csp);
  assert.match(headers, new RegExp(`connect-src 'self' https://generativelanguage\\.googleapis\\.com`));
  assert.doesNotMatch(csp, /connect-src[^;]*(?:\*|data:|blob:)/);
  assert.match(csp, /connect-src 'self' https:\/\/generativelanguage\.googleapis\.com https:\/\/dashscope-intl\.aliyuncs\.com/);
  assert.doesNotMatch(csp, /connect-src[^;]*\*/);
});
test('food AI shell order and cache entries are present', () => {
  assert.ok(index.indexOf('js/food-ai-client.js') < index.indexOf('js/app.js'));
  assert.ok(index.indexOf('js/qwen-food-ai-client.js') < index.indexOf('js/app.js'));
  assert.match(sw, /`\.\/js\/food-ai-client\.js\?v=\$\{RELEASE\}`/);
  assert.match(sw, /`\.\/js\/qwen-food-ai-client\.js\?v=\$\{RELEASE\}`/);
  assert.match(client, /TSBFoodAIClient/);
  assert.match(client, /analyzeFoodPhoto/);
  assert.match(qwenClient, /TSBQwenFoodAIClient/);
  assert.match(qwenClient, /analyzeFoodPhoto/);
  assert.doesNotMatch(client, /getUserMedia/);
});
test('SW never caches cross-origin Gemini or Qwen traffic', () => {
  assert.match(sw, /if\(url\.origin!==self\.location\.origin\)return;/);
  assert.match(client, /generativelanguage\.googleapis\.com/);
  assert.match(client, /x-goog-api-key/);
  assert.doesNotMatch(client, /[?&](?:key|apiKey)=/i);
  assert.match(qwenClient, /dashscope-intl\.aliyuncs\.com/);
  assert.match(qwenClient, /Authorization:'Bearer '\+k/);
  assert.doesNotMatch(qwenClient, /[?&](?:key|apiKey|token)=/i);
  assert.match(client, /const ORIGIN = 'https:\/\/generativelanguage\.googleapis\.com'/);
  assert.match(qwenClient, /const ORIGIN = 'https:\/\/dashscope-intl\.aliyuncs\.com'/);
  assert.match(sw, /url\.origin!==self\.location\.origin/);
});
test('docs state the constrained direct Gemini model', () => {
  for (const file of ['README.md', 'SECURITY.md', 'docs/CLOUDFLARE_SECURITY.md', 'docs/BACKEND_ARCHITECTURE.md']) {
    const text = read(file);
    assert.match(text, /Food photo/); assert.match(text, /OpenAI/); assert.match(text, /Anthropic/);
    assert.match(text, /backup|sync/i); assert.match(text, /CORS/i); assert.match(text, /approximate|приблизитель/i);
  }
});
