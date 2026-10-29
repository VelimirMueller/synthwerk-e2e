---
title: Sign-in journeys
slug: sign-in-journeys
status: beta
epic: E2
owner: e2e
paths: ["tests/auth/**", "src/**", "stack/compose.e2e.yaml"]
updated: 2026-10-29
---

# Sign-in journeys

> **In 30 seconds**
> - A real Chromium signs in through the edge and Zitadel login UI v2, like a user.
> - Proves synthwerk#28: passkey sign-in, forced MFA for password users, org and role claims.
> - Proves synthwerk#94: the server gives no token to a password-only sign-in, also through the Session API.

## What it does

- Invites a fresh user per test in the `demo` org with role `member` (invite only, D-51).
- Reads the invite mail in Mailpit and opens the link on the login UI `verify` page.
- Passkey: a CDP virtual authenticator (CTAP2, resident key, user verification) makes the
  passkey; a fresh browser with the same credential signs in. The ID token `amr` has `mfa`.
- Password: after the password, the login UI forces second-factor setup; the test reads
  the TOTP secret and answers. The callback never fires before that.
- Runs the studio code flow with PKCE; nothing listens on the callback, the test catches it.
- MFA gate (no browser): authorize through the edge, a password-only session with the login-client PAT, `CreateCallback` gets 403 `mfa_required`. The same session plus TOTP gets a code; the access token `amr` has `pwd`, `otp`, `mfa` (what `RequireMFA` needs).

## Rules and limits

| Rule | Value |
|---|---|
| Browser | Chromium only (CDP WebAuthn). |
| Test setup | Zitadel API on `127.0.0.1:8090` (overlay), not through the edge: the WAF blocks admin JSON. |
| Invite link | Zitadel's default points at login v1; the test sets a URL template for `/ui/v2/login/verify`. |
| Access token MFA | With the MFA gate on (synthwerk-infra `SYNTHWERK_ZITADEL_MFA_GATE=true`, ADR-0004) access tokens carry `amr`. With it off they carry none; the journeys check both. |
| MFA gate journey | Skipped when the gate is off (no request execution on `CreateCallback`). Needs `.stack/login-client.pat` (`pnpm stack:secrets`). |
| Waits | No fixed sleeps. TOTP waits for the next 30 s window with `expect.poll`. |

## Tests

- `tests/auth/passkey.spec.ts` — `passkey - invited user - enrols a passkey and signs in, token has org and role`
- `tests/auth/password-mfa.spec.ts` — `email - invited user with password - must set up MFA before the first token`
- `tests/auth/mfa-gate.spec.ts` — `session API - password only - no token; plus TOTP - token with amr mfa`
- `tests/auth/redirect-uri.spec.ts` — `authorize - unregistered redirect_uri - no redirect`
- `tests/support/playwright-image.test.ts` — image tag equals the locked Playwright, pinned by digest

## Changes

| Date | Change |
|---|---|
| 2026-10-29 | MFA gate journey; access token `amr` checks (synthwerk#94). |
| 2026-10-28 | First version (synthwerk#28 task 9, synthwerk#36 tasks 1-2 and 7). |
