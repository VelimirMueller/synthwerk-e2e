import { test as base, type Page } from "@playwright/test";
import { env } from "../config/env.ts";
import { createWidgetApp, type WidgetApp } from "../identity/apps.ts";

/**
 * Journeys with the real widgets: the worker makes one app with the host page origin on
 * its allow-list (lazily, only for tests that ask for `app`).
 */
export const test = base.extend<object, { app: WidgetApp }>({
  app: [
    async ({}, use) => {
      await use(await createWidgetApp([env.hostOrigin]));
    },
    { scope: "worker", timeout: 60_000 },
  ],
});
export { expect } from "@playwright/test";

/**
 * Opens the host page with one widget. A token makes the page "signed in": the host hands
 * it to the widget with getUserToken (src/host/host.js). origin defaults to the app origin.
 */
export async function openHost(
  page: Page,
  opts: { widget: "chat" | "vision"; app: WidgetApp; token?: string; origin?: string; lang?: string },
): Promise<void> {
  if (opts.token) {
    await page.addInitScript((t) => {
      (window as unknown as { __e2eUserToken: string }).__e2eUserToken = t;
    }, opts.token);
  }
  const q = new URLSearchParams({ app: opts.app.id, api: env.edge, ...(opts.lang ? { lang: opts.lang } : {}) });
  await page.goto(`${opts.origin ?? env.hostOrigin}/${opts.widget}.html?${q}`);
}

/** Every request the page sends to the edge, as "METHOD /path", in order. */
export function edgeRequests(page: Page): string[] {
  const seen: string[] = [];
  const edge = new URL(env.edge).origin;
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin === edge) seen.push(`${r.method()} ${u.pathname}`);
  });
  return seen;
}

/** Uncaught page errors (not console noise such as a refused CORS fetch). */
export function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}
