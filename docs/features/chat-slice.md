---
title: Chat slice
slug: chat-slice
status: beta
epic: E3
owner: e2e
paths: ["tests/chat/**"]
updated: 2026-10-28
---
# Chat slice
&gt; **In 30 seconds**
&gt; - A real Chromium signs in with a passkey and chats: the answer streams through the edge and the WAF, piece by piece.
&gt; - Proves synthwerk#36, test 1: a passkey user gets a streamed answer.
&gt; - Proves synthwerk#36, test 2: a signed-out visitor triggers no AI call, and the gateway refuses an anonymous call with 401.
## What it does
- Invites a fresh user (D-51), enrols a passkey and signs in (the journeys from [sign-in-journeys.md](sign-in-journeys.md)).
- Chat runs from the page at the edge origin (`/stub` stands in for the app page until the widget, synthwerk#34): the browser opens a conversation and reads the SSE answer with arrival times, so the test can tell a stream from one blob.
- The fake provider echoes the message one word per piece (100 ms each, pinned in the overlay), so the journey asserts the exact answer and that it arrived in more than one piece.
- The anonymous journey counts every `/llm/` request the page makes (zero), proves the route is alive (`/llm/healthz` is 200), and checks that an attempted anonymous call gets `401` as `application/problem+json` with the stable type URI `/problems/unauthenticated` (RFC 9457).
## Rules and limits
| Rule | Value |
|---|---|
| Provider | `fake` for the chat journeys (overlay default); deterministic, no model in the loop. |
| Audience | The ci stage re-ups llm with `SYNTHWERK_LLM_OIDC_AUDIENCE=&lt;studio project id&gt;` (bridge until synthwerk#28/#30). |
| Page stand-in | `/stub` on the edge origin. With the widget (#34), the same journeys run against the real embed. |
| No-AI-call proof | Browser request count plus the gateway 401. Service-side proof arrives with the studio BFF (#95). |
## Tests
- `tests/chat/chat-stream.spec.ts` — `passkey user - chats and the answer streams through the edge`
- `tests/chat/chat-anonymous.spec.ts` — `signed-out visitor - no llm call, gateway refuses anonymous calls`
## Changes
| Date | Change |
|---|---|
| 2026-10-28 | First version (synthwerk#36 tasks 4-6). |
