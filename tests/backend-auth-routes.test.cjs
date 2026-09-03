const test = require('node:test');
const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const env = {
  CF_ACCESS_TEAM_NAME: 'team-test',
  CF_ACCESS_AUD: 'aud-1',
  APP_ORIGIN: 'https://app.example',
  CSRF_HMAC_KEY: Buffer.alloc(32, 7).toString('base64'),
};
const account = { id: 'user-1', email: 'user@example.com' };
const claims = { sub: 'access-sub', email: 'user@example.com' };
const ctx = (request, data = { accessClaims: claims, account }) => ({ request, env, data });
const root = path.resolve(__dirname, '..');
const moduleUrl = (file, imports) => {
  let source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [name, target] of Object.entries(imports)) source = source.replaceAll(`'${name}'`, `'${new URL(target, `file://${root.replace(/\\/g, '/')}/`).href}'`);
  return import(`data:text/javascript,${encodeURIComponent(source)}`);
};
const load = Promise.all([
  moduleUrl('functions/session.js', { './_lib/csrf.mjs': 'functions/_lib/csrf.mjs', './_lib/http.mjs': 'functions/_lib/http.mjs' }),
  moduleUrl('functions/auth/logout.js', { '../_lib/csrf.mjs': 'functions/_lib/csrf.mjs', '../_lib/http.mjs': 'functions/_lib/http.mjs' }),
]);
const middlewareLoad = moduleUrl('functions/_middleware.js', {
  './_lib/access-jwt.mjs': 'functions/_lib/access-jwt.mjs',
  './_lib/repositories.mjs': 'functions/_lib/repositories.mjs',
  './_lib/http.mjs': 'functions/_lib/http.mjs',
  './_lib/rate-limit.mjs': 'functions/_lib/rate-limit.mjs',
});

function d1Mock(record = account) {
  let calls = 0;
  let lastBinds;
  return {
    get calls() { return calls; },
    get lastBinds() { return lastBinds; },
    prepare(sql) {
      calls += 1;
      return { bind(...binds) { lastBinds = binds; return { first: async () => sql.includes('rate_limits') ? { count: 1, window_start: 0, expires_at: 9999999999, last_allowed: 1 } : record }; } };
    },
  };
}

async function signedAccessJwt(overrides = {}) {
  const { publicKey, privateKey } = await new Promise((resolve, reject) => nodeCrypto.generateKeyPair('rsa', { modulusLength: 2048 }, (error, pub, priv) => error ? reject(error) : resolve({ publicKey: pub, privateKey: priv })));
  const now = Math.floor(Date.now() / 1000);
  const kid = `test-${nodeCrypto.randomBytes(8).toString('hex')}`;
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const payload = {
    iss: 'https://team-test.cloudflareaccess.com', aud: ['aud-1'], sub: 'access-sub', email: 'safe@example.com',
    exp: now + 60, nbf: now - 1, iat: now, ...overrides,
  };
  const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const encoded = `${b64(header)}.${b64(payload)}`;
  const signature = nodeCrypto.createSign('RSA-SHA256').update(encoded).sign(privateKey).toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' });
  Object.assign(jwk, { kid, use: 'sig', alg: 'RS256' });
  return { token: `${encoded}.${signature}`, jwk };
}

function middlewareContext(pathname, headers = {}, options = {}) {
  const request = new Request(`https://app.example${pathname}`, { method: options.method || 'GET', headers });
  const db = options.db || d1Mock();
  const context = {
    request, env: { ...env, CF_ACCESS_TEAM_NAME: 'team-test', TSB_DB: db },
    data: { keep: 'safe', account: 'attacker', accessClaims: { sub: 'attacker' }, ...(options.data || {}) },
    next: options.next || (async () => new Response(JSON.stringify({ ok: true }), { headers: { 'ACAO': '*', 'Access-Control-Allow-Credentials': 'true' } })),
  };
  return { context, db };
}

