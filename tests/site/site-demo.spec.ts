import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { env, siteOrgID } from "../../src/config/env.ts";
import { demoChat, demoCode, demoVisitor, llmLoad, useSession } from "../../src/site/demo.ts";
import { publishPage, studioSignIn, waitForBuilder } from "../../src/studio/builder.ts";
import { call } from "../../src/support/http.ts";

// synthwerk#47: the live demo on the public site. It sends nothing before a click; a signed-out
// visitor gets a sign-in link; a demo org member chats with llm (fake provider: "echo: <message>")
// and classifies a photo with vision. A flood over the strict limit is refused before llm: the
// model load stays flat. Needs studio with NUXT_SITE_DEMO_APP_ID (scripts/site-demo-app.ts) and
// the stack profiles vision and studio. The load test runs last: its 5 counted calls use the
// global limit (30 per minute) of the same studio process.

type Photo = { file: string; label: string };
const fixtures = join(import.meta.dirname, "..", "fixtures", "vision");
const photo = (JSON.parse(readFileSync(join(fixtures, "photos.json"), "utf8")) as { photos: Photo[] })
  .photos[0] as Photo;

const RATE_LIMITED = "demo_rate_limited";
// A call that passed the limits can still be refused: 2 model calls at once (demo_busy), or
// the llm user quota of the overlay (1500 tokens, about one open answer: demo_quota_exhausted).
const REFUSED = new Set([RATE_LIMITED, "demo_busy", "demo_quota_exhausted"]);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  const probe = await call(`${env.siteLoopback}/api/site/pages/en/home`, { host: new URL(env.siteURL).host });
  if (probe.status === 503) {
    throw new Error("studio answers 503 on /api/site: start it with SYNTHWERK_SITE_ORG_ID (README, Run locally)");
  }
  // The demo block is in the frame of every site page: /en must exist (a later run keeps it).
  const owner = await studioSignIn("owner", "demo-owner");
  expect(owner.org).toBe(siteOrgID());
  await publishPage(owner, await waitForBuilder(owner), {
    slug: "home",
    locale: "en",
    title: "Home",
    heading: "Synthwerk E2E",
  });
});

/** Every request of the page as "METHOD path" on the site origin, and the foreign URLs. */
function recordRequests(page: Page) {
  const site: string[] = [];
  const foreign: string[] = [];
  const origin = new URL(env.siteURL).origin;
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin === origin) site.push(`${r.method()} ${u.pathname}`);
    else foreign.push(r.url());
  });
  return { site, foreign, demo: () => site.filter((r) => r.includes("/api/site/demo") || r.includes("/api/auth/")) };
}

async function openDemo(page: Page) {
  await page.goto(`${env.siteURL}/en`);
  const block = page.locator('[data-site-slot="widget"]');
  await expect(block.getByRole("heading", { name: "Try the live demo" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  return block;
}

test("signed-out visitor - no demo call before the click, then a sign-in link", async ({ page }) => {
  const requests = recordRequests(page);
  const block = await openDemo(page);
  // The page view asks nothing about the visitor and calls no model.
  expect(requests.demo()).toEqual([]);

  await block.getByRole("button", { name: "Start the demo" }).click();
  const signIn = block.getByRole("link", { name: "Sign in" });
  await expect(signIn).toBeVisible();
  expect(await signIn.getAttribute("href")).toMatch(/^\/api\/auth\/login\?returnTo=(\/en|%2Fen)$/);
  await expect(block.getByLabel("Your message")).toHaveCount(0);
  expect(requests.demo()).toEqual(["GET /api/auth/session"]);
  expect(requests.foreign).toEqual([]);
});

test("demo member - a streamed chat answer and a photo label, all on the site origin", async ({ page, context }) => {
  test.setTimeout(150_000);
  const visitor = await demoVisitor("site-demo");
  await useSession(context, visitor.studio);
  const requests = recordRequests(page);
  const block = await openDemo(page);
  expect(requests.demo()).toEqual([]);
  await block.getByRole("button", { name: "Start the demo" }).click();

  // Chat: the BFF passes the llm stream through; the fake provider echoes the message.
  const marker = `demo-${Date.now().toString(36)}`;
  await block.getByLabel("Your message").fill(marker);
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/site/demo/chat"));
  await block.getByRole("button", { name: "Send" }).click();
  const chat = await answered;
  expect(chat.status()).toBe(200);
  expect(chat.headers()["content-type"]).toContain("text/event-stream");
  expect(chat.headers()["cache-control"]).toContain("no-store");
  expect(chat.headers()["x-demo-conversation-id"]).toMatch(/^[0-9a-f-]{36}$/);
  await expect(block.locator(".site-demo__turn--assistant")).toHaveText(`Synthwerk: echo: ${marker}`);
  await expect(block.getByRole("button", { name: "Send" })).toBeVisible();

  // Vision: the BFF trades a widget token for the demo app and calls vision with the real model.
  await block.getByLabel(/^Image/).setInputFiles({
    name: photo.file,
    mimeType: "image/jpeg",
    buffer: readFileSync(join(fixtures, photo.file)),
  });
  const classified = page.waitForResponse((r) => r.url().endsWith("/api/site/demo/vision"), { timeout: 90_000 });
  await block.getByRole("button", { name: "Recognize image" }).click();
  const vision = await classified;
  expect(vision.status(), await vision.text()).toBe(200);
  const result = (await vision.json()) as Record<string, unknown>;
  // Only the result reaches the page: no request id, model or timings.
  expect(Object.keys(result).sort()).toEqual(["labels", "primary", "uncertain"]);
  await expect(block.locator(".site-demo__result")).toContainText(photo.label, { timeout: 30_000 });

  expect(requests.demo()).toEqual(["GET /api/auth/session", "POST /api/site/demo/chat", "POST /api/site/demo/vision"]);
  expect(requests.foreign).toEqual([]);
});

test("load over the limit - refused before llm, the model load stays flat", async () => {
  test.setTimeout(120_000);
  const visitor = await demoVisitor("site-load");
  const token = visitor.zitadel.tokens.access_token;
  const before = await llmLoad(token);
  expect(before).toEqual({ conversations: 0, answers: 0 });

  // 40 sends at the same time by one user. The limit is 5 per minute per user.
  const N = 40;
  const replies = await Promise.all(Array.from({ length: N }, (_, i) => demoChat(visitor.studio, `load ${i}`)));
  const ok = replies.filter((r) => r.status === 200);
  const refused = replies.filter((r) => r.status !== 200);
  const codes = refused.map((r) => demoCode(r.body));

  expect(ok.length).toBeLessThanOrEqual(5);
  expect(ok.length).toBeGreaterThanOrEqual(1);
  for (const r of refused) {
    expect(r.status, r.body.slice(0, 200)).toBe(429);
    expect(REFUSED.has(demoCode(r.body) ?? ""), r.body.slice(0, 200)).toBe(true);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect(String(r.headers["cache-control"])).toContain("no-store");
  }
  expect(codes.filter((c) => c === RATE_LIMITED).length).toBeGreaterThanOrEqual(N - 5);

  // llm saw at most the calls that passed the limits: every answer stream has ended here.
  const after = await llmLoad(token);
  expect(after.conversations).toBeLessThanOrEqual(5);
  expect(after.answers).toBeLessThanOrEqual(ok.length);

  // The next call in the same minute is refused too, still before llm.
  const again = await demoChat(visitor.studio, "one more");
  expect(again.status).toBe(429);
  expect(demoCode(again.body)).toBe(RATE_LIMITED);
  expect(await llmLoad(token)).toEqual(after);
});
