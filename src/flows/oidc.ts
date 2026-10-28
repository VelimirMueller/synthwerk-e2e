import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { env, studioClient } from "../config/env.ts";
import { call } from "../support/http.ts";

/** Scope that gives org id and roles (synthwerk-infra bootstrap.StudioScope). */
export function studioScope(projectID: string): string {
  return [
    "openid",
    "profile",
    `urn:zitadel:iam:org:project:id:${projectID}:aud`,
    "urn:zitadel:iam:org:projects:roles",
    "urn:zitadel:iam:user:resourceowner",
  ].join(" ");
}

export type CodeFlow = {
  /** Resolves with the authorization code once Zitadel redirects to the studio callback. */
  code: Promise<string>;
  /** True after the redirect happened: no token can exist before it. */
  redirected: () => boolean;
  verifier: string;
};

/**
 * Starts the studio authorization code flow with PKCE in page. Nothing listens on the
 * studio callback (no studio app yet): the route answers it and hands over the code.
 */
export async function startCodeFlow(page: Page): Promise<CodeFlow> {
  const sc = studioClient();
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  let done = false;
  let resolve: (c: string) => void = () => {};
  let reject: (e: Error) => void = () => {};
  const code = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  await page.route(`${env.redirectURI}**`, (route) => {
    const u = new URL(route.request().url());
    done = true;
    if (u.searchParams.get("state") !== state) reject(new Error("state mismatch on the callback"));
    else resolve(u.searchParams.get("code") ?? "");
    return route.fulfill({ status: 200, contentType: "text/plain", body: "callback" });
  });
  const q = new URLSearchParams({
    client_id: sc.client_id,
    redirect_uri: env.redirectURI,
    response_type: "code",
    scope: studioScope(sc.project_id),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
  });
  await page.goto(`${env.authURL}/oauth/v2/authorize?${q}`);
  return { code, redirected: () => done, verifier };
}

export type Tokens = { access_token: string; id_token: string; expires_in: number };

/** Exchanges the code at the token endpoint (through the edge, like the studio BFF). */
export async function exchange(code: string, verifier: string): Promise<Tokens> {
  const sc = studioClient();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: env.redirectURI,
    code_verifier: verifier,
  }).toString();
  const res = await call(`${env.edge}/oauth/v2/token`, {
    method: "POST",
    host: env.authHost,
    headers: {
      Authorization: `Basic ${Buffer.from(`${sc.client_id}:${sc.client_secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (res.status !== 200) throw new Error(`token endpoint: ${res.status} ${res.body.slice(0, 200)}`);
  return res.json<Tokens>();
}

/** Payload of a JWT (no signature check: the services verify with kit/auth). */
export function claims(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new Error("not a JWT");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Role keys of the roles claim that are granted in org (same rule as kit/auth ZitadelMapper). */
export function rolesIn(c: Record<string, unknown>, org: string): string[] {
  const grants = (c["urn:zitadel:iam:org:project:roles"] ?? {}) as Record<string, Record<string, string>>;
  return Object.keys(grants)
    .filter((r) => org in (grants[r] ?? {}))
    .sort();
}
