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
| `tests/auth/mfa-gate.spec.ts` | A password-only sign-in through the Session API gets no token; with TOTP the access token carries `amr` with `mfa` (synthwerk#94, needs the infra MFA gate on). |
| `tests/auth/redirect-uri.spec.ts` | Zitadel never redirects to an unregistered `redirect_uri` (the edge WAF relies on it). |
| `tests/chat/chat-stream.spec.ts` | A passkey user chats through the real `<synthwerk-chat>` on a customer page: the answer streams in pieces (synthwerk#36, e2e#8). |
| `tests/chat/chat-quota.spec.ts` | A user over quota gets 429 `quota_exhausted` with the typed `quota` body; the widget shows the quota state; the open stream still ends with `done` (synthwerk#33). |
| `tests/chat/chat-anonymous.spec.ts` | A signed-out visitor sees the widget sign-in and makes no llm call; the gateway refuses an anonymous call with 401 `unauthenticated` (synthwerk#36). |
| `tests/chat/chat-origin.spec.ts` | On an origin that no app allows, the widget gets no widget token and makes no llm call (e2e#8). |
| `tests/vision/vision-upload.spec.ts` | A photo from the vision eval set shows its primary label and alternatives in the real `<synthwerk-vision>`; signed out, no vision request (e2e#9). |
| `tests/vision/vision-camera.spec.ts` | A photo from the Chromium fake camera gets labels, and the camera stops (e2e#9). |
Users come by invite only (D-51). The invite mail is read from Mailpit (D-49).
The chat journeys run against the fake provider: it echoes the message one word per
piece (100 ms each), so no model is in the loop. The vision journeys use the real model
(stack profile `vision`). The widgets run on a test host page (`src/host/serve.ts`,
`https://shop.e2e.test:4174`) built from a synthwerk-widgets checkout.
## Run locally
```bash
# 1. The stack, with this repo's overlay (Zitadel API on 127.0.0.1:8090 for test setup)
cd ../synthwerk-infra && scripts/init-env.sh
COMPOSE_PROFILES=vision docker compose -f compose.yaml -f ../synthwerk-e2e/stack/compose.e2e.yaml up --build --wait
# 2. The widgets under test
cd ../synthwerk-widgets && pnpm install && pnpm build
# 3. The journeys
cd ../synthwerk-e2e
pnpm install
pnpm exec playwright install chromium
pnpm stack:secrets          # copies the local IAM owner PAT, login-client PAT and studio client to .stack/
# 4. identity and llm need the studio project id as the token audience (stack/compose.e2e.yaml)
aud="$(jq -r .project_id .stack/studio-client.json)"
SYNTHWERK_IDENTITY_OIDC_AUDIENCE="$aud" SYNTHWERK_LLM_OIDC_AUDIENCE="$aud" COMPOSE_PROFILES=vision \
  docker compose -f ../synthwerk-infra/compose.yaml -f stack/compose.e2e.yaml up -d --wait identity llm
pnpm test
```
Settings (env): `E2E_EDGE_PORT` (8080), `E2E_ZITADEL_API_PORT` (8090), `E2E_MAILPIT_URL`
(`http://127.0.0.1:8025`), `E2E_AUTH_DOMAIN` (`auth.localhost`), `E2E_HOST_PORT` (4174),
`E2E_WIDGETS_DIST` (`../synthwerk-widgets/dist`). Keep the edge on 8080: with another
edge port the issuer `http://auth.localhost:<port>` is not reachable from the services. `.stack/` holds local
secrets and is git-ignored. Never point the tests at dev or prd.
## CI
`.github/workflows/ci.yml`: Biome, `tsc` and the Playwright image guard on pull
requests and `main`. The journeys (e2e stage) run by dispatch only (fleet rule
CI-E2E-01): Actions > ci > Run workflow with e2e: true. The ruleset requires `gate`.
## Layout
- `src/config` env and local secrets
- `src/zitadel` admin calls for test setup (invite)
- `src/flows` invite, OIDC code flow with PKCE, virtual passkey, Session API sign-in with TOTP
- `src/host` test host page for the widgets, widget fixtures
- `src/identity` identity calls: membership wait, widget app
- `src/support` HTTP, Mailpit, TOTP
- `stack/compose.e2e.yaml` overlay on the infra stack (Zitadel API port, llm for the chat journeys, vision CORS)
- `tests/` specs (never next to source); `tests/fixtures/vision` the eval-set photo
## License
MIT
