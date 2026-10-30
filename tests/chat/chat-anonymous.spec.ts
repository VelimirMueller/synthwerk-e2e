import { env } from "../../src/config/env.ts";
import { edgeRequests, expect, openHost, pageErrors, test } from "../../src/host/widget.ts";
import { call } from "../../src/support/http.ts";

// synthwerk#36 test 2 and synthwerk-e2e#8: a signed-out visitor triggers no AI call. The
// real <synthwerk-chat> on the customer page shows its sign-in view and sends only the
// public settings request, and the gateway refuses an anonymous call with 401 before any
// database or model call (refusal order one in the llm contract).
test("signed-out visitor - widget sign-in, no llm call, gateway refuses anonymous calls", async ({ page, app }) => {
  const requests = edgeRequests(page);
  const errors = pageErrors(page);
  const settings = page.waitForResponse((r) => r.url().endsWith(`/identity/v1/apps/${app.id}/widget-settings`));

  await openHost(page, { widget: "chat", app });
  // The page reaches the stack: identity answers the settings for this app and origin, so
  // the empty llm list below is a real guard and not a routing failure.
  expect((await settings).status()).toBe(200);
  await page.getByRole("button", { name: "Open chat" }).click();
  await expect(page.getByText("Sign in to chat")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);

  // Nothing on the page reached llm, and no token was asked for.
  expect(requests).toEqual([`GET /identity/v1/apps/${app.id}/widget-settings`]);
  expect(requests.filter((r) => r.includes(" /llm/"))).toEqual([]);
  expect(errors).toEqual([]);

  // The negative: an attempted anonymous chat call is refused before the model.
  expect((await call(`${env.edge}/llm/healthz`)).status).toBe(200);
  const refused = await call(`${env.edge}/llm/v1/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: env.hostOrigin },
    body: "{}",
  });
  expect(refused.status).toBe(401);
  // The code member is the stable refusal code of the problem (RFC 9457 + kit).
  expect(refused.json<{ code: string }>().code).toBe("unauthenticated");
});
