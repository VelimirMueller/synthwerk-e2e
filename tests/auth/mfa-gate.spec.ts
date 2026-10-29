import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { env, loginPAT, studioClient } from "../../src/config/env.ts";
import { claims, exchange, rolesIn, studioScope } from "../../src/flows/oidc.ts";
import { call } from "../../src/support/http.ts";
import { totp } from "../../src/support/totp.ts";
import { admin, mfaGateOn, orgID, userWithPassword } from "../../src/zitadel/admin.ts";

// synthwerk#94: the server refuses a token for a sign-in without a second factor, also
// when a client skips the login UI and calls the Session API directly. No browser:
// this is the path of a caller that holds the login-client PAT, as login v2 does.
test("session API - password only - no token; plus TOTP - token with amr mfa", async () => {
  test.skip(!(await mfaGateOn()), "MFA gate off (synthwerk-infra SYNTHWERK_ZITADEL_MFA_GATE)");
  const demo = await orgID("demo");
  const sc = studioClient();
  const password = `Sw-e2e-${randomBytes(4).toString("hex")}-Pw!`;
  const user = await userWithPassword({
    org: demo,
    projectID: sc.project_id,
    roles: ["member"],
    tag: "gate",
    password,
  });

  // 1. Authorize (PKCE) through the edge, like a browser. Zitadel redirects to login v2.
  const verifier = randomBytes(48).toString("base64url");
  const q = new URLSearchParams({
    client_id: sc.client_id,
    redirect_uri: env.redirectURI,
    response_type: "code",
    scope: studioScope(sc.project_id),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "gate",
  });
  const auth = await call(`${env.edge}/oauth/v2/authorize?${q}`, { host: env.authHost });
  expect(auth.status).toBe(302);
  const authRequest = new URL(auth.location ?? "", env.authURL).searchParams.get("authRequest") ?? "";
  expect(authRequest).not.toBe("");

  // 2. A session with the password only. Finishing the auth request with it fails.
  const session = await login<{ sessionId: string; sessionToken: string }>("POST", "/v2/sessions", {
    checks: { user: { loginName: user.userName }, password: { password } },
  });
  const refused = await finish(authRequest, session.sessionId, session.sessionToken);
  expect(refused.status).toBe(403);
  expect(refused.body).toContain("mfa_required");

  // 3. Same auth request, same session plus a TOTP check: now a code comes. Zitadel
  //    accepts one 30 s step of skew, so the next step's code differs from the enrolment code.
  const reg = await admin<{ secret: string }>("POST", `/v2/users/${user.userID}/totp`, {});
  await admin("POST", `/v2/users/${user.userID}/totp/verify`, { code: totp(reg.secret) });
  const updated = await login<{ sessionToken: string }>("PATCH", `/v2/sessions/${session.sessionId}`, {
    checks: { totp: { code: totp(reg.secret, Date.now() + 30_000) } },
  });
  const ok = await finish(authRequest, session.sessionId, updated.sessionToken);
  expect(ok.status, ok.body).toBe(200);
  const code = new URL(ok.json<{ callbackUrl: string }>().callbackUrl).searchParams.get("code") ?? "";
  expect(code).not.toBe("");

  // 4. The access token passes kit/auth RequireMFA: amr holds "mfa".
  const at = claims((await exchange(code, verifier)).access_token);
  expect(at.sub).toBe(user.userID);
  expect(rolesIn(at, demo)).toEqual(["member"]);
  expect(at.amr).toEqual(expect.arrayContaining(["pwd", "otp", "mfa"]));
});

/** Finishes the auth request with a session (OIDC v2 CreateCallback), as login v2 does. */
function finish(authRequest: string, sessionId: string, sessionToken: string) {
  return call(`${env.zitadelAPI}/v2/oidc/auth_requests/${authRequest}`, {
    method: "POST",
    host: env.authHost,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginPAT()}` },
    body: JSON.stringify({ session: { sessionId, sessionToken } }),
  });
}

/** Session API call as the login client. */
async function login<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await call(env.zitadelAPI + path, {
    method,
    host: env.authHost,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${loginPAT()}` },
    body: JSON.stringify(body),
  });
  if (res.status >= 300) throw new Error(`zitadel ${method} ${path}: ${res.status} ${res.body.slice(0, 300)}`);
  return res.json<T>();
}
