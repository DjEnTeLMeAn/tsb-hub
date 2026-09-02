# Cloudflare Pages security contract

This is a deployment contract for the future backend. The present project is a
static Pages shell; no backend or authentication implementation is asserted by
this document.

## Required route contract

Use same-origin routes: `/api/*` for application data, `/auth/*` for login and
recovery, and `/session/*` for session lifecycle. CORS is deny-by-default; no
wildcard `Access-Control-Allow-Origin`, and no credentialed cross-origin API.

Workers must authenticate on the server and establish sessions with cookies
that are `Secure`, `HttpOnly`, and `SameSite=Lax` or stricter. The client must
never receive API keys, provider tokens, access/refresh tokens, signing
secrets, or database credentials. Cookie-authenticated state changes require
CSRF validation plus same-origin `Origin`/`Referer` checks.

Before a handler reaches D1, validate path parameters, query parameters,
headers, and JSON bodies with a server-side schema. Use authenticated user
identity—not a client-supplied user ID—for authorization. Every D1 select,
update, delete, and batch operation must constrain rows by the authenticated
owner; add explicit ownership/IDOR tests for every resource.

Rate-limit login, recovery, session refresh, and mutations. Use bounded request
sizes, safe generic authentication errors, and consistent failure responses.

## Cache and service-worker rules

The Pages `_headers` file applies only to the static shell; it does not apply
to Pages Functions or a Worker-generated `Response`. Functions/Worker code
must add CSP and every other required browser security header directly to each
`Response` or in shared middleware.

Each Functions/Worker response for `/api`, `/auth`, and `/session` must set
`Cache-Control: no-store` directly or through that shared middleware. This
requirement covers exact and descendant routes, every success, error, and
redirect response. The service worker must bypass these paths before
`respondWith`, cache reads, or cache writes regardless of method or query
string. Static HTML, JS, CSS, and manifest assets may retain normal PWA
caching; there must be no global `no-store` header.

## Cloudflare configuration and operations

Production and preview must be separate Pages/Workers environments with
separate domains, D1 bindings/databases, cookie scope, and secrets. Preview
must not access production data or credentials.

Store real secret values only with Cloudflare Secrets (for example, `wrangler
secret put`), never in `vars`, `.env` committed to git, build artifacts, or
browser code. Rotate secrets after exposure and during the documented rotation
cycle. Redact cookies, authorization values, CSRF tokens, API keys, reset
links, and request bodies from Workers, D1, and observability logs.

The `_headers` file supplies the static-shell browser policy: same-origin CSP
with `frame-ancestors 'none'`, clickjacking protection, MIME sniffing
protection, strict referrer handling, disabled unnecessary browser features,
and same-origin opener isolation. It does not implement authentication or
replace server-side authorization.
