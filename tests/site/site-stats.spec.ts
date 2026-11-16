import { expect, test } from "@playwright/test";
import { env } from "../../src/config/env.ts";
import { call } from "../../src/support/http.ts";

// synthwerk#47: the public numbers of the site come from pulse GET /v1/public-stats through
// studio GET /api/site/stats. Public, cacheable, aggregates only: no ids, no personal data.
// Needs a pulse image with /v1/public-stats (synthwerk-pulse#8); an older pulse gives 503.

const FIELDS = ["answered_chats", "generated_at", "p95_ms", "uptime_ratio", "window_days"];

test("public numbers - five aggregate fields, public cache headers, no session", async () => {
  const res = await call(`${env.siteLoopback}/api/site/stats`, { host: new URL(env.siteURL).host });
  expect(res.status, res.body.slice(0, 300)).toBe(200);
  expect(String(res.headers["cache-control"])).toMatch(/^public, max-age=60\b/);
  expect(res.headers["set-cookie"]).toBeUndefined();

  const stats = res.json<Record<string, unknown>>();
  expect(Object.keys(stats).sort()).toEqual(FIELDS);
  expect(stats.window_days).toBe(30);
  expect(Number.isNaN(Date.parse(String(stats.generated_at)))).toBe(false);
  for (const key of ["uptime_ratio", "p95_ms", "answered_chats"]) {
    const v = stats[key];
    expect(v === null || typeof v === "number", `${key}: ${String(v)}`).toBe(true);
  }
  if (typeof stats.uptime_ratio === "number") {
    expect(stats.uptime_ratio).toBeGreaterThanOrEqual(0);
    expect(stats.uptime_ratio).toBeLessThanOrEqual(1);
  }
  if (typeof stats.answered_chats === "number") expect(Number.isInteger(stats.answered_chats)).toBe(true);
});

test("public numbers - the site shows them after the page view, from the site origin", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== new URL(env.siteURL).origin) foreign.push(r.url());
  });
  const stats = page.waitForResponse((r) => r.url() === `${env.siteURL}/api/site/stats`);
  await page.goto(`${env.siteURL}/en`);
  expect((await stats).status()).toBe(200);
  for (const stat of ["uptime", "p95", "chats"]) {
    await expect(page.locator(`[data-stat="${stat}"]`)).not.toBeEmpty();
  }
  expect(foreign).toEqual([]);
});
