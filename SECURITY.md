# Security contract

This repository currently contains a static client shell. It does not claim to
contain a backend, authentication service, or production API. The following is
the contract for any future Cloudflare Pages/Workers backend and must be
implemented before sensitive server functionality is enabled.

## Browser and transport boundary

- The API is same-origin under `/api`, with authentication and session routes
  under `/auth` and `/session`. CORS is deny-by-default; do not add wildcard
  origins or credentials to cross-origin requests.
- Authentication is server-side. The browser receives no API keys, access
  tokens, refresh tokens, signing keys, or provider credentials.
- The session cookie is `Secure`, `HttpOnly`, and `SameSite=Lax` (or stricter),
  with an appropriate narrow `Path` and `__Host-` prefix where compatible.
- State-changing cookie-authenticated requests require CSRF protection: verify a
  server-issued CSRF token and the expected same-origin `Origin`/`Referer`.
- Every request body, query, path parameter, and relevant header is validated
  against a server-side schema. Reject unknown or malformed input safely.
- Every object read or mutation performs an authenticated ownership check. IDs
  supplied by the client are never authorization; prevent IDOR, including in
  D1 queries and batch endpoints.
- Apply rate limits to login, session, password/recovery, and mutation routes;
  return safe errors without revealing account existence.

## Caching and service worker

- `_headers` applies only to the static Pages shell. It does not apply to
  Pages Functions or a Worker response and must not be treated as backend
  protection.
- Every Pages Function/Worker must add the CSP and other required browser
  security headers directly to each `Response` or through shared middleware.
  This includes exact and descendant `/api`, `/auth`, and `/session` routes,
  every success, error, and redirect response.
- Every Pages Function/Worker response for API, authentication, and session
  routes must set `Cache-Control: no-store` directly (or through shared
  middleware), including exact and descendant routes and all success, error,
  and redirect responses.
- The service worker must bypass `/api`, `/auth`, and `/session` before any
  `respondWith`, cache lookup, or cache write, for every HTTP method and query.
- The static shell may use normal PWA caching. Do not apply a global `no-store`
  policy that disables it.

## Secrets, environments, and operations

- Real secrets exist only in Cloudflare Secrets, never in Cloudflare vars,
  committed files, git history, build output, or client bundles. Rotate them
  on suspected exposure and keep a documented rotation owner and procedure.
- Preview and production use separate Cloudflare projects/bindings, D1
  databases, domains, cookies, and secrets. Preview credentials must not grant
  production access.
- Logs and error reporting redact cookies, authorization headers, CSRF tokens,
  API keys, reset links, and request bodies. Do not log full credentials or
  sensitive D1 records.

Security reports should describe the affected route, environment, and impact
without including live credentials. This policy describes future requirements;
it is not evidence that a backend already exists.
