# synthwerk-e2e

End-to-end journeys for [Synthwerk](https://github.com/VelimirMueller/synthwerk): a real
Chromium against the real stack from
[synthwerk-infra](https://github.com/VelimirMueller/synthwerk-infra). No fakes for sign-in.

Status: draft, milestone M2. Plain README until the brand kit render (vm-brand) is set up for this repo.

## Journeys

| Spec | What it proves |
|---|---|
| `tests/auth/passkey.spec.ts` | An invited user sets up a passkey (virtual WebAuthn authenticator) and signs in with it. No MFA screen. The token carries org id and role. |
| `tests/auth/password-mfa.spec.ts` | An invited user with email and password must set up a second factor (TOTP) before the first token. |
| `tests/auth/redirect-uri.spec.ts` | Zitadel never redirects to an unregistered `redirect_uri` (the edge WAF relies on it). |

Users come by invite only (D-51). The invite mail is read from Mailpit (D-49).

## Run locally

```bash
# 1. The stack, with this repo's overlay (Zitadel API on 127.0.0.1:8090 for test setup)
cd ../synthwerk-infra && scripts/init-env.sh
docker compose -f compose.yaml -f ../synthwerk-e2e/stack/compose.e2e.yaml up --build --wait

# 2. The journeys
cd ../synthwerk-e2e
pnpm install
pnpm exec playwright install chromium
pnpm stack:secrets          # copies the local IAM owner PAT and studio client to .stack/
pnpm test
```

Settings (env): `E2E_EDGE_PORT` (8080), `E2E_ZITADEL_API_PORT` (8090), `E2E_MAILPIT_URL`
(`http://127.0.0.1:8025`), `E2E_AUTH_DOMAIN` (`auth.localhost`). `.stack/` holds local
secrets and is git-ignored. Never point the tests at dev or prd.

## CI

`.github/workflows/ci.yml`: Biome, `tsc`, the Playwright image guard, then the stack from
synthwerk-infra `main` and the journeys in `mcr.microsoft.com/playwright` (pinned by digest).
Runs on pull requests, on `main` and nightly. The ruleset requires `gate`.

## Layout

- `src/config` env and local secrets
- `src/zitadel` admin calls for test setup (invite)
- `src/flows` invite, OIDC code flow with PKCE, virtual passkey
- `src/support` HTTP, Mailpit, TOTP
- `stack/compose.e2e.yaml` overlay on the infra stack
- `tests/` specs (never next to source)

## License

MIT
