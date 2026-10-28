import { expect, type Page } from "@playwright/test";
import { linkFromMail } from "../support/mailpit.ts";
import type { Invited } from "../zitadel/admin.ts";

/** Opens the invite link from the mail and lands on "Choose authentication method". */
export async function acceptInvite(page: Page, user: Invited): Promise<void> {
  const link = await linkFromMail(user.email, /http:\/\/[^\s"<)]+\/ui\/v2\/login\/verify\?[^\s"<)]+/);
  await page.goto(link);
  // The code comes prefilled from the link.
  await expect(page.getByRole("textbox").first()).not.toHaveValue("");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Choose authentication method" })).toBeVisible();
}

/** Login name step of the hosted login UI. */
export async function enterLoginName(page: Page, loginName: string): Promise<void> {
  await page.getByRole("textbox").first().fill(loginName);
  await page.getByRole("button", { name: "Continue" }).click();
}
