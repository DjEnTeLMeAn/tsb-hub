# Cloudflare security status

The backend foundation is implemented locally with Pages Functions, D1, and Cloudflare Access, but is not provisioned or deployed. The client is not connected; the local vault is not deployed. Backend scope is accounts/state only.

## API-key boundary

After installation, the user enters the provider API key on the phone. The local vault stores an encrypted value in IndexedDB and uses a non-extractable Web Crypto AES-GCM device key. Plaintext is memory-only and never persistent. The key is excluded from repository/GitHub, builds and bundles, service-worker cache, app backup, state sync, D1, and server logs.

Provider/preference local-only values are restricted to `openai`, `anthropic`, and `gemini`; local provider/model selection and the vault are implemented.
The removed server encrypted credential vault and `AI_CREDENTIAL_KEK` are absent from the target model and are not accepted by this contract.

There are no real provider API calls or proxy routes. A future design may use direct CORS where supported or an audited fixed-allowlist proxy receiving the key transiently per request, with no persistence, logging, or caching. It is not implemented. A new proxy requires a separate audit.

The threat model covers GitHub/backup exposure and casual IndexedDB inspection. It does not cover active same-origin XSS, compromised JavaScript, or a malicious device: app code can call decrypt. The user accepts this limitation.

## Required route and response contract

Use same-origin routes: `/api/*` for application state, `/auth/*` for session lifecycle, and `/session/*` for session summary. CORS is deny-by-default; no wildcard `Access-Control-Allow-Origin` and no credentialed cross-origin API.

Authentication, authorization, input validation, and ownership checks are server-side. D1 operations are account-scoped and client IDs are not authority. If a future app cookie is introduced it must be `Secure`, `HttpOnly`, and `SameSite=Lax` or stricter. Cookie-authenticated mutations require CSRF and same-origin `Origin`/`Referer` checks.

Dynamic Functions/Worker responses must add security headers and `Cache-Control: no-store` directly for exact and descendant `/api`, `/auth`, and `/session` routes, on every success, error, and redirect. The static `_headers` file does not apply to Pages Functions. The service worker bypasses these paths before cache reads/writes for every method and query; static shell assets may retain normal PWA caching.

## Accounts/state-only deployment runbook

1. Create separate private preview and production D1 databases for accounts/state and keep IDs private.
2. Configure private Wrangler/Pages bindings; never commit IDs or secrets.
3. Apply and verify state migrations `0001`, then `0002`, independently in each environment.
4. Configure Cloudflare Access team, application AUD, and exact app origin.
5. Configure the unauthenticated `/session` edge perimeter limit and deploy preview.
6. Run the server adversarial audit, then integrate client sync only after approval; repeat verified configuration for production.

No credential KEK or provider migration belongs in this runbook. Real provider integrations remain unaudited and unimplemented.
