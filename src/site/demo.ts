import type { BrowserContext } from "@playwright/test";
import { env } from "../config/env.ts";
import { type SignedIn, signInUser, type TOTPUser, totpUser } from "../flows/session.ts";
import { waitForMember } from "../identity/apps.ts";
import { type StudioSession, studio, studioSignInAs } from "../studio/builder.ts";
import { orgID } from "../zitadel/admin.ts";

/**
 * A fresh demo org member for the site demo (synthwerk#47), signed in twice: into studio (the
 * BFF session the demo uses) and through the Session API (the Zitadel token of the same user,
 * for the llm export). Waits until identity knows the membership: the image demo trades a
 * widget token for the demo app of the demo org.
 */
export async function demoVisitor(tag: string): Promise<{ user: TOTPUser; studio: StudioSession; zitadel: SignedIn }> {
  const user = await totpUser({ org: await orgID("demo"), roles: ["member"], tag });
  const session = await studioSignInAs(user);
  const zitadel = await signInUser(user);
  await waitForMember(zitadel.tokens.access_token);
  return { user, studio: session, zitadel };
}

/** Puts the studio session cookie into the browser: the page is signed in, no sign-in UI. */
export async function useSession(context: BrowserContext, s: StudioSession): Promise<void> {
  const at = s.cookie.indexOf("=");
  if (at < 1) throw new Error("studio session cookie is not name=value");
  await context.addCookies([
    {
      name: s.cookie.slice(0, at),
      value: s.cookie.slice(at + 1),
      url: env.siteURL,
      // studio sets __Host- cookies: Secure, path /, no domain. Chromium takes Secure on localhost.
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

/** One demo chat call from Node, as the browser sends it (session cookie, CSRF token, Origin). */
export function demoChat(s: StudioSession, message: string) {
  return studio("/api/site/demo/chat", {
    method: "POST",
    cookie: s.cookie,
    headers: { "x-csrf-token": s.csrf },
    body: { message },
  });
}

/** The error code of a refused demo call (studio error body: data.code). */
export function demoCode(body: string): string | null {
  try {
    const code = (JSON.parse(body) as { data?: { code?: unknown } }).data?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

type Export = { conversations: { messages: { role: string }[] }[] };

/** The llm data of the user (GET /llm/v1/me/export, Zitadel token): conversations and answers. */
export async function llmLoad(token: string): Promise<{ conversations: number; answers: number }> {
  const res = await fetch(`${env.edge}/llm/v1/me/export`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status !== 200) throw new Error(`llm GET /v1/me/export: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as Export;
  return {
    conversations: data.conversations.length,
    answers: data.conversations.flatMap((c) => c.messages).filter((m) => m.role === "assistant").length,
  };
}
