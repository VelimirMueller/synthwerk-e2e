import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";
import { studioClient } from "../config/env.ts";
import { invite, orgID } from "../zitadel/admin.ts";
import { acceptInvite, enterLoginName } from "./invite.ts";
import { exchange, startCodeFlow, type Tokens } from "./oidc.ts";
import { addAuthenticator, credentials, importCredentials } from "./passkey.ts";

export type PasskeyUser = { context: BrowserContext; page: Page; userID: string; tokens: Tokens };

/**
 * An invited demo member enrols a passkey, then signs in with it in a fresh context (same
 * device). Returns that signed-in context: a passkey with user verification is MFA, so no
 * MFA screen shows. The caller closes the context.
 */
export async function signInWithPasskey(browser: Browser, tag: string): Promise<PasskeyUser> {
  const demo = await orgID("demo");
  const user = await invite({ org: demo, projectID: studioClient().project_id, roles: ["member"], tag });

  const enrol = await browser.newContext();
  const enrolPage = await enrol.newPage();
  const device = await addAuthenticator(enrol, enrolPage);
  await acceptInvite(enrolPage, user);
  await enrolPage.getByRole("link", { name: "Passkeys" }).click();
  await expect(enrolPage.getByRole("heading", { name: "Setup a passkey" })).toBeVisible();
  await enrolPage.getByRole("button", { name: "Continue" }).click();
  await expect(enrolPage.getByText("You are signed in")).toBeVisible();
  const creds = await credentials(device);
  await enrol.close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await importCredentials(await addAuthenticator(context, page), creds);
  const flow = await startCodeFlow(page);
  await enterLoginName(page, user.userName);
  const code = await flow.code;
  await expect(page).not.toHaveURL(/\/mfa\//);
  return { context, page, userID: user.userID, tokens: await exchange(code, flow.verifier) };
}
