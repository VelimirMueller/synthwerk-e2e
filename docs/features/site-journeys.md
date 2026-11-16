---
title: Public site journeys
slug: site-journeys
status: beta
epic: E6
owner: e2e
paths: ["tests/site/**", "src/site/**", "scripts/site-demo-app.ts"]
updated: 2026-11-16
---
# Public site journeys
> **In 30 seconds**
> - A real Chromium opens the public site: studio's public routes on `http://localhost:3001`.
> - Without consent, every request goes to the site origin (synthwerk#45).
> - The live demo sends nothing before a click. A demo member chats and classifies a photo (synthwerk#47).
> - A flood of 40 sends by one user gets 429 before llm. llm stores at most 5 answers.
> - The public numbers come from pulse. They are public, cacheable and hold only aggregates.
## What it does
- Request audit: `/de`, `/en`, a published page and the six legal pages, without consent. Analytics loads only after the opt-in.
- Demo, signed out: the page view makes no `/api/auth/` or `/api/site/demo` call. The click asks `GET /api/auth/session` and shows a sign-in link.
- Demo, signed in: a fresh demo member gets a studio session (cookie in the browser). The chat answer is `echo: <message>` from the fake provider. The photo is the vision eval-set photo; the result shows its label.
- Load: one fresh member sends 40 chats at the same time from Node. At most 5 get 200. Each other call gets 429 with `Retry-After` and `no-store`. At least 35 get `demo_rate_limited`.
- Load: the llm export of the same user (`GET /llm/v1/me/export`, Zitadel token) has at most 5 conversations. It has no more answers than 200 replies.
- Numbers: `GET /api/site/stats` has exactly the five fields, `window_days` 30, and `Cache-Control: public, max-age=60`. The page shows the three numbers.
## Rules and limits
| Rule | Value |
|---|---|
| Stack | Profiles `vision` and `studio`. studio needs `SYNTHWERK_SITE_ORG_ID` and `SYNTHWERK_SITE_DEMO_APP_ID`. |
| Demo app | `scripts/site-demo-app.ts` makes an app in the demo org with the site origin. It writes `.stack/site-demo-app-id`. |
| Identity API port | The WAF blocks a localhost URL in a body (CRS 934110). So the script calls identity on `127.0.0.1:8091` (`E2E_IDENTITY_API_PORT`). |
| Order | The load test runs last in its file. Its 5 counted calls use the global limit (30 per minute) of studio. |
| Other refusals | Of the calls that pass the limits, studio allows 2 model calls at once (`demo_busy`). The llm user quota of the overlay fits about one open answer (`demo_quota_exhausted`). |
| Numbers | Need a pulse image with `/v1/public-stats` (synthwerk-pulse#8). An older pulse gives 503 `stats_unavailable`. |
## Tests
- `tests/site/request-audit.spec.ts` — `page views without consent - every request goes to the site origin`
- `tests/site/request-audit.spec.ts` — `analytics - loads only after the opt-in, on a live page and a legal page`
- `tests/site/site-demo.spec.ts` — `signed-out visitor - no demo call before the click, then a sign-in link`
- `tests/site/site-demo.spec.ts` — `demo member - a streamed chat answer and a photo label, all on the site origin`
- `tests/site/site-demo.spec.ts` — `load over the limit - refused before llm, the model load stays flat`
- `tests/site/site-stats.spec.ts` — `public numbers - five aggregate fields, public cache headers, no session`
- `tests/site/site-stats.spec.ts` — `public numbers - the site shows them after the page view, from the site origin`
## Changes
| Date | Change |
|---|---|
| 2026-11-16 | First version: request audit (synthwerk#45), live demo, load test and public numbers (synthwerk#47). |
