---
title: Chat slice
slug: chat-slice
status: beta
epic: E3
owner: e2e
paths: ["tests/chat/**", "src/host/**", "src/identity/**"]
updated: 2026-10-30
---
# Chat slice
> **In 30 seconds**
> - A real Chromium uses the real `<synthwerk-chat>` on a customer page: the answer streams through the edge and the WAF, piece by piece.
> - Proves synthwerk#36 test 1 and synthwerk-e2e#8: a passkey user chats through the widget.
> - Proves synthwerk#36 test 2: a signed-out visitor sees the widget sign-in, and the page makes no `/llm/` request.
> - Proves synthwerk#33: a send over quota gets `429 quota_exhausted` and the widget shows the quota state.
> - Proves the origin binding: on an origin that no app allows, the widget gets no widget token and makes no llm call.
## What it does
- The host page (`src/host/serve.ts`) is a customer site at `https://shop.e2e.test:4174`. It serves the widget bundles of a synthwerk-widgets build with the documented snippet and a strict CSP (`connect-src` = the edge only).
- Chromium maps `*.e2e.test` to `127.0.0.1` (`--host-resolver-rules`). The page has a self-signed certificate made at start; the context ignores certificate errors.
- A worker fixture (`src/host/widget.ts`) makes one widget app per run: a fresh demo owner (password + TOTP, Session API) registers the host page origin with identity `POST /v1/orgs/{orgId}/apps`. An app with the same origins is reused.
- The host hands the user's Zitadel access token to the widget (`getUserToken`, `src/host/host.js`). The widget trades it for a widget token at identity and calls llm with the widget token.
- The page origin is not in the edge CORS list: identity and llm answer CORS per app origin (synthwerk-infra#25).
- Stream: invite, passkey enrolment, code flow (as in [sign-in-journeys.md](sign-in-journeys.md)). The widget answer must equal `echo: <message>`. A `MutationObserver` records the bubble text: at least two partial answers before the full one. The request order is settings, token trade, create, send.
- Anonymous: the only edge request is the public settings request (200). No token trade, no `/llm/` request. The gateway answers an anonymous call with `401 unauthenticated`.
- Quota: a stream of 100 words (about 10 s) from outside the browser holds the user quota (same user, Zitadel token). The widget send in the meantime gets `429 quota_exhausted` with `quota.scope = user`, `limit = 1500`, `resets_at` = next UTC midnight, `Retry-After`. The widget shows "You used all of your chat quota. It resets at …" and disables the input. The widget conversation stays empty; the open stream ends with `usage`, `done`.
- Origin: the same page on `https://other.e2e.test:4174`. identity answers the token trade preflight without an allow-origin, so the browser blocks the trade. The widget shows an error; no `/llm/` request. A direct trade from that origin gets `403 origin_not_allowed`.
## Rules and limits
| Rule | Value |
|---|---|
| Provider | `fake` for the chat journeys (overlay default); deterministic, no model in the loop. |
| Audience | The ci stage re-ups identity and llm with `SYNTHWERK_*_OIDC_AUDIENCE=<studio project id>`: Zitadel access tokens never carry `synthwerk-api`. |
| User quota | `SYNTHWERK_LLM_QUOTA_USER_TOKENS=1500` in the overlay. |
| Widgets | A build of synthwerk-widgets main: `E2E_WIDGETS_DIST` (default `../synthwerk-widgets/dist`). |
| Host origin | `https` and a domain: identity takes `http` only for `localhost`, and the WAF blocks a `localhost` URL in a request body (CRS 934110). |
| Membership | identity stores a new member from the Zitadel grant hook a moment after sign-in. `waitForMember` polls `GET /v1/orgs/{id}` until 200. |
| Known gap | The widget state "This site cannot use the chat." never shows in a browser: the CORS preflight fails before the widget can read `403 origin_not_allowed` (synthwerk-widgets#41). |
## Tests
- `tests/chat/chat-stream.spec.ts` — `passkey user - chats through the widget and the answer streams in pieces`
- `tests/chat/chat-anonymous.spec.ts` — `signed-out visitor - widget sign-in, no llm call, gateway refuses anonymous calls`
- `tests/chat/chat-quota.spec.ts` — `signed-in user over quota - the widget shows the quota state, the open stream finishes`
- `tests/chat/chat-origin.spec.ts` — `signed-in user on an origin the app does not allow - no widget token, no llm call`
## Changes
| Date | Change |
|---|---|
| 2026-10-28 | First version (synthwerk#36 tasks 4-6). |
| 2026-10-29 | Quota journey (synthwerk#33). |
| 2026-10-30 | The journeys use the real widget on a customer page; `/stub` is no longer used; origin journey (synthwerk-e2e#8). |
