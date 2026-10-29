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
| `tests/chat/chat-stream.spec.ts` | A passkey user chats: the answer streams through the edge and the WAF piece by piece until `done` (synthwerk#36). |
| `tests/chat/chat-quota.spec.ts` | A passkey user over quota gets 429 `quota_exhausted` with the typed `quota` body while the open stream still ends with `done` (synthwerk#33). |
| `tests/chat/chat-anonymous.spec.ts` | A signed-out visitor triggers no llm call, and the gateway refuses an anonymous call with 401 `unauthenticated` (synthwerk#36). |
Users come by invite only (D-51). The invite mail is read from Mailpit (D-49).
The chat journeys run against the fake provider: it echoes the message one word per
piece (100 ms each), so no model is in the loop.
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
# 3. The chat journeys: the llm gateway needs the studio project id as the token
#    audience (bridge until synthwerk#28/#30, see stack/compose.e2e.yaml)
SYNTHWERK_LLM_OIDC_AUDIENCE="$(jq -r .project_id .stack/studio-client.json)" \
  docker compose -f ../synthwerk-infra/compose.yaml -f stack/compose.e2e.yaml up -d --wait llm
pnpm test
```
Settings (env): `E2E_EDGE_PORT` (8080), `E2E_ZITADEL_API_PORT` (8090), `E2E_MAILPIT_URL`
(`http://127.0.0.1:8025`), `E2E_AUTH_DOMAIN` (`auth.localhost`). `.stack/` holds local
secrets and is git-ignored. Never point the tests at dev or prd.
## CI
`.github/workflows/ci.yml`: Biome, `tsc` and the Playwright image guard on pull
requests and `main`. The journeys (e2e stage) run by dispatch only (fleet rule
CI-E2E-01): Actions > ci > Run workflow with e2e: true. The ruleset requires `gate`.
## Layout
- `src/config` env and local secrets
- `src/zitadel` admin calls for test setup (invite)
- `src/flows` invite, OIDC code flow with PKCE, virtual passkey
- `src/support` HTTP, Mailpit, TOTP
- `stack/compose.e2e.yaml` overlay on the infra stack (Zitadel API port, llm for the chat journeys)
- `tests/` specs (never next to source)
## License
MIT
