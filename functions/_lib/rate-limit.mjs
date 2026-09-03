const MAX_EPOCH = 4102444800;
const USER_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SCOPE = /^[a-z][a-z0-9_]{1,63}$/;

export const RATE_LIMITS = Object.freeze({
  state_put: Object.freeze({ limit: 20, windowSeconds: 60 }),
  mutation: Object.freeze({ limit: 30, windowSeconds: 60 }),
  read: Object.freeze({ limit: 120, windowSeconds: 60 }),
});

export class RateLimitError extends Error {
  constructor() { super(); this.name = 'RateLimitError'; }
}

export function rateLimitScope(request) {
  const method = String(request?.method || '').toUpperCase();
  const path = new URL(request.url).pathname;
  if (method === 'PUT' && path === '/api/v1/state') return 'state_put';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return 'mutation';
  return 'read';
}

function validate(userId, scope, policy, now) {
  if (typeof userId !== 'string' || !USER_ID.test(userId)) throw new RateLimitError();
  if (typeof scope !== 'string' || !SCOPE.test(scope) || !Object.prototype.hasOwnProperty.call(RATE_LIMITS, scope)) throw new RateLimitError();
  if (!policy || !Number.isSafeInteger(policy.limit) || policy.limit < 1 || policy.limit > 1000000 || !Number.isSafeInteger(policy.windowSeconds) || policy.windowSeconds < 1 || policy.windowSeconds > 86400) throw new RateLimitError();
  if (!Number.isSafeInteger(now) || now < 0 || now > MAX_EPOCH) throw new RateLimitError();
}

export async function consumeRateLimit(db, userId, scope, policy = RATE_LIMITS[scope], now = Math.floor(Date.now() / 1000)) {
  validate(userId, scope, policy, now);
  const windowStart = Math.floor(now / policy.windowSeconds) * policy.windowSeconds;
  const expiresAt = windowStart + policy.windowSeconds;
  if (!Number.isSafeInteger(windowStart) || !Number.isSafeInteger(expiresAt)) throw new RateLimitError();
  let result;
  try {
    result = await db.prepare(`INSERT INTO rate_limits (user_id, scope, window_start, count, expires_at, last_allowed)
      VALUES (?, ?, ?, 1, ?, 1)
      ON CONFLICT(user_id, scope) DO UPDATE SET
        window_start = CASE WHEN rate_limits.expires_at <= excluded.window_start THEN excluded.window_start ELSE rate_limits.window_start END,
        count = CASE WHEN rate_limits.expires_at <= excluded.window_start THEN 1 WHEN rate_limits.count < ? THEN rate_limits.count + 1 ELSE rate_limits.count END,
        expires_at = CASE WHEN rate_limits.expires_at <= excluded.window_start THEN excluded.expires_at ELSE rate_limits.expires_at END,
        last_allowed = CASE WHEN rate_limits.expires_at <= excluded.window_start THEN 1 WHEN rate_limits.count < ? THEN 1 ELSE 0 END
      RETURNING count, window_start, expires_at, last_allowed`)
      .bind(userId, scope, windowStart, expiresAt, policy.limit, policy.limit)
      .first();
  } catch {
    throw new RateLimitError();
  }
  if (!result || !Number.isSafeInteger(result.count) || !Number.isSafeInteger(result.expires_at) || !Number.isInteger(result.last_allowed) || ![0, 1].includes(result.last_allowed) || result.count < 1 || result.expires_at <= now) throw new RateLimitError();
  const retryAfter = Math.max(1, Math.min(86400, result.expires_at - now));
  return { allowed: result.last_allowed === 1, retryAfter, count: result.count, windowStart: result.window_start, expiresAt: result.expires_at };
}
