const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const headers = read('_headers');
const envExample = read('.env.example');
const security = read('SECURITY.md');
const cloudflareSecurity = read('docs/CLOUDFLARE_SECURITY.md');
const contract = `${security}\n${cloudflareSecurity}`;
const expectedCsp = "default-src 'self'; script-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'";

test('Cloudflare static shell headers enforce the agreed browser policy', () => {
  const activeRules = headers
    .split(/\r?\n/)
    .filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#') && !/^[ \t]/.test(line);
    })
    .map(line => line.trim());
  assert.deepEqual(activeRules, ['/*'], 'the first active _headers rule must be /*');
  const escapedCsp = expectedCsp.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
  const shellBlock = headers.slice(headers.indexOf('/*'));
  assert.match(shellBlock, new RegExp(`Content-Security-Policy: ${escapedCsp}`));
  for (const line of [
    'X-Content-Type-Options: nosniff',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=\\(\\), microphone=\\(\\), geolocation=\\(\\)',
    'Cross-Origin-Opener-Policy: same-origin',
    'X-Frame-Options: DENY'
  ]) assert.match(headers, new RegExp(line));
  assert.doesNotMatch(shellBlock, /Permissions-Policy:[^\r\n]*(?:\*|\bself\b)/i);
  assert.doesNotMatch(headers, /^[ \t]*\/(?:api|auth|session)\/\*/im,
    '_headers must not imply backend cache protection');
});

test('environment example contains only non-secret placeholders', () => {
  assert.match(envExample, /^PUBLIC_API_BASE_PATH=\/api$/m);
  assert.match(envExample, /^PUBLIC_APP_ENV=local$/m);
  assert.doesNotMatch(envExample, /(?:sk-|Bearer\s+|AIza|-----BEGIN|eyJ[A-Za-z0-9_-]{20,})/i);
  assert.doesNotMatch(envExample, /(?:SECRET|TOKEN|PASSWORD|PRIVATE[_-]?KEY|API[_-]?KEY)\s*=/i);
  assert.match(envExample, /Cloudflare Secrets/);
  assert.match(envExample, /Cloudflare vars, git, or client-side code/i);
});

test('future backend contract covers authentication, authorization, privacy, and isolation', () => {
  for (const requirement of [
    /same-origin/i, /server-side/i, /Secure.*HttpOnly.*SameSite/is, /CSRF/i,
    /server-side schema/i, /ownership|IDOR/i, /rate limit/i, /D1.*owner|owner.*D1/is,
    /Cache-Control: no-store/i, /service worker.*bypass|bypass.*service worker/is,
    /CORS.*deny-by-default|deny-by-default.*CORS/is, /preview.*production|production.*preview/is,
    /rotation/i, /redact/i, /never.*(?:API keys|provider tokens|access.*tokens)/is
  ]) assert.match(contract, requirement);
  assert.match(contract, /_headers.*(?:does not apply|not apply).*Pages Functions/is);
  assert.match(contract, /Functions.*Worker.*(?:Response|middleware)/is);
  assert.match(contract, /exact and descendant.*success.*error.*redirect/is);
  assert.match(contract, /does not claim|does not assert|not.*backend|no backend/i);
});
