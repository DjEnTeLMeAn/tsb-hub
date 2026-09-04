const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const version = JSON.parse(read('version.json'));
const expectedRelease = version.release;
const index = read('index.html');
const sw = read('service-worker.js');
const bootstrap = read('js/bootstrap.js');
const gitignore = read('.gitignore');

const expectedCsp = "default-src 'self'; script-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com https://dashscope-intl.aliyuncs.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; worker-src 'self'; manifest-src 'self'";

test('index has the exact restrictive CSP and only external scripts', () => {
  const csp = index.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/>/i)?.[1];
  assert.equal(csp, expectedCsp);
  assert.equal(typeof expectedRelease, 'string');
  assert.notEqual(expectedRelease, '');
  assert.ok(index.includes(`<meta name="tsb-release" content="${expectedRelease}"/>`));
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/i);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-eval/i);
  assert.doesNotMatch(index, /<script(?:\s[^>]*)?>(?!\s*<\/script>)[\s\S]*?<\/script>/i);
  assert.ok(index.includes(`<script defer src="js/bootstrap.js?v=${expectedRelease}"></script>`));
  assert.ok(bootstrap.includes(`window.TSB_RELEASE='${expectedRelease}'`));
  assert.match(bootstrap, /addEventListener\(['"]load['"]/);
});

test('service worker uses the version.json release for cache identity and shell URLs', () => {
  assert.ok(sw.includes(`const RELEASE='${expectedRelease}'`));
  assert.ok(sw.includes('const CACHE_NAME=`tsb-hub-${RELEASE}`'));
  assert.ok(sw.includes('`./index.html?v=${RELEASE}`'));
  assert.ok(sw.includes('`./js/bootstrap.js?v=${RELEASE}`'));
  assert.ok(sw.includes('`./js/qwen-food-ai-client.js?v=${RELEASE}`'));
});

test('sensitive same-origin paths bypass the service worker before cache branches', () => {
  const bypass = sw.indexOf("sensitiveRoots.some");
  const method = sw.indexOf("request.method!=='GET'");
  const respond = sw.indexOf('event.respondWith', bypass);
  assert.ok(bypass >= 0);
  assert.ok(method > bypass);
  assert.ok(respond > method);
  assert.match(sw, /const sensitiveRoots=\['\/api','\/auth','\/session'\]/);
});

test('sensitive paths never call respondWith or Cache Storage, regardless of method/query', () => {
  const listeners = {};
  let cachePuts = 0;
  const context = {
    URL,
    Request,
    fetch: async () => new Response('network'),
    caches: { open: async () => ({ put: async () => { cachePuts += 1; } }), match: async () => undefined, keys: async () => [] },
    self: {
      location: { origin: 'https://example.test' },
      registration: { scope: 'https://example.test/' },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      clients: { matchAll: async () => [] },
      skipWaiting: () => {}
    }
  };
  vm.runInNewContext(sw, context);
  for (const method of ['GET', 'POST', 'PUT']) {
    for (const pathName of ['/api', '/api/items', '/auth?next=/x', '/auth/login', '/session?refresh=1', '/session/current']) {
      let respondCalls = 0;
      listeners.fetch({
        request: new Request(`https://example.test${pathName}`, { method }),
        respondWith: () => { respondCalls += 1; }
      });
      assert.equal(respondCalls, 0, `${method} ${pathName} must bypass`);
    }
  }
  assert.equal(cachePuts, 0);
});

test('APP_SHELL includes bootstrap and no sensitive API entries', () => {
  assert.match(sw, /`\.\/js\/bootstrap\.js\?v=\$\{RELEASE\}`/);
  const shell = sw.slice(sw.indexOf('const APP_SHELL=['), sw.indexOf('];', sw.indexOf('const APP_SHELL=[')) + 2);
  assert.doesNotMatch(shell, /\/api(?:[/?`]|$)|\/auth(?:[/?`]|$)|\/session(?:[/?`]|$)/);
});

test('.gitignore protects secrets, local tooling, backups, and temporary files', () => {
  for (const entry of ['.env', '.env.*', '!.env.example', '.dev.vars', '.wrangler/', 'node_modules/', 'backups/**/*.json', 'backups/**/*.csv', '.DS_Store', '.vscode/', '*.tmp']) {
    assert.match(gitignore, new RegExp(`^${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  }
  assert.doesNotMatch(gitignore, /tests\//);
  assert.doesNotMatch(gitignore, /\.js$/m);
});
