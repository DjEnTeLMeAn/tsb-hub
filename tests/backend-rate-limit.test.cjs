const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const load = import('../functions/_lib/rate-limit.mjs');
const moduleUrl = (file, imports) => {
  let source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [name, target] of Object.entries(imports)) source = source.replaceAll(`'${name}'`, `'${new URL(target, `file://${root.replace(/\\/g, '/')}/`).href}'`);
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
};
const middlewareLoad = moduleUrl('functions/_middleware.js', {
  './_lib/access-jwt.mjs': 'functions/_lib/access-jwt.mjs',
  './_lib/repositories.mjs': 'functions/_lib/repositories.mjs',
  './_lib/http.mjs': 'functions/_lib/http.mjs',
  './_lib/rate-limit.mjs': 'functions/_lib/rate-limit.mjs',
});
const authEnv = { CF_ACCESS_TEAM_NAME: 'team-rate', CF_ACCESS_AUD: 'aud-rate' };

async function jwtFixture() {
  const { publicKey, privateKey } = await new Promise((resolve, reject) => nodeCrypto.generateKeyPair('rsa', { modulusLength: 2048 }, (error, pub, priv) => error ? reject(error) : resolve({ publicKey: pub, privateKey: priv })));
  const now = Math.floor(Date.now() / 1000);
  const kid = `rate-${nodeCrypto.randomBytes(8).toString('hex')}`;
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = b64({ alg: 'RS256', kid });
  const body = b64({ iss: 'https://team-rate.cloudflareaccess.com', aud: ['aud-rate'], sub: 'rate-user', email: 'rate@example.com', exp: now + 60, nbf: now - 1, iat: now });
  const signed = `${head}.${body}`;
  const sig = nodeCrypto.createSign('RSA-SHA256').update(signed).sign(privateKey).toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' });
  Object.assign(jwk, { kid, use: 'sig', alg: 'RS256' });
  return { token: `${signed}.${sig}`, jwk };
}

function mockD1(rows = []) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return { bind(...binds) { calls.push({ sql, binds }); return { first: async () => rows.shift() }; } };
    },
  };
}

test('rate limiter uses one atomic prepared upsert and only bound server identifiers', async () => {
  const { consumeRateLimit, RATE_LIMITS } = await load;
  const db = mockD1([{ count: 1, window_start: 120, expires_at: 180, last_allowed: 1 }]);
  const result = await consumeRateLimit(db, 'user-1', 'read', RATE_LIMITS.read, 125);
  assert.equal(result.allowed, true);
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /INSERT INTO rate_limits[\s\S]*ON CONFLICT\(user_id, scope\)[\s\S]*RETURNING count, window_start, expires_at, last_allowed/);
  assert.doesNotMatch(db.calls[0].sql, /SELECT|DELETE|\$\{|email|jwt|ip/i);
  assert.deepEqual(db.calls[0].binds.slice(0, 4), ['user-1', 'read', 120, 180]);
  assert.equal(db.calls[0].binds[4], 120);
  assert.equal(db.calls[0].binds[5], 120);
});

test('boundary allows limit then blocks, retry-after is bounded, and newer bucket resets', async () => {
  const { consumeRateLimit, RATE_LIMITS } = await load;
  const db = mockD1([
    { count: 5, window_start: 600, expires_at: 1200, last_allowed: 1 },
    { count: 5, window_start: 600, expires_at: 1200, last_allowed: 0 },
    { count: 1, window_start: 1200, expires_at: 1800, last_allowed: 1 },
  ]);
  const first = await consumeRateLimit(db, 'user-1', 'state_put', RATE_LIMITS.state_put, 601);
  const blocked = await consumeRateLimit(db, 'user-1', 'state_put', RATE_LIMITS.state_put, 602);
  const reset = await consumeRateLimit(db, 'user-1', 'state_put', RATE_LIMITS.state_put, 1200);
  assert.equal(first.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfter, 598);
  assert.equal(reset.allowed, true);
  assert.equal(db.calls[2].binds[2], 1200);
});

test('users and scopes are independent and scope classification ignores query/body', async () => {
  const { consumeRateLimit, rateLimitScope, RATE_LIMITS } = await load;
  assert.equal(rateLimitScope({ method: 'PUT', url: 'https://app.example/api/v1/providers/not-a-provider/credential?scope=state' }), 'mutation');
  assert.equal(rateLimitScope({ method: 'DELETE', url: 'https://app.example/api/v1/providers/gemini/credential' }), 'mutation');
  assert.equal(rateLimitScope({ method: 'PUT', url: 'https://app.example/api/v1/state?scope=credential' }), 'state_put');
  assert.equal(rateLimitScope({ method: 'GET', url: 'https://app.example/api/private?user=email@example.com' }), 'read');
  assert.equal(rateLimitScope({ method: 'POST', url: 'https://app.example/api/unknown?x=1' }), 'mutation');
  const db = mockD1([{ count: 1, window_start: 0, expires_at: 60, last_allowed: 1 }, { count: 1, window_start: 0, expires_at: 60, last_allowed: 1 }]);
  await consumeRateLimit(db, 'user-a', 'read', RATE_LIMITS.read, 1);
  await consumeRateLimit(db, 'user-b', 'read', RATE_LIMITS.read, 1);
  assert.notDeepEqual(db.calls[0].binds, db.calls[1].binds);
});

