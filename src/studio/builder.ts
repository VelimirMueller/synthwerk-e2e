import { env } from "../config/env.ts";
import { authRequestOf, finishAuthRequest, totpUser } from "../flows/session.ts";
import { call, type Reply } from "../support/http.ts";
import { orgID } from "../zitadel/admin.ts";

/** A studio session: the session cookie of the BFF and its CSRF token (synthwerk#95). */
export type StudioSession = { cookie: string; csrf: string; org: string };

/** One call to studio from Node: loopback address, Host and Origin of the studio origin. */
function studio(
  path: string,
  opts: { method?: string; cookie?: string; headers?: Record<string, string>; body?: unknown } = {},
) {
  return call(env.siteLoopback + path, {
    method: opts.method,
    host: new URL(env.siteURL).host,
    headers: {
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      // The BFF CSRF guard: every unsafe call must come from the studio origin.
      ...((opts.method ?? "GET") === "GET" ? {} : { Origin: env.siteURL }),
      ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/** The name=value pair of a Set-Cookie header, or "". */
function cookieOf(res: Reply, name: string): string {
  const raw = res.headers["set-cookie"];
  const all = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = all.map((c) => c.split(";")[0] ?? "").find((c) => c.startsWith(`${name}=`));
  return hit && hit !== `${name}=` ? hit : "";
}

/**
 * Signs a fresh demo user with a role into studio through the BFF code flow, without a
 * browser: studio /api/auth/login, Zitadel authorize, a Session API session (password + TOTP,
 * so the token carries mfa), then studio /api/auth/callback opens the session.
 */
export async function studioSignIn(role: string, tag: string): Promise<StudioSession> {
  const user = await totpUser({ org: await orgID("demo"), roles: [role], tag });
  const login = await studio("/api/auth/login");
  const loginCookie = cookieOf(login, "__Host-sw_login");
  if (login.status !== 302 || !login.location || !loginCookie) {
    throw new Error(`studio /api/auth/login: ${login.status}, no redirect or login cookie`);
  }
  const authorize = new URL(login.location);
  const auth = await call(env.edge + authorize.pathname + authorize.search, { host: env.authHost });
  const callback = new URL(await finishAuthRequest(authRequestOf(auth.location, auth.status), user));
  const done = await studio(callback.pathname + callback.search, { cookie: loginCookie });
  const cookie = cookieOf(done, "__Host-sw_session");
  if (!cookie) throw new Error(`studio callback: ${done.status} -> ${done.location ?? ""}, no session`);
  const session = await studio("/api/auth/session", { cookie });
  if (session.status !== 200) throw new Error(`studio /api/auth/session: ${session.status}`);
  const s = session.json<{ csrfToken: string; org: { id: string } }>();
  return { cookie, csrf: s.csrfToken, org: s.org.id };
}

/** One page builder call as the session (CSRF token on every call; studio checks it on writes). */
export async function builder<T = unknown>(s: StudioSession, method: string, path: string, body?: unknown) {
  const res = await studio(`/api/builder${path}`, {
    method,
    cookie: s.cookie,
    headers: { "x-csrf-token": s.csrf },
    body,
  });
  return { status: res.status, body: res.body, json: () => res.json<T>() };
}

export type PageSummary = {
  id: string;
  slug: string;
  locale: "de" | "en";
  liveVersion: number | null;
  draftRevision: number;
  /** The draft differs from the live version (or nothing is live yet). */
  changed: boolean;
};

/**
 * Waits until the builder accepts the session: studio asks identity for the stored role, and
 * identity learns a new Zitadel grant a moment after the token exists (grant hook).
 */
export async function waitForBuilder(s: StudioSession): Promise<PageSummary[]> {
  let last = { status: 0, body: "" };
  for (let i = 0; i < 30; i++) {
    const res = await builder<PageSummary[]>(s, "GET", "/pages");
    if (res.status === 200) return res.json();
    last = res;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`studio builder refuses the session after 30 s: ${last.status} ${last.body.slice(0, 300)}`);
}

/** Page content with one hero section: only text, so the page itself loads nothing. */
export function heroContent(title: string, heading: string) {
  return {
    title,
    sections: [
      {
        id: "h1",
        type: "hero",
        eyebrow: "",
        title: heading,
        body: "E2E request audit.",
        primary: null,
        secondary: null,
      },
    ],
  };
}

/** Creates a page (or takes the one with that slug and locale), saves the content and publishes it. */
export async function publishPage(
  s: StudioSession,
  pages: PageSummary[],
  page: { slug: string; locale: "de" | "en"; title: string; heading: string },
): Promise<PageSummary> {
  let summary = pages.find((p) => p.slug === page.slug && p.locale === page.locale);
  if (!summary) {
    const made = await builder<PageSummary>(s, "POST", "/pages", {
      slug: page.slug,
      locale: page.locale,
      title: page.title,
    });
    if (made.status !== 201)
      throw new Error(`builder create ${page.locale}/${page.slug}: ${made.status} ${made.body.slice(0, 300)}`);
    summary = made.json();
  }
  const saved = await builder<PageSummary>(s, "PUT", `/pages/${summary.id}/draft`, {
    revision: summary.draftRevision,
    content: heroContent(page.title, page.heading),
  });
  if (saved.status !== 200)
    throw new Error(`builder draft ${page.locale}/${page.slug}: ${saved.status} ${saved.body.slice(0, 300)}`);
  // A later run on the same stack: the same content is live already (publish says no_changes).
  const draft = saved.json();
  if (!draft.changed && draft.liveVersion !== null) return draft;
  const published = await builder<PageSummary>(s, "POST", `/pages/${summary.id}/publish`, {
    revision: draft.draftRevision,
  });
  if (published.status !== 201) {
    throw new Error(`builder publish ${page.locale}/${page.slug}: ${published.status} ${published.body.slice(0, 300)}`);
  }
  return published.json();
}

/** Deletes a page (owners only). Best effort: the stack is thrown away anyway. */
export async function deletePage(s: StudioSession, page: PageSummary): Promise<void> {
  await builder(s, "DELETE", `/pages/${page.id}`, { slug: page.slug });
}
