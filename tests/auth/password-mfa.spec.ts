import { expect, test } from "@playwright/test";
import { studioClient } from "../../src/config/env.ts";
import { acceptInvite, enterLoginName } from "../../src/flows/invite.ts";
import { claims, exchange, rolesIn, startCodeFlow } from "../../src/flows/oidc.ts";
import { totp } from "../../src/support/totp.ts";
import { invite, orgID } from "../../src/zitadel/admin.ts";

// synthwerk#28: an invited user (D-51) who picks email and password must set up a
// second factor before the first token (Force MFA, D-47). The test enrols TOTP.
test("email - invited user with password - must set up MFA before the first token", async ({ browser }) => {
  const demo = await orgID("demo");
  const { project_id } = studioClient();
  const user = await invite({ org: demo, projectID: project_id, roles: ["member"], tag: "password" });
  // Meets the bootstrap policy: 12+ characters, upper, lower, number, symbol.
  const password = `Sw-e2e-${user.userID.slice(-6)}-Pw!`;

  // 1. Invite mail -> choose "Password" -> set it.
  const enrol = await browser.newContext();
  const enrolPage = await enrol.newPage();
  await acceptInvite(enrolPage, user);
  await enrolPage.getByRole("link", { name: "Password" }).click();
  await expect(enrolPage.getByText("Set the password for your account")).toBeVisible();
  await enrolPage.getByLabel("New Password").fill(password);
  await enrolPage.getByLabel("Confirm Password").fill(password);
  await enrolPage.getByRole("button", { name: "Continue" }).click();
  // Saved: Force MFA sends the user straight to second-factor setup. The test
  // leaves it there, so the sign-in below must ask again.
  await expect(enrolPage).toHaveURL(/\/mfa\/set\?.*force=true/, { timeout: 30_000 });
  await enrol.close();

  // 2. Fresh browser: sign in to the studio app with the password.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const flow = await startCodeFlow(page);
  await enterLoginName(page, user.userName);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();

  // 3. Force MFA: the login UI sends the user to second-factor setup. No code yet.
  await expect(page).toHaveURL(/\/mfa\/set\?.*force=true/);
  await expect(page.getByRole("heading", { name: "Set up 2-Factor" })).toBeVisible();
  expect(flow.redirected()).toBe(false);

  // 4. Authenticator app: read the secret, answer with a TOTP code.
  await page.getByRole("link", { name: "Authenticator App" }).click();
  const uri = await page.getByRole("link", { name: /^otpauth:\/\/totp\// }).innerText();
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  const setupCode = totp(secret);
  await page.getByLabel("Code").fill(setupCode);
  await page.getByRole("button", { name: "Continue" }).click();
  // checkAfter: the login UI asks for one more code to prove the new factor. A code is
  // valid once, so wait for the next 30 s window (no fixed sleep).
  await expect(page.getByRole("heading", { name: "Verify 2-Factor" })).toBeVisible();
  expect(flow.redirected()).toBe(false);
  await expect.poll(() => totp(secret), { timeout: 35_000, intervals: [1_000] }).not.toBe(setupCode);
  await page.getByLabel("Code").fill(totp(secret));
  await page.getByRole("button", { name: "Continue" }).click();

  // 5. Only now the code comes. Claims carry org id and role (D-50).
  const code = await flow.code;
  const tokens = await exchange(code, flow.verifier);
  const at = claims(tokens.access_token);
  expect(at.sub).toBe(user.userID);
  expect(at["urn:zitadel:iam:user:resourceowner:id"]).toBe(demo);
  expect(rolesIn(at, demo)).toEqual(["member"]);
  // Zitadel puts no amr into the access token (ADR-0002 in synthwerk-infra); the ID
  // token shows the second factor of this sign-in.
  expect(at.amr).toBeUndefined();
  expect(claims(tokens.id_token).amr).toEqual(expect.arrayContaining(["pwd", "otp", "mfa"]));
  await ctx.close();
});
