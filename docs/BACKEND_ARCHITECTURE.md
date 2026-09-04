# Backend architecture and deployment contract

The repository contains a locally implemented Cloudflare Pages Functions + D1 + Cloudflare Access foundation. It has not been provisioned or deployed. This does not claim a deployed backend. The client sync is not connected; the client remains disconnected and the local vault is not deployed. Backend foundation scope is accounts/state only.

## Local provider credential vault

The provider API key is entered after installation and stays on the phone. The vault stores only encrypted data in IndexedDB and uses a non-extractable Web Crypto AES-GCM device key. Plaintext may exist transiently in memory during use, but is never persistent. No key is in repository/GitHub, build output/bundle, service-worker cache, app backup, state sync, D1, or server logs.

OpenAI and Gemini Food photo are implemented via direct browser requests. Anthropic is not implemented. Keys remain local, and the photo is sent to the selected provider only after explicit provider selection. Direct client API/CORS and billing risks apply; a backend provider proxy is not implemented.

The legacy server encrypted credential vault was removed. `AI_CREDENTIAL_KEK` was removed too. The legacy label “encrypted per-user AI provider vault” is historical only. There is no server-side provider-key storage.

Nutrition values (mass, calories, and macros) are approximate. The user must review, correct if needed, and confirm them before saving; this is not medical advice.

## Authority and response invariants

- Cloudflare Access is the account authority. There are no application passwords or password-reset flows.
- Authenticated requests validate Access JWT signature, issuer (`iss`), audience, and expiry. The account comes from validated Access claims, never a client account ID; this is the IDOR boundary.
- All dynamic responses use `Cache-Control: no-store` and required security headers. Exact and descendant `/api`, `/auth`, and `/session` routes receive this policy on every success, error, and redirect.
- CORS is deny-by-default and same-origin. Never add wildcard ACAO or credentialed cross-origin requests.
- If a future application cookie is introduced, it must be Secure, HttpOnly, and SameSite=Lax or stricter. Cookie-authenticated mutations require HMAC CSRF and exact allowlisted `Origin`.
- State remains whole-state optimistic concurrency with exact revision, canonical schema/hash validation, and a practical 1 MiB body cap.
- `GET /session` returns only a safe account/session summary; it never returns provider keys. A future application cookie remains subject to the Secure, HttpOnly, SameSite contract above.
- The foundation's route vocabulary includes `GET /api/v1/state` and `PUT /api/v1/state`; no provider key is returned or persisted server-side.

## Route surface

The local foundation documents `/session`, `/auth/logout`, and `/api/v1/state`. It has no provider credential route or provider proxy. Gemini Food photo calls go directly from the browser to Google Gemini; no OpenAI or Anthropic call exists.

## Threat model and future provider access

The local vault helps prevent GitHub/backup exposure and makes casual IndexedDB inspection harder. It does not protect against active same-origin XSS, compromised JavaScript, or a malicious device, because application code can call decrypt. The user accepts this limitation; non-extractability does not stop code running with the app origin.

A future provider integration may use direct CORS where supported, or an audited fixed-allowlist server-side proxy. Such a proxy could receive the key transiently per request only and must not persist, log, or cache it. This is not implemented and requires a separate server security audit, including arbitrary base URL rejection, SSRF, allowlist, redaction, replay, quotas, and no-store behavior.

Security review also covers backup bombs, log leaks, and Secret rotation as accounts/state operational concerns; these do not reintroduce a provider vault.

## Deployment runbook

1. Create separate private preview and production D1 databases for accounts/state; never share IDs.
2. Configure private Wrangler/Pages bindings; do not commit IDs, secrets, or build artifacts containing credentials.
3. Apply and verify state migrations `0001`, then `0002`, independently in each environment.
4. Configure Cloudflare Access team, application AUD, exact origin, and the unauthenticated `/session` edge perimeter limit.
5. Deploy preview and run the server adversarial audit.
6. Only after audit approval integrate client sync and repeat verified configuration for production.

This runbook has no credential KEK and no provider credential migrations. The server audit status is honest: accounts/state foundation is locally implemented, while provider integration/proxy is absent and unaudited. `wrangler secret put` is not used for provider credentials.
