import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { edgeRequests, expect, openHost, pageErrors, test } from "../../src/host/widget.ts";
import { demoMember } from "../../src/identity/apps.ts";

// synthwerk-e2e#9 (synthwerk#43 "Done looks like"): a photo from the vision eval set shows
// its primary label and alternatives in the real <synthwerk-vision>, against the real
// stack: identity widget token (bound to the page origin), the edge and the WAF, and the
// vision service with its model. A signed-out visitor sends no request to vision.
// Needs the stack profile "vision".

type Photo = { file: string; title: string; sha256: string; topics: string[]; label: string };
const fixtures = join(import.meta.dirname, "..", "fixtures", "vision");
const photo = (JSON.parse(readFileSync(join(fixtures, "photos.json"), "utf8")) as { photos: Photo[] })
  .photos[0] as Photo;

test("signed-in user - an eval-set photo shows its primary label and alternatives", async ({ page, app }) => {
  test.setTimeout(120_000);
  // The fixture is the eval-set photo, byte for byte (sha256 of eval/manifest.yaml).
  const bytes = readFileSync(join(fixtures, photo.file));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(photo.sha256);

  const user = await demoMember("member", "vision");
  const requests = edgeRequests(page);
  const errors = pageErrors(page);
  await openHost(page, { widget: "vision", app, token: user.tokens.access_token });
  await expect(page.getByRole("button", { name: "Choose photo" })).toBeVisible();

  const classified = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/vision/v1/classifications"),
    { timeout: 90_000 },
  );
  await page.locator("synthwerk-vision input[type=file]").setInputFiles({
    name: photo.file,
    mimeType: "image/jpeg",
    buffer: bytes,
  });

  // 1. vision answered through the edge, with the widget token of this origin.
  const res = await classified;
  expect(res.status(), await res.text()).toBe(200);
  const auth = (await res.request().allHeaders()).authorization ?? "";
  expect(auth).toMatch(/^Bearer /);
  expect(auth).not.toBe(`Bearer ${user.tokens.access_token}`);

  // 2. The card shows the expected primary label, its topic and the alternatives.
  const result = page.locator("synthwerk-vision .sw-result");
  await expect(result.locator(".sw-result__best")).toHaveText(photo.label, { timeout: 30_000 });
  await expect(result.locator(".sw-result__topic")).toContainText(new RegExp(photo.topics.join("|"), "i"));
  await expect(result.locator(".sw-result__primary .sw-result__score")).toHaveText(/^\d+% match$/);
  const alternatives = result.getByRole("listitem");
  expect(await alternatives.count()).toBeGreaterThanOrEqual(1);
  await expect(alternatives.first()).not.toHaveText(photo.label);
  await expect(page.getByRole("img", { name: "Your photo" })).toBeVisible();

  // 3. In order: one token trade, then one classification (the widget saves no photo
  //    unless the host sets save-photos).
  expect(requests.filter((r) => !r.startsWith("OPTIONS "))).toEqual([
    `POST /identity/v1/apps/${app.id}/widget-tokens`,
    "POST /vision/v1/classifications",
  ]);
  expect(errors).toEqual([]);
});

test("signed-out visitor - sign-in prompt, no request to vision", async ({ page, app }) => {
  const requests = edgeRequests(page);
  await openHost(page, { widget: "vision", app });
  await expect(page.getByText("Sign in to label photos")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.locator("synthwerk-vision input[type=file]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Use camera" })).toHaveCount(0);
  expect(requests.filter((r) => r.includes(" /vision/"))).toEqual([]);
  expect(requests.filter((r) => r.includes("/widget-tokens"))).toEqual([]);
});
