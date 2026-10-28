import type { BrowserContext, CDPSession, Page } from "@playwright/test";

export type Authenticator = { cdp: CDPSession; id: string };

/**
 * A virtual platform authenticator (CDP WebAuthn, Chromium only): CTAP2, resident
 * keys, user verification on. Without user verification Zitadel does not count the
 * passkey as MFA (spike SW-M2-0.5).
 */
export async function addAuthenticator(context: BrowserContext, page: Page): Promise<Authenticator> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, id: authenticatorId };
}

export async function credentials(a: Authenticator) {
  const { credentials } = await a.cdp.send("WebAuthn.getCredentials", { authenticatorId: a.id });
  return credentials;
}

/** Copies credentials into another authenticator: the same device in a fresh browser. */
export async function importCredentials(a: Authenticator, creds: Awaited<ReturnType<typeof credentials>>) {
  for (const credential of creds) await a.cdp.send("WebAuthn.addCredential", { authenticatorId: a.id, credential });
}
