import { env } from "../config/env.ts";
import { type SignedIn, signInWithTOTP } from "../flows/session.ts";
import { call } from "../support/http.ts";
import { orgID } from "../zitadel/admin.ts";

export type WidgetApp = { id: string; org: string; origins: string[] };

/** One call to identity through the edge with a user access token. */
export async function identity<T>(token: string, method: string, path: string, body?: unknown) {
  const res = await call(`${env.edge}/identity${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.body, json: () => res.json<T>() };
}

/**
 * Waits until identity has stored the caller as an active member of its org, and returns
 * the identity org id. identity learns a new Zitadel grant from the grant hook, a moment
 * after the token exists; until then the org and the widget token trade answer 404.
 */
export async function waitForMember(token: string): Promise<string> {
  const me = await identity<{ org?: { id: string } }>(token, "GET", "/v1/me");
  const org = me.status === 200 ? (me.json().org?.id ?? "") : "";
  if (!org) throw new Error(`identity GET /v1/me: ${me.status} ${me.body.slice(0, 300)}`);
  let got = { status: 0, body: "" };
  for (let i = 0; i < 30; i++) {
    got = await identity(token, "GET", `/v1/orgs/${org}`);
    if (got.status === 200) return org;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`identity has no active membership after 30 s: GET /v1/orgs/${org} ${got.status} ${got.body}`);
}

/** A fresh demo user (password + TOTP, Session API) that identity knows as a member. */
export async function demoMember(role: string, tag: string): Promise<SignedIn> {
  const user = await signInWithTOTP({ org: await orgID("demo"), roles: [role], tag });
  await waitForMember(user.tokens.access_token);
  return user;
}

/**
 * The app a customer registers for the widgets (identity createApp): a fresh demo owner
 * registers the host page origins. An app with the same origins from an earlier run on
 * the same stack is reused (the free plan allows 3 apps per org).
 */
export async function createWidgetApp(origins: string[]): Promise<WidgetApp> {
  const owner = await demoMember("owner", "app-owner");
  const token = owner.tokens.access_token;
  const org = await waitForMember(token);

  type App = { id: string; allowed_origins: string[] };
  const list = await identity<{ items: App[] }>(token, "GET", `/v1/orgs/${org}/apps?limit=100`);
  if (list.status !== 200) throw new Error(`identity listApps: ${list.status} ${list.body.slice(0, 300)}`);
  const same = (a: App) => [...a.allowed_origins].sort().join(" ") === [...origins].sort().join(" ");
  const found = list.json().items.find(same);
  if (found) return { id: found.id, org, origins };

  const made = await identity<{ id: string }>(token, "POST", `/v1/orgs/${org}/apps`, {
    name: `E2E host ${Date.now().toString(36)}`,
    allowed_origins: origins,
  });
  if (made.status !== 201) throw new Error(`identity createApp: ${made.status} ${made.body.slice(0, 300)}`);
  return { id: made.json().id, org, origins };
}
