---
title: Vision journeys
slug: vision-journeys
status: beta
epic: E3
owner: e2e
paths: ["tests/vision/**", "tests/fixtures/vision/**"]
updated: 2026-10-30
---
# Vision journeys
> **In 30 seconds**
> - A real Chromium uses the real `<synthwerk-vision>` on a customer page against the real vision service.
> - Proves synthwerk-e2e#9 (synthwerk#43 "Done looks like"): a photo from the vision eval set shows its primary label and alternatives.
> - A signed-out visitor sends no request to vision.
> - The camera path works with the Chromium fake camera, and the camera stops after the photo.
## What it does
- Same host page, app fixture and token hand-over as the [chat slice](chat-slice.md).
- Upload: the photo is `Cow on pasture, Ehrenbach.jpg` (CC0, Gerda Arendt) from synthwerk-vision `eval/manifest.yaml`, copied byte for byte. The test checks its SHA-256 against the manifest value first.
- The widget re-encodes the photo, sends it to `POST /vision/v1/classifications` with the widget token (not the Zitadel token), and shows the result.
- The expected result: best label `cow`, a topic path with the eval root topic `animal`, a score `NN% match`, at least one alternative, and the photo preview. Request order: token trade, then one classification.
- Signed out: the sign-in prompt, no file input, no camera button, no `/vision/` request and no token trade.
- Camera: Chromium's fake camera gives a test pattern. The journey clicks "Use camera" and "Take photo", and expects a 200 multipart classification, a label, and no live camera track afterwards.
## Rules and limits
| Rule | Value |
|---|---|
| Stack | Profile `vision` (`COMPOSE_PROFILES=vision`): the published SigLIP 2 image pinned in synthwerk-infra. |
| CORS | vision answers CORS per app origin: it asks identity (synthwerk-infra#26). The overlay sets nothing for vision. |
| Expected label | Set in `tests/fixtures/vision/photos.json`. A new model or label set can change it: update the file with the new label. |
| Camera project | `chromium-camera` runs only the camera journey with `channel: 'chromium'` (new headless). The default headless shell has no media capture (`NotSupportedError`). |
## Tests
- `tests/vision/vision-upload.spec.ts` — `signed-in user - an eval-set photo shows its primary label and alternatives`
- `tests/vision/vision-upload.spec.ts` — `signed-out visitor - sign-in prompt, no request to vision`
- `tests/vision/vision-camera.spec.ts` — `signed-in user - a photo from the camera gets labels, the camera stops`
- `tests/vision/vision-origin.spec.ts` — `signed-in user on an origin the app does not allow - not-allowed text, no vision call`
## Changes
| Date | Change |
|---|---|
| 2026-10-30 | First version (synthwerk-e2e#9). |
| 2026-10-30 | Origin journey: not-allowed text, no vision call (synthwerk-widgets#41). The overlay no longer sets the vision CORS list (synthwerk-infra#26). |
