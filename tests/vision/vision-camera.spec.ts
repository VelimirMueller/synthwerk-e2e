import { env } from "../../src/config/env.ts";
import { expect, openHost, test } from "../../src/host/widget.ts";
import { demoMember } from "../../src/identity/apps.ts";

// synthwerk-e2e#9: the camera path of <synthwerk-vision> against the real stack. Chromium's
// fake camera (--use-fake-device-for-media-stream, new headless via channel "chromium",
// playwright.config.ts) gives a test pattern; the widget takes a frame, stops the camera
// and sends the frame to vision. The pattern is no eval photo, so the journey checks that
// a label comes back, not which one. Needs the stack profile "vision".
test("signed-in user - a photo from the camera gets labels, the camera stops", async ({ page, context, app }) => {
  test.setTimeout(120_000);
  const user = await demoMember("member", "camera");
  await context.grantPermissions(["camera"], { origin: env.hostOrigin });
  // Keep the camera streams, to prove the tracks stop after the photo.
  await page.addInitScript(() => {
    const w = window as unknown as { cameraStreams: MediaStream[] };
    w.cameraStreams = [];
    const media = navigator.mediaDevices;
    const original = media.getUserMedia.bind(media);
    media.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      w.cameraStreams.push(stream);
      return stream;
    };
  });
  const live = () =>
    page.evaluate(
      () =>
        (window as unknown as { cameraStreams: MediaStream[] }).cameraStreams
          .flatMap((s) => s.getTracks())
          .filter((t) => t.readyState === "live").length,
    );

  await openHost(page, { widget: "vision", app, token: user.tokens.access_token });
  await page.getByRole("button", { name: "Use camera" }).click();
  await expect(page.locator("synthwerk-vision video")).toBeVisible();
  expect(await live()).toBe(1);

  const classified = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/vision/v1/classifications"),
    { timeout: 90_000 },
  );
  await page.getByRole("button", { name: "Take photo" }).click();
  const res = await classified;
  expect(res.status(), await res.text()).toBe(200);
  expect(res.request().headers()["content-type"]).toContain("multipart/form-data");
  await expect(page.locator("synthwerk-vision .sw-result__best")).toHaveText(/\S/, { timeout: 30_000 });
  expect(await live()).toBe(0);
});
