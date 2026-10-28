import { expect, test } from "@playwright/test";
import { env } from "../../src/config/env.ts";
import { call } from "../../src/support/http.ts";

// synthwerk#36, test 2: a signed-out visitor triggers no AI call. Two layers: the
// page makes zero /llm/ calls, and the gateway refuses an anonymous call with 401
// before any database or model call (refusal order one in the llm contract). The
// /stub page stands in for the app page until the widget lands (synthwerk#34): with
// the widget, the same journey proves the launcher stays a sign-in prompt.
test("signed-out visitor - no llm call, gateway refuses anonymous calls", async ({ page }) => {
  const llmCalls: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/llm/")) llmCalls.push(r.url());
  });

  // The visitor loads the page. Nothing on it may reach the llm service.
  await page.goto(`${env.edge}/stub`);
  await expect(page.locator("body")).toContainText("synthwerk stub");
  expect(llmCalls).toEqual([]);

  // Control: the service answers through the edge, so the empty list above is a real
  // guard and not a routing failure.
  const health = await call(`${env.edge}/llm/healthz`);
  expect(health.status).toBe(200);

  // The negative: even an attempted anonymous chat call is refused before the model.
  const refused = await page.evaluate(async (base) => {
    const res = await fetch(`${base}/llm/v1/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text() };
  }, env.edge);
  expect(refused.status).toBe(401);
  expect(refused.type).toContain("application/problem+json");
  // The type URI is the stable code of the problem (RFC 9457), not prose wording.
  const problem = JSON.parse(refused.body) as { type: string };
  expect(problem.type).toMatch(/\/problems\/unauthenticated$/);
});
