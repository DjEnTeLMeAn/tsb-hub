const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const appSource = fs.readFileSync('js/app.js', 'utf8');
const financeSource = fs.readFileSync('js/finance-core.js', 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} is missing`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not read ${name}`);
}

function appContext(crypto) {
  const context = { crypto, Math: { random() { throw new Error('Math.random must not be used'); } } };
  vm.createContext(context);
  vm.runInContext(`${functionSource(appSource, 'secureRandomUUID')}\n${functionSource(appSource, 'uid')}\n${functionSource(appSource, 'isLocalDevelopment')}`, context);
  return context;
}

function financeContext(crypto) {
  const context = {
    crypto,
    Math,
    Uint8Array,
    module: { exports: {} },
    globalThis: null
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(financeSource, context);
  return context;
}

function cryptoFixture({ uuid, bytes = 0x00 } = {}) {
  const calls = { uuid: 0, values: 0 };
  return {
    calls,
    crypto: {
      ...(uuid ? { randomUUID() { calls.uuid += 1; return uuid; } } : {}),
      getRandomValues(buffer) {
        calls.values += 1;
        buffer.fill(bytes);
        return buffer;
      }
    }
  };
}

test('ID generators use randomUUID when available and preserve prefixes', () => {
  const fixture = cryptoFixture({ uuid: '11111111-2222-4333-8444-555555555555' });
  const app = appContext(fixture.crypto);
  assert.equal(vm.runInContext("uid('task')", app), 'task_11111111-2222-4333-8444-555555555555');
  assert.equal(fixture.calls.uuid, 1);

  const finance = financeContext(fixture.crypto);
  assert.equal(finance.module.exports.makeId('txn'), 'txn_11111111-2222-4333-8444-555555555555');
  assert.equal(fixture.calls.uuid, 2);
});

test('ID generators fall back to Web Crypto getRandomValues with UUID v4 bits', () => {
  const fixture = cryptoFixture({ bytes: 0x00 });
  const app = appContext(fixture.crypto);
  const id = vm.runInContext("uid('device')", app);
  assert.match(id, /^device_00000000-0000-4000-8000-000000000000$/);
  assert.equal(fixture.calls.values, 1);

  const finance = financeContext(fixture.crypto);
  assert.match(finance.module.exports.makeId('acct'), /^acct_00000000-0000-4000-8000-000000000000$/);
  assert.equal(fixture.calls.values, 2);
});

test('debug requires explicit flag and local hostname', () => {
  const context = appContext(cryptoFixture().crypto);
  const enabled = location => vm.runInContext(`isLocalDevelopment(${JSON.stringify(location)}, true)`, context);
  const disabled = location => vm.runInContext(`isLocalDevelopment(${JSON.stringify(location)}, false)`, context);
  assert.equal(enabled({ hostname: 'localhost' }), true);
  assert.equal(enabled({ hostname: '127.0.0.1' }), true);
  assert.equal(enabled({ hostname: '[::1]' }), true);
  assert.equal(disabled({ hostname: 'localhost' }), false);
  assert.equal(enabled({ hostname: 'example.com' }), false);
  assert.equal(enabled({ hostname: 'app.example.com' }), false);
  assert.doesNotMatch(appSource, /new URLSearchParams\(window\.location\.search\).*debug/);
});

test('ID implementations contain no Math.random or timestamp entropy', () => {
  assert.doesNotMatch(functionSource(appSource, 'uid'), /Math\.random|Date\.now/);
  assert.doesNotMatch(functionSource(appSource, 'secureRandomUUID'), /Math\.random|Date\.now/);
  assert.doesNotMatch(financeSource.slice(financeSource.indexOf('const secureRandomUUID'), financeSource.indexOf('const text')), /Math\.random|Date\.now/);
});