test('invalid input and D1 failures fail closed without exposing details', async () => {
  const { consumeRateLimit, RATE_LIMITS } = await load;
  await assert.rejects(() => consumeRateLimit({ prepare() { throw new Error('secret'); } }, 'user-1', 'read', RATE_LIMITS.read, 1), error => error.name === 'RateLimitError');
  await assert.rejects(() => consumeRateLimit(mockD1([{ count: 1, window_start: 0, expires_at: 60, last_allowed: 1 }]), 'email@example.com', 'read', RATE_LIMITS.read, 1), error => error.name === 'RateLimitError');
  await assert.rejects(() => consumeRateLimit(mockD1([{ count: 1, window_start: 0, expires_at: 60, last_allowed: 1 }]), 'user-1', 'read', RATE_LIMITS.read, Number.MAX_SAFE_INTEGER), error => error.name === 'RateLimitError');
  assert.equal(path.basename(root), 'tsb-hub-git');
});

test('middleware applies every actual scope policy after auth and allows exactly once', async () => {
  const { onRequest } = await middlewareLoad;
  const oldFetch = global.fetch;
  const signed = await jwtFixture();
  global.fetch = async () => new Response(JSON.stringify({ keys: [signed.jwk] }), { headers: { 'content-type': 'application/json' } });
  const cases = [
    ['PUT', '/api/v1/providers/invalid/credential', 'mutation', 30],
    ['PUT', '/api/v1/state', 'state_put', 20],
    ['POST', '/api/unknown', 'mutation', 30],
    ['GET', '/api/unknown', 'read', 120],
  ];
  try {
    for (const [method, pathname, scope, limit] of cases) {
      const calls = [];
      const db = {
        prepare(sql) {
          return {
            bind(...binds) {
              calls.push({ sql, binds });
              return {
                first: async () => sql.includes('rate_limits')
                  ? { count: 1, window_start: Math.floor(Date.now() / 60) * 60, expires_at: Math.floor(Date.now() / 1000) + 60, last_allowed: 1 }
                  : { id: 'rate-user', email: 'rate@example.com' },
              };
            },
          };
        },
      };
      let nextCalls = 0;
      const response = await onRequest({ request: new Request(`https://app.example${pathname}?email=secret`, { method, headers: { 'Cf-Access-Jwt-Assertion': signed.token, 'CF-Ray': 'scope-ray' } }), env: { ...authEnv, TSB_DB: db }, data: { safe: true }, next: async () => { nextCalls += 1; return new Response('ok'); } });
      assert.equal(response.status, 200, pathname);
      assert.equal(nextCalls, 1, pathname);
      const rateCall = calls.find(call => call.sql.includes('rate_limits'));
      assert.deepEqual(rateCall.binds.slice(0, 2), ['rate-user', scope]);
      assert.equal(rateCall.binds[4], limit);
      assert.equal(rateCall.binds[5], limit);
    }
  } finally { global.fetch = oldFetch; }
});

test('middleware returns bounded 429 and fail-closed 503 before next, while unauth session bypasses limiter', async () => {
  const { onRequest } = await middlewareLoad;
  const oldFetch = global.fetch;
  const signed = await jwtFixture();
  global.fetch = async () => new Response(JSON.stringify({ keys: [signed.jwk] }), { headers: { 'content-type': 'application/json' } });
  const makeDb = (mode, calls) => ({
    prepare(sql) {
      return {
        bind(...binds) {
          calls.push({ sql, binds });
          return {
            first: async () => {
              if (sql.includes('rate_limits')) {
                if (mode === 'failure') throw new Error('private db failure');
                return { count: mode === 'blocked' ? 5 : 1, window_start: 0, expires_at: Math.floor(Date.now() / 1000) + 60, last_allowed: mode === 'blocked' ? 0 : 1 };
              }
              return { id: 'rate-user', email: 'rate@example.com' };
            },
          };
        },
      };
    },
  });
  try {
    for (const [mode, expected, retry] of [['blocked', 429, true], ['failure', 503, false]]) {
      let nextCalls = 0;
      const calls = [];
      const request = new Request('https://app.example/api/v1/state', { method: 'GET', headers: { 'Cf-Access-Jwt-Assertion': signed.token, 'CF-Ray': 'rate-ray' } });
      const response = await onRequest({ request, env: { ...authEnv, TSB_DB: makeDb(mode, calls) }, data: {}, next: async () => { nextCalls += 1; return new Response('unexpected'); } });
      assert.equal(response.status, expected);
      assert.equal(nextCalls, 0);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-request-id'), 'rate-ray');
      assert.equal(response.headers.get('content-security-policy') !== null, true);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.equal(response.headers.get('access-control-allow-credentials'), null);
      if (retry) assert.match(response.headers.get('retry-after'), /^(?:[1-5][0-9]|60)$/);
      else assert.equal(response.headers.get('retry-after'), null);
      assert.doesNotMatch(await response.text(), /private db failure|rate@example.com|rate-user/);
    }
    const unauthDb = { prepare() { throw new Error('limiter must not run'); } };
    let unauthNext = 0;
    const unauth = await onRequest({ request: new Request('https://app.example/session'), env: { ...authEnv, TSB_DB: unauthDb }, data: {}, next: async () => { unauthNext += 1; return new Response('unauth'); } });
    assert.equal(unauth.status, 200);
    assert.equal(unauthNext, 1);
  } finally { global.fetch = oldFetch; }
});
