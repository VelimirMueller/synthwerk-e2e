import { expect, test } from "@playwright/test";
import { studioClient } from "../../src/config/env.ts";
import { acceptInvite, enterLoginName } from "../../src/flows/invite.ts";
import { claims, exchange, rolesIn, startCodeFlow } from "../../src/flows/oidc.ts";
import { addAuthenticator, credentials, importCredentials } from "../../src/flows/passkey.ts";
import { invite, orgID } from "../../src/zitadel/admin.ts";

// synthwerk#28: an invited user (D-51) sets up a passkey and signs in with it.
// The token carries the org id and the role (D-50). No MFA screen: a passkey with
// user verification is MFA (spike SW-M2-0.5).
test("passkey - invited user - enrols a passkey and signs in, token has org and role", async ({ browser }) => {
  const demo = await orgID("demo");
  const { project_id } = studioClient();
  const user = await invite({ org: demo, projectID: project_id, roles: ["member"], tag: "passkey" });

  // 1. Invite mail -> choose "Passkeys" -> the device makes the passkey.
  const enrol = await browser.newContext();
  const enrolPage = await enrol.newPage();
  const device = await addAuthenticator(enrol, enrolPage);
  await acceptInvite(enrolPage, user);
  await enrolPage.getByRole("link", { name: "Passkeys" }).click();
  await expect(enrolPage.getByRole("heading", { name: "Setup a passkey" })).toBeVisible();
  await enrolPage.getByRole("button", { name: "Continue" }).click();
  await expect(enrolPage.getByText("You are signed in")).toBeVisible();
  const creds = await credentials(device);
  expect(creds).toHaveLength(1);
  expect(creds[0]?.rpId).toBe("auth.localhost");
  await enrol.close();

  // 2. Fresh browser, same device: sign in to the studio app with the passkey only.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await importCredentials(await addAuthenticator(ctx, page), creds);
  const flow = await startCodeFlow(page);
  await enterLoginName(page, user.userName);
  const code = await flow.code;
  await expect(page).not.toHaveURL(/\/mfa\//);
  const tokens = await exchange(code, flow.verifier);

  // 3. Claims (D-50): org id and the role in that org.
  const at = claims(tokens.access_token);
  expect(at.sub).toBe(user.userID);
  expect(at["urn:zitadel:iam:user:resourceowner:id"]).toBe(demo);
  expect(rolesIn(at, demo)).toEqual(["member"]);
  expect(at.aud).toContain(project_id);
  // The ID token proves the sign-in used MFA (a passkey with user verification).
  expect(claims(tokens.id_token).amr).toEqual(expect.arrayContaining(["mfa"]));
  await ctx.close();
});
