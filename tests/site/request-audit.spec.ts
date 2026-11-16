import { expect, type Page, test } from "@playwright/test";
import { env, siteOrgID } from "../../src/config/env.ts";
import {
  deletePage,
  type PageSummary,
  publishPage,
  type StudioSession,
  studioSignIn,
  waitForBuilder,
} from "../../src/studio/builder.ts";
import { call } from "../../src/support/http.ts";

// synthwerk#45: a page view of the public site without consent makes no third-party request,
// and analytics loads only after the opt-in. The site is studio's public routes on its own
// origin (env.siteURL). Test data goes in through the studio builder API, as an owner of the
// demo org: stack/compose.e2e.yaml makes the demo org the site org (NUXT_SITE_ORG_ID).
const LEGAL = ["/de/impressum", "/de/datenschutz", "/de/cookies", "/en/imprint", "/en/privacy", "/en/cookies"];
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = `e2e-audit-${run}`;

let owner: StudioSession;
let auditPage: PageSummary | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  // Fail with the cause, not with a 503 page in the middle of the audit.
  const probe = await call(`${env.siteLoopback}/api/site/pages/en/home`, { host: new URL(env.siteURL).host });
  if (probe.status === 503) {
    throw new Error("studio answers 503 on /api/site: start it with SYNTHWERK_SITE_ORG_ID (README, Run locally)");
  }
  owner = await studioSignIn("owner", "site-owner");
  expect(owner.org).toBe(siteOrgID());
  const pages = await waitForBuilder(owner);
  // The start pages /de and /en (slug home) of the site org. A later run keeps them.
  await publishPage(owner, pages, { slug: "home", locale: "de", title: "Start", heading: "Synthwerk E2E" });
  await publishPage(owner, pages, { slug: "home", locale: "en", title: "Home", heading: "Synthwerk E2E" });
  auditPage = await publishPage(owner, pages, { slug, locale: "en", title: "Audit", heading: `Audit ${run}` });
});

test.afterAll(async () => {
  if (owner && auditPage) await deletePage(owner, auditPage);
});

/** Every request of the page, in order. Third-party: not on the site origin. */
function recordRequests(page: Page) {
  const all: string[] = [];
  page.on("request", (r) => all.push(r.url()));
  const origin = new URL(env.siteURL).origin;
  return { all, foreign: () => all.filter((u) => new URL(u).origin !== origin) };
}

async function view(page: Page, path: string) {
  const res = await page.goto(env.siteURL + path);
  expect(res?.status(), path).toBe(200);
  // Hydrated: the consent banner is client side and shows only without a valid choice.
  await expect(page.getByRole("button", { name: /^(Allow analytics|Statistik erlauben)$/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test("page views without consent - every request goes to the site origin", async ({ page }) => {
  const requests = recordRequests(page);
  // The analytics host never answers here: a request to it fails the assertion below anyway.
  await page.route(`${new URL(env.siteAnalyticsURL).origin}/**`, (r) => r.abort());

  for (const path of ["/de", "/en", `/en/${slug}`, ...LEGAL]) await view(page, path);
  await expect(page.locator("[data-legal-placeholder]")).toBeVisible();

  // The audit saw real page loads: documents and the app bundle from the site origin.
  for (const path of ["/de", "/en", `/en/${slug}`, ...LEGAL]) expect(requests.all).toContain(env.siteURL + path);
  expect(requests.all.some((u) => u.startsWith(`${env.siteURL}/_nuxt/`))).toBe(true);
  expect(requests.foreign()).toEqual([]);
});

test("analytics - loads only after the opt-in, on a live page and a legal page", async ({ page }) => {
  const requests = recordRequests(page);
  await page.route(`${new URL(env.siteAnalyticsURL).origin}/**`, (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript", body: "" }),
  );

  await view(page, `/en/${slug}`);
  await expect(page.getByRole("heading", { name: `Audit ${run}` })).toBeVisible();
  expect(requests.foreign()).toEqual([]);

  const script = page.waitForRequest(env.siteAnalyticsURL);
  await page.getByRole("button", { name: "Allow analytics" }).click();
  await script;
  expect(requests.foreign()).toEqual([env.siteAnalyticsURL]);

  // With the consent cookie the next page view loads it too (a legal page: prerendered in
  // studio, the script waits for /api/site/config there). Nothing else leaves the origin.
  const again = page.waitForRequest(env.siteAnalyticsURL);
  await page.goto(`${env.siteURL}/en/privacy`);
  await again;
  await expect(page.getByRole("button", { name: "Allow analytics" })).toHaveCount(0);
  expect(new Set(requests.foreign())).toEqual(new Set([env.siteAnalyticsURL]));
});
