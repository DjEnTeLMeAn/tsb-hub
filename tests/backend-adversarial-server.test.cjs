'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const root = path.resolve(__dirname, '..');
const load = file => import(pathToFileURL(path.join(root, file)).href);
const env = { CF_ACCESS_TEAM_NAME: 'adversarial-team', CF_ACCESS_AUD: 'adversarial-aud', APP_ORIGIN: 'https://app.example.test', ENVIRONMENT: 'production', CSRF_HMAC_KEY: Buffer.alloc(32, 7).toString('base64') };
async function jwtFixture() {
  const { publicKey, privateKey } = await new Promise((resolve, reject) => crypto.generateKeyPair('rsa', { modulusLength: 2048 }, (e, pub, priv) => e ? reject(e) : resolve({ publicKey: pub, privateKey: priv })));
  const now = Math.floor(Date.now() / 1000), kid = `redirect-${crypto.randomBytes(8).toString('hex')}`; const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64({ alg: 'RS256', kid }), payload = b64({ iss: 'https://adversarial-team.cloudflareaccess.com', aud: ['adversarial-aud'], sub: 'subject-1', exp: now + 60, nbf: now - 1, iat: now }); const signed = `${header}.${payload}`; const signature = crypto.createSign('RSA-SHA256').update(signed).sign(privateKey).toString('base64url');
  const jwk = publicKey.export({ format: 'jwk' }); Object.assign(jwk, { kid, use: 'sig', alg: 'RS256' }); return { token: `${signed}.${signature}`, jwk };
}
test('Access JWT rejects a JWKS redirect without fetching the redirected origin', async () => {
  const { verifyAccessJwt, clearAccessJwksCache } = await load('functions/_lib/access-jwt.mjs'); const signed = await jwtFixture(); const oldFetch = global.fetch; let calls = 0;
  global.fetch = async (url, options = {}) => { calls++; assert.equal(url, 'https://adversarial-team.cloudflareaccess.com/cdn-cgi/access/certs'); assert.equal(options.redirect, 'error'); return new Response(null, { status: 302, headers: { location: 'https://attacker.example/jwks' } }); };
  try { await assert.rejects(() => verifyAccessJwt(new Request('https://app.example.test/api', { headers: { 'Cf-Access-Jwt-Assertion': signed.token } }), env), /unauthorized|jwks/i); assert.equal(calls, 1); } finally { global.fetch = oldFetch; clearAccessJwksCache(); }
});
test('backend has no provider route modules', () => { const fs = require('node:fs'); for (const file of ['functions/api/v1/providers/index.js', 'functions/api/v1/providers/[provider]/credential.js', 'functions/api/v1/preferences.js']) assert.equal(fs.existsSync(path.join(root, file)), false, file); });
