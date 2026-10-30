import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../../src/config/env.ts";
import { edgeRequests, expect, openHost, test } from "../../src/host/widget.ts";
import { demoMember } from "../../src/identity/apps.ts";

// synthwerk-widgets#41: the vision widget on a page whose origin no app allows. Identity
// refuses the token trade with a readable 403 origin_not_allowed, so the card shows its
// not-allowed text and no photo reaches vision. Needs the stack profile "vision".
test("signed-in user on an origin the app does not allow - not-allowed text, no vision call", async ({ page, app }) => {
  const user = await demoMember("member", "vision-origin");
  expect(app.origins).not.toContain(env.foreignOrigin);
  const requests = edgeRequests(page);
  const trade = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(`/identity/v1/apps/${app.id}/widget-tokens`),
  );

  await openHost(page, { widget: "vision", app, token: user.tokens.access_token, origin: env.foreignOrigin });
  await expect(page.getByRole("button", { name: "Choose photo" })).toBeVisible();
  const photo = readFileSync(join(import.meta.dirname, "..", "fixtures", "vision", "cow-on-pasture-ehrenbach.jpg"));
  await page.locator("synthwerk-vision input[type=file]").setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });

  const res = await trade;
  expect(res.status()).toBe(403);
  expect(((await res.json()) as { code: string }).code).toBe("origin_not_allowed");

  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("This site cannot use image labels.");
  await expect(alert.getByRole("button")).toHaveCount(0);
  await expect(page.locator("synthwerk-vision .sw-result")).toHaveCount(0);
  expect(requests.filter((r) => r.includes(" /vision/"))).toEqual([]);
});
