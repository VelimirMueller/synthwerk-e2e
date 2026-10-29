import { adminPAT, env } from "../config/env.ts";
import { call } from "../support/http.ts";

/** Zitadel admin API, as the bootstrap IAM owner (local and ci only). Host selects the instance. */
export async function admin<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  orgID?: string,
): Promise<T> {
  const res = await call(env.zitadelAPI + path, {
    method,
    host: env.authHost,
    headers: {
      Authorization: `Bearer ${adminPAT()}`,
      "Content-Type": "application/json",
      ...(orgID ? { "x-zitadel-orgid": orgID } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status >= 300) throw new Error(`zitadel ${method} ${path}: ${res.status} ${res.body.slice(0, 300)}`);
  return (res.body ? res.json() : {}) as T;
}

export async function orgID(name: string): Promise<string> {
  const r = await admin<{ result?: { id: string; name: string }[] }>("POST", "/admin/v1/orgs/_search", {
    queries: [{ nameQuery: { name, method: "TEXT_QUERY_METHOD_EQUALS" } }],
  });
  const o = r.result?.find((x) => x.name === name);
  if (!o) throw new Error(`org ${name} not found: run the zitadel-bootstrap first`);
  return o.id;
}

/** Project grant of projectID to orgID (the demo org gets its roles this way). */
export async function projectGrantID(projectID: string, org: string): Promise<string> {
  const r = await admin<{ result?: { grantId: string; grantedOrgId: string }[] }>(
    "POST",
    `/management/v1/projects/${projectID}/grants/_search`,
    {},
  );
  const g = r.result?.find((x) => x.grantedOrgId === org);
  if (!g) throw new Error(`no project grant for org ${org}`);
  return g.grantId;
}

export type Invited = { userID: string; email: string; userName: string; orgID: string };

/**
 * Invite only (D-51): create a user without any credential, give it a role and send
 * the invite mail. The user picks passkey or password on the invite screen.
 */
export async function invite(opts: { org: string; projectID: string; roles: string[]; tag: string }): Promise<Invited> {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const userName = `${opts.tag}.${run}`;
  const email = `${userName}@e2e.synthwerk.invalid`;
  const made = await admin<{ userId: string }>("POST", "/v2/users/human", {
    organization: { orgId: opts.org },
    username: userName,
    profile: { givenName: "E2E", familyName: opts.tag },
    email: { email, isVerified: true },
  });
  const grantID = await projectGrantID(opts.projectID, opts.org);
  await admin(
    "POST",
    `/management/v1/users/${made.userId}/grants`,
    { projectId: opts.projectID, projectGrantId: grantID, roleKeys: opts.roles },
    opts.org,
  );
  // Zitadel's default invite link opens the v1 login (/ui/login/user/invite). Login v2
  // takes the invite on its verify page.
  const urlTemplate = `${env.authURL}/ui/v2/login/verify?userId={{.UserID}}&code={{.Code}}&invite=true&organization={{.OrgID}}`;
  await admin("POST", `/v2/users/${made.userId}/invite_code`, {
    sendCode: { urlTemplate, applicationName: "Synthwerk E2E" },
  });
  return { userID: made.userId, email, userName, orgID: opts.org };
}

/**
 * True when the server-side MFA gate is on (synthwerk#94): a request execution on
 * OIDC CreateCallback has a target. synthwerk-infra turns it on with
 * SYNTHWERK_ZITADEL_MFA_GATE=true.
 */
export async function mfaGateOn(): Promise<boolean> {
  const r = await admin<{ executions?: { condition?: { request?: { method?: string } }; targets?: string[] }[] }>(
    "POST",
    "/v2/actions/executions/search",
    {},
  );
  return (r.executions ?? []).some(
    (e) =>
      e.condition?.request?.method === "/zitadel.oidc.v2.OIDCService/CreateCallback" && (e.targets ?? []).length > 0,
  );
}

/** A user with a password and a role, made directly (no invite), for API-only journeys. */
export async function userWithPassword(opts: {
  org: string;
  projectID: string;
  roles: string[];
  tag: string;
  password: string;
}): Promise<{ userID: string; userName: string }> {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const userName = `${opts.tag}.${run}`;
  const made = await admin<{ userId: string }>("POST", "/v2/users/human", {
    organization: { orgId: opts.org },
    username: userName,
    profile: { givenName: "E2E", familyName: opts.tag },
    email: { email: `${userName}@e2e.synthwerk.invalid`, isVerified: true },
    password: { password: opts.password, changeRequired: false },
  });
  const grantID = await projectGrantID(opts.projectID, opts.org);
  await admin(
    "POST",
    `/management/v1/users/${made.userId}/grants`,
    { projectId: opts.projectID, projectGrantId: grantID, roleKeys: opts.roles },
    opts.org,
  );
  return { userID: made.userId, userName };
}
