import { env } from "../../src/config/env.ts";
import { edgeRequests, expect, openHost, test } from "../../src/host/widget.ts";
import { demoMember } from "../../src/identity/apps.ts";
import { call } from "../../src/support/http.ts";

// synthwerk-e2e#8, synthwerk-widgets#41: the widget token is bound to the origins of the
// app. The same snippet on a page whose origin no app allows gets no widget token. Identity
// answers the preflight of the token trade for every origin and refuses the trade with a
// 403 origin_not_allowed the page can read, so the widget shows its own not-allowed state
// (not a generic error) and nothing reaches llm.
test("signed-in user on an origin the app does not allow - not-allowed text, no widget token, no llm call", async ({
  page,
  app,
}) => {
  const user = await demoMember("member", "origin");
  expect(app.origins).not.toContain(env.foreignOrigin);
  const requests = edgeRequests(page);
  const trade = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith(`/identity/v1/apps/${app.id}/widget-tokens`),
  );

  await openHost(page, { widget: "chat", app, token: user.tokens.access_token, origin: env.foreignOrigin });
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByRole("textbox", { name: "Write a message" }).fill("Hi");
  await page.getByRole("button", { name: "Send" }).click();

  // The browser let the widget read the refusal: 403 origin_not_allowed, no token in it.
  const res = await trade;
  expect(res.status()).toBe(403);
  const body = (await res.json()) as { code: string; access_token?: string };
  expect(body.code).toBe("origin_not_allowed");
  expect(body.access_token).toBeUndefined();

  // The widget shows its not-allowed state, with no retry, and keeps the user on the page.
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("This site cannot use the chat.");
  await expect(alert.getByRole("button")).toHaveCount(0);
  await expect(page.locator("synthwerk-chat .sw-msg--assistant.sw-msg--done")).toHaveCount(0);

  // Nothing went to llm.
  expect(requests.filter((r) => r.includes(" /llm/"))).toEqual([]);

  // The CORS contract behind it, as the browser saw it: the preflight passes this origin,
  // the refusal carries no credentials header and is never cached.
  const tokens = `${env.edge}/identity/v1/apps/${app.id}/widget-tokens`;
  const preflight = await call(tokens, {
    method: "OPTIONS",
    headers: {
      Origin: env.foreignOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers["access-control-allow-origin"]).toBe(env.foreignOrigin);
  expect(preflight.headers["access-control-allow-credentials"]).toBeUndefined();
  expect(res.headers()["access-control-allow-origin"]).toBe(env.foreignOrigin);
  expect(res.headers()["access-control-allow-credentials"]).toBeUndefined();
  expect(res.headers()["cache-control"]).toBe("no-store");
  expect(res.headers().vary).toMatch(/Origin/);
});
