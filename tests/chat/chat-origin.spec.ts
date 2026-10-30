import { env } from "../../src/config/env.ts";
import { edgeRequests, expect, openHost, test } from "../../src/host/widget.ts";
import { demoMember } from "../../src/identity/apps.ts";
import { call } from "../../src/support/http.ts";

// synthwerk-e2e#8: the widget token is bound to the origins of the app. The same snippet
// on a page whose origin no app allows gets no widget token: identity refuses the CORS
// preflight of the token trade (no allow-origin), so the browser never sends the trade,
// the widget shows an error and nothing reaches llm.
//
// Known gap: the widget has a "This site cannot use the chat." state for 403
// origin_not_allowed, but a browser never lets it read that answer (the preflight fails
// first), so it shows the generic error. See synthwerk-widgets#41.
test("signed-in user on an origin the app does not allow - no widget token, no llm call", async ({ page, app }) => {
  const user = await demoMember("member", "origin");
  expect(app.origins).not.toContain(env.foreignOrigin);
  const requests = edgeRequests(page);
  const failed: string[] = [];
  page.on("requestfailed", (r) => failed.push(`${r.method()} ${new URL(r.url()).pathname}`));

  await openHost(page, { widget: "chat", app, token: user.tokens.access_token, origin: env.foreignOrigin });
  await page.getByRole("button", { name: "Open chat" }).click();
  await page.getByRole("textbox", { name: "Write a message" }).fill("Hi");
  await page.getByRole("button", { name: "Send" }).click();

  // The widget shows an error state and keeps the user on the page.
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("synthwerk-chat .sw-msg--assistant.sw-msg--done")).toHaveCount(0);

  // The browser blocked the token trade, and nothing went to llm.
  expect(failed).toContain(`POST /identity/v1/apps/${app.id}/widget-tokens`);
  expect(requests.filter((r) => r.includes(" /llm/"))).toEqual([]);

  // Why: identity answers the preflight from this origin without an allow-origin, and the
  // trade itself (as a non-browser client could send it) with 403 origin_not_allowed.
  const tokens = `${env.edge}/identity/v1/apps/${app.id}/widget-tokens`;
  const preflight = await call(tokens, {
    method: "OPTIONS",
    headers: {
      Origin: env.foreignOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
  expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
  const trade = await call(tokens, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${user.tokens.access_token}`,
      Origin: env.foreignOrigin,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect(trade.status).toBe(403);
  expect(trade.json<{ code: string }>().code).toBe("origin_not_allowed");
});
