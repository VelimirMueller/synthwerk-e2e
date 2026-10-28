import { expect, test } from "@playwright/test";
import { env, studioClient } from "../../src/config/env.ts";

// The edge WAF skips its SSRF rule for redirect_uri on the Zitadel OIDC endpoints
// (synthwerk-infra waf rule 900225). That is safe only while Zitadel redirects to
// registered URIs alone. This test holds Zitadel to it.
test("authorize - unregistered redirect_uri - no redirect", async ({ page }) => {
  let left = false;
  await page.route("http://169.254.169.254/**", (route) => {
    left = true;
    return route.abort();
  });
  const q = new URLSearchParams({
    client_id: studioClient().client_id,
    redirect_uri: "http://169.254.169.254/latest/meta-data",
    response_type: "code",
    scope: "openid",
  });
  const res = await page.goto(`${env.authURL}/oauth/v2/authorize?${q}`);
  expect(res?.status()).toBeGreaterThanOrEqual(400);
  expect(new URL(page.url()).host).toBe(env.authHost);
  expect(left).toBe(false);
});
