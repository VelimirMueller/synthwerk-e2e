import { createHash, randomBytes } from "node:crypto";
import { env, loginPAT, studioClient } from "../config/env.ts";
import { call } from "../support/http.ts";
import { totp } from "../support/totp.ts";
import { admin, userWithPassword } from "../zitadel/admin.ts";
import { exchange, studioScope, type Tokens } from "./oidc.ts";

export type SignedIn = { userID: string; userName: string; tokens: Tokens };

/** A user with a password and a verified TOTP factor (made directly, no invite). */
export type TOTPUser = { userID: string; userName: string; password: string; secret: string };

export async function totpUser(opts: { org: string; roles: string[]; tag: string }): Promise<TOTPUser> {
  const password = `Sw-e2e-${randomBytes(4).toString("hex")}-Pw!`;
  const user = await userWithPassword({ ...opts, projectID: studioClient().project_id, password });
  const reg = await admin<{ secret: string }>("POST", `/v2/users/${user.userID}/totp`, {});
  await admin("POST", `/v2/users/${user.userID}/totp/verify`, { code: totp(reg.secret) });
  return { ...user, password, secret: reg.secret };
}

/**
 * Finishes a Zitadel auth request with a Session API session (password, then TOTP), as
 * login v2 does. Returns the callback URL with the code. The token then passes the MFA gate.
 */
export async function finishAuthRequest(authRequest: string, user: TOTPUser): Promise<string> {
  const session = await sessionAPI<{ sessionId: string }>("POST", "/v2/sessions", {
    checks: { user: { loginName: user.userName }, password: { password: user.password } },
  });
  // Zitadel takes one 30 s step of skew: the next step's code differs from the enrolment code.
  const checked = await sessionAPI<{ sessionToken: string }>("PATCH", `/v2/sessions/${session.sessionId}`, {
    checks: { totp: { code: totp(user.secret, Date.now() + 30_000) } },
  });
  const done = await sessionAPI<{ callbackUrl: string }>("POST", `/v2/oidc/auth_requests/${authRequest}`, {
    session: { sessionId: session.sessionId, sessionToken: checked.sessionToken },
  });
  return done.callbackUrl;
}

/** The authRequest id from the redirect of /oauth/v2/authorize to the login UI. */
export function authRequestOf(location: string | undefined, status: number): string {
  const id = new URL(location ?? "", env.authURL).searchParams.get("authRequest");
  if (!id) throw new Error(`authorize: ${status}, no authRequest`);
  return id;
}

/**
 * A user with password and TOTP, signed in without a browser: authorize through the edge,
 * then a Session API session finishes the auth request (same steps as
 * tests/auth/mfa-gate.spec.ts). For journeys that need a signed-in user but do not test the
 * sign-in itself.
 */
export async function signInWithTOTP(opts: { org: string; roles: string[]; tag: string }): Promise<SignedIn> {
  const sc = studioClient();
  const user = await totpUser(opts);
  const verifier = randomBytes(48).toString("base64url");
  const q = new URLSearchParams({
    client_id: sc.client_id,
    redirect_uri: env.redirectURI,
    response_type: "code",
    scope: studioScope(sc.project_id),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: randomBytes(8).toString("hex"),
  });
  const auth = await call(`${env.edge}/oauth/v2/authorize?${q}`, { host: env.authHost });
  const callbackUrl = await finishAuthRequest(authRequestOf(auth.location, auth.status), user);
  const code = new URL(callbackUrl).searchParams.get("code");
  if (!code) throw new Error("no code on the callback URL");
  return { userID: user.userID, userName: user.userName, tokens: await exchange(code, verifier) };
}

/** Session API call as the login client (IAM_LOGIN_CLIENT). */
async function sessionAPI<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await call(env.zitadelAPI + path, {
    method,
    host: env.authHost,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginPAT()}` },
    body: JSON.stringify(body),
  });
  if (res.status >= 300) throw new Error(`zitadel ${method} ${path}: ${res.status} ${res.body.slice(0, 300)}`);
  return res.json<T>();
}
