import { verifyAccessJwt } from './_lib/access-jwt.mjs';
import { createRepositories } from './_lib/repositories.mjs';
import { errorResponse, securityHeaders } from './_lib/http.mjs';
import { consumeRateLimit, rateLimitScope, RATE_LIMITS, RateLimitError } from './_lib/rate-limit.mjs';

const SENSITIVE = /^\/(?:api|auth|session)(?:\/|$)/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const SAFE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function isSensitive(request) {
  return SENSITIVE.test(new URL(request.url).pathname);
}

function requestId(request) {
  const ray = request.headers.get('CF-Ray');
  return ray && SAFE_REQUEST_ID.test(ray) ? ray : crypto.randomUUID();
}

function safeEmail(value) {
  if (typeof value !== 'string' || value.length > 320 || CONTROL.test(value) || !SAFE_EMAIL.test(value)) return null;
  return value;
}

function responseWithSecurity(response, id, extraHeaders = {}) {
  const headers = securityHeaders(response?.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Request-ID', id);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  headers.delete('Access-Control-Allow-Origin');
  headers.delete('Access-Control-Allow-Credentials');
  return new Response(response?.body ?? null, { status: response?.status ?? 500, statusText: response?.statusText, headers });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!isSensitive(request)) return context.next();
  const id = requestId(request);
  try {
    const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
    const path = new URL(request.url).pathname;
    const isSessionGet = path === '/session' && request.method === 'GET';
    if (assertion === null && isSessionGet) {
      context.data = { ...(context.data || {}), accessClaims: null, account: null, repositories: null, requestId: id };
    } else {
      if (assertion === null) return responseWithSecurity(errorResponse(401), id);
      let accessClaims;
      try {
        accessClaims = await verifyAccessJwt(request, env);
      } catch {
        return responseWithSecurity(errorResponse(401), id);
      }
      const repositories = createRepositories(env.TSB_DB);
      const account = await repositories.ensureUserFromAccess(
        accessClaims.sub,
        safeEmail(accessClaims.email),
        new Date().toISOString(),
      );
      context.data = { ...(context.data || {}), accessClaims, account, repositories, requestId: id };
      const scope = rateLimitScope(request);
      const decision = await consumeRateLimit(env.TSB_DB, account.id, scope, RATE_LIMITS[scope]);
      if (!decision.allowed) return responseWithSecurity(errorResponse(429), id, { 'Retry-After': String(decision.retryAfter) });
    }
    return responseWithSecurity(await context.next(), id);
  } catch (error) {
    return responseWithSecurity(error instanceof RateLimitError ? errorResponse(503) : errorResponse(500), id);
  }
}
