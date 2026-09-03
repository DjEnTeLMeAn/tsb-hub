# Security status and contract

## Credential boundary

The provider API key is entered by the user after installation and is local-only on the phone. The local vault stores only an encrypted value in IndexedDB and uses a non-extractable Web Crypto AES-GCM device key. Plaintext exists only transiently in memory while needed; plaintext is never persistent.

The key must never be present in the repository, GitHub, build output or client bundle, service-worker cache, app backup, state sync, D1, or server logs. It is not sent to the backend foundation. Local-only provider/preference values are allowlisted to `openai`, `anthropic`, and `gemini`; local provider/model selection and the vault are implemented.

The old server encrypted credential vault and `AI_CREDENTIAL_KEK` are removed. D1 remains accounts/state only; no server credential vault, provider-key storage, credential KEK, or provider credential migration is part of this contract.

## Honest threat model

This design protects against accidental placement in GitHub and backups and makes casual IndexedDB inspection harder. It does not protect against active same-origin XSS, compromised JavaScript, or a malicious device, because application code can call decrypt. The user accepts this residual risk. A non-extractable key is not a defense against code already executing with the app's origin.

## Backend foundation status

The Cloudflare Pages Functions/D1/Access backend foundation is implemented locally but not provisioned or deployed; the client sync is not connected and local vault is not deployed. The foundation is accounts/state only. There are no real provider API calls or provider proxy yet.

Any future implementation must be explicitly audited: direct CORS where supported, or an audited fixed-allowlist proxy that receives the key transiently per request and never stores, logs, or caches it. This is a future option, not an implemented feature. A new proxy requires a separate server security audit.

## Preserved browser and transport contract

- The API is same-origin under `/api`, with authentication and session routes under `/auth` and `/session`. CORS is deny-by-default; do not add wildcard origins or credentials to cross-origin requests.
- Authentication and authorization are server-side. The browser receives no server access/refresh tokens or signing keys; the local provider key remains local-only.
- If a future application cookie is introduced, it must be `Secure`, `HttpOnly`, and `SameSite=Lax` (or stricter), with an appropriate narrow `Path` and `__Host-` prefix where compatible.
- State-changing cookie-authenticated requests require CSRF protection and expected same-origin `Origin`/`Referer`.
- Validate bodies, queries, paths, and headers with a server-side schema; every D1 read or mutation is scoped to the authenticated owner. Client IDs are never authorization.
- Apply a rate limit using a fixed-window policy to session and mutation routes and return safe errors.

## Caching, deployment, and audit

`_headers` applies only to the static Pages shell. Functions/Workers must set required security headers and `Cache-Control: no-store` directly for exact and descendant `/api`, `/auth`, and `/session` routes, including every success, error, and redirect. The service worker must bypass those prefixes before cache lookup/write for every method and query; static shell assets may use normal PWA caching.

Preview and production use separate Cloudflare environments, D1 resources, domains, and Access configuration. The runbook is limited to accounts/state: private D1 IDs, Wrangler/Pages binding setup, state migrations `0001` and `0002`, Access team/AUD/origin, preview deployment, and audit. It contains no credential KEK or provider migrations.

Cloudflare Secrets may hold future backend operational secrets, but never the local provider API key; there is no provider credential secret to configure.

Operational secret rotation remains required for any future backend secret; it does not apply to a local provider key.

Security reports must not include live credentials. Redact authorization headers, cookies, CSRF tokens, request bodies, API keys, and sensitive D1 records from logs and error reporting.