test('session returns safe unauthenticated response and no-store', async () => {
  const [{ onRequestGet }] = await load;
  const response = await onRequestGet({ env, data: { accessClaims: null, account: null } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('valid session has minimal account metadata and a CSRF response token only', async () => {
  const [{ onRequestGet }] = await load;
  const response = await onRequestGet({ env, data: { accessClaims: claims, account } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.authenticated, true);
  assert.deepEqual(body.account, account);
  assert.equal(typeof body.csrfToken, 'string');
  assert.equal('sub' in body, false);
  assert.equal('accessClaims' in body, false);
  assert.equal('jwt' in body, false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('logout requires CSRF, returns exact Access logout redirect, and rejects other methods', async () => {
  const [{ onRequestGet }, { onRequestPost, onRequest }] = await load;
  const csrf = await onRequestGet({ env, data: { accessClaims: claims, account } }).then(r => r.json()).then(x => x.csrfToken);
  const bad = await onRequestPost(ctx(new Request('https://app.example/auth/logout', { method: 'POST', headers: { Origin: env.APP_ORIGIN } })));
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('cache-control'), 'no-store');
  const good = await onRequestPost(ctx(new Request('https://app.example/auth/logout', { method: 'POST', headers: { Origin: env.APP_ORIGIN, 'X-CSRF-Token': csrf } })));
  assert.equal(good.status, 303);
  assert.equal(good.headers.get('location'), '/cdn-cgi/access/logout');
  assert.equal(good.headers.get('access-control-allow-origin'), null);
  const unsupported = await onRequest({ request: new Request('https://app.example/auth/logout', { method: 'OPTIONS' }), env, data: { accessClaims: claims, account } });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'POST');
  assert.equal(unsupported.headers.get('cache-control'), 'no-store');
  assert.equal((await onRequestPost({ request: new Request('https://app.example/auth/logout', { method: 'POST' }), env, data: {} })).status, 401);
});

test('handler failures map to a safe internal error', async () => {
  const [{ onRequestGet }] = await load;
  const response = await onRequestGet({ env: { ...env, CSRF_HMAC_KEY: 'bad' }, data: { accessClaims: claims, account } });
  const body = await response.text();
  assert.equal(response.status, 500);
  assert.equal(body, '{"error":"internal_error"}');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(body, /stack|message|bad/);
});

test('middleware allows only exact unauthenticated GET /session and protects API/auth, including trailing paths', async () => {
  const { onRequest } = await middlewareLoad;
  for (const pathname of ['/api', '/api/', '/auth', '/auth/', '/session/']) {
    let nextCalls = 0;
    const { context } = middlewareContext(pathname, { 'CF-Ray': 'safe-ray' }, { next: async () => { nextCalls += 1; return new Response('unexpected'); } });
    const response = await onRequest(context);
    assert.equal(response.status, 401, pathname);
    assert.equal(nextCalls, 0, pathname);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  let nextCalls = 0;
  const { context } = middlewareContext('/session', { 'CF-Ray': 'safe-ray' }, { next: async () => { nextCalls += 1; return new Response('ok'); } });
  const response = await onRequest(context);
  assert.equal(response.status, 200);
  assert.equal(nextCalls, 1);
  assert.equal(context.data.keep, 'safe');
  assert.equal(context.data.accessClaims, null);
  assert.equal(context.data.account, null);
  assert.equal(context.data.repositories, null);
});

test('middleware rejects any present malformed assertion, even on exact GET /session', async () => {
  const { onRequest } = await middlewareLoad;
  let nextCalls = 0;
  const { context } = middlewareContext('/session', { 'Cf-Access-Jwt-Assertion': 'not.a.jwt', 'CF-Ray': 'safe-ray' }, { next: async () => { nextCalls += 1; return new Response('unexpected'); } });
  const response = await onRequest(context);
  assert.equal(response.status, 401);
  assert.equal(nextCalls, 0);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('middleware verifies real RS256 JWT, upserts validated claims, preserves safe data, and sets safe response headers', async () => {
  const { onRequest } = await middlewareLoad;
  const { token, jwk } = await signedAccessJwt();
  const oldFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } }); };
  const db = d1Mock({ id: 'user-1', email: 'safe@example.com' });
  let nextCalls = 0;
  try {
    const { context } = middlewareContext('/api', { 'Cf-Access-Jwt-Assertion': token, 'CF-Ray': 'ray-123' }, { db, next: async () => { nextCalls += 1; return new Response('dynamic', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true' } }); } });
    const response = await onRequest(context);
    assert.equal(response.status, 200);
    assert.equal(nextCalls, 1);
    assert.equal(fetchCalls, 1);
    assert.equal(context.data.keep, 'safe');
    assert.equal(context.data.account.id, 'user-1');
    assert.equal(context.data.accessClaims.sub, 'access-sub');
    assert.equal(context.data.repositories !== null, true);
    assert.match(context.data.requestId, /^ray-123$/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-request-id'), 'ray-123');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal(response.headers.get('access-control-allow-credentials'), null);
    assert.equal(response.headers.get('content-security-policy') !== null, true);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    global.fetch = oldFetch;
  }
});

test('invalid signature, issuer, and audience never call D1 or next', async () => {
  const { onRequest } = await middlewareLoad;
  const oldFetch = global.fetch;
  try {
    for (const overrides of [{}, { iss: 'https://evil.cloudflareaccess.com' }, { aud: ['wrong'] }]) {
      const signed = await signedAccessJwt(overrides);
      const db = d1Mock();
      let nextCalls = 0;
      global.fetch = async () => new Response(JSON.stringify({ keys: [signed.jwk] }), { headers: { 'content-type': 'application/json' } });
      const { context } = middlewareContext('/auth', { 'Cf-Access-Jwt-Assertion': `${signed.token.slice(0, -1)}x` }, { db, next: async () => { nextCalls += 1; return new Response('unexpected'); } });
      if (Object.keys(overrides).length) context.request = new Request('https://app.example/auth', { headers: { 'Cf-Access-Jwt-Assertion': signed.token } });
      const response = await onRequest(context);
      assert.equal(response.status, 401);
      assert.equal(db.calls, 0);
      assert.equal(nextCalls, 0);
    }
  } finally { global.fetch = oldFetch; }
});

test('middleware maps next and D1 failures to generic 500 without leakage, and handles request-id safety/non-sensitive paths', async () => {
  const { onRequest } = await middlewareLoad;
  const oldFetch = global.fetch;
  const signed = await signedAccessJwt();
  global.fetch = async () => new Response(JSON.stringify({ keys: [signed.jwk] }), { headers: { 'content-type': 'application/json' } });
  try {
    const assertion = { 'Cf-Access-Jwt-Assertion': signed.token, 'CF-Ray': 'unsafe value' };
    const nextThrow = middlewareContext('/api', assertion, { next: async () => { throw new Error('secret-next'); } });
    const failedNext = await onRequest(nextThrow.context);
    assert.equal(failedNext.status, 500);
    assert.equal((await failedNext.text()).includes('secret-next'), false);
    assert.match(failedNext.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    assert.equal(failedNext.headers.get('cache-control'), 'no-store');
    const db = { prepare() { throw new Error('secret-db'); } };
    const { context } = middlewareContext('/api', { ...assertion, 'CF-Ray': 'ray-safe' }, { db, next: async () => new Response('unexpected') });
    const failedDb = await onRequest(context);
    assert.equal(failedDb.status, 500);
    assert.equal((await failedDb.text()).includes('secret-db'), false);
    assert.equal(failedDb.headers.get('x-request-id'), 'ray-safe');
  } finally { global.fetch = oldFetch; }
  let nonSensitiveCalls = 0;
  const nonSensitive = middlewareContext('/apiary', { 'Cf-Access-Jwt-Assertion': 'malformed' }, { next: async () => { nonSensitiveCalls += 1; return new Response('public'); } });
  const publicResponse = await onRequest(nonSensitive.context);
  assert.equal(publicResponse.status, 200);
  assert.equal(nonSensitiveCalls, 1);
});
