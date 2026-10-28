import { expect } from "@playwright/test";
import { env } from "../config/env.ts";
import { call } from "./http.ts";

type Search = { messages_count: number; messages: { ID: string }[] };

/** Waits for the newest mail to `to` and returns its first link that matches `pattern`. */
export async function linkFromMail(to: string, pattern: RegExp): Promise<string> {
  let id = "";
  await expect
    .poll(
      async () => {
        const r = await call(`${env.mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const s = r.json<Search>();
        id = s.messages?.[0]?.ID ?? "";
        return s.messages_count ?? 0;
      },
      { message: `mail to ${to} in Mailpit`, timeout: 60_000 },
    )
    .toBeGreaterThan(0);
  const msg = (await call(`${env.mailpit}/api/v1/message/${id}`)).json<{ HTML: string; Text: string }>();
  const text = `${msg.Text}\n${msg.HTML}`.replaceAll("&amp;", "&");
  const link = text.match(pattern)?.[0];
  if (!link) throw new Error(`no link like ${pattern} in the mail to ${to}`);
  return link;
}
