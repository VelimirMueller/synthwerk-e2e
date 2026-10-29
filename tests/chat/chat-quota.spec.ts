import { expect, test } from "@playwright/test";
import { env, studioClient } from "../../src/config/env.ts";
import { acceptInvite, enterLoginName } from "../../src/flows/invite.ts";
import { exchange, startCodeFlow } from "../../src/flows/oidc.ts";
import { addAuthenticator, credentials, importCredentials } from "../../src/flows/passkey.ts";
import { invite, orgID } from "../../src/zitadel/admin.ts";

// What the page reports back: the refused send and the end of the open stream.
type Outcome = {
  refused: { status: number; type: string; retryAfter: string | null; body: string };
  firstEvents: string[];
  lastEvents: string[];
  secondMessages: number;
};

// synthwerk#33: a user over quota gets a clear error, not a model call. The overlay
// sets the user quota to 1500 tokens a day and the gateway books about 1050 tokens
// (input estimate + 1024 answer reserve) before each stream. So one open stream
// fits, and a second send while it runs does not: the quota is counted before the
// stream starts, not after it ends. Real sign-in, real edge and WAF, fake provider.
test("passkey user - a send over quota gets 429 quota_exhausted, the open stream finishes", async ({ browser }) => {
  test.setTimeout(120_000);
  const demo = await orgID("demo");
  const user = await invite({ org: demo, projectID: studioClient().project_id, roles: ["member"], tag: "quota" });

  // 1. Enrol a passkey and sign in with it (same steps as chat-stream.spec.ts).
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

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await importCredentials(await addAuthenticator(ctx, page), creds);
  const flow = await startCodeFlow(page);
  await enterLoginName(page, user.userName);
  const tokens = await exchange(await flow.code, flow.verifier);

  // 2. From the page: open a long stream (20 words, 100 ms each), wait for its
  //    first delta, then send again in a second conversation. The second send must
  //    be refused before the first byte; the first stream must still end with done.
  await page.goto(`${env.edge}/stub`);
  const out = await page.evaluate(
    async ({ base, token }): Promise<Outcome> => {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const create = async (): Promise<string> => {
        const res = await fetch(`${base}/llm/v1/conversations`, { method: "POST", headers, body: "{}" });
        if (res.status !== 201) throw new Error(`create: ${res.status}`);
        return ((await res.json()) as { id: string }).id;
      };
      const first = await create();
      const second = await create();

      const words = Array.from({ length: 20 }, (_, i) => `w${i}`).join(" ");
      const res = await fetch(`${base}/llm/v1/conversations/${first}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: words }),
      });
      if (!res.ok || !res.body) throw new Error(`send 1: ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const names: string[] = [];
      const pull = async (until: (n: string[]) => boolean) => {
        while (!until(names)) {
          const { done, value } = await reader.read();
          if (done) return;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const event = /^event: (.+)$/m.exec(buf.slice(0, i))?.[1];
            buf = buf.slice(i + 2);
            if (event) names.push(event);
          }
        }
      };
      await pull((n) => n.includes("delta"));
      const firstEvents = [...names];

      // The first stream is open and holds its booking.
      const over = await fetch(`${base}/llm/v1/conversations/${second}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: "one more" }),
      });
      const refused = {
        status: over.status,
        type: over.headers.get("content-type") ?? "",
        retryAfter: over.headers.get("retry-after"),
        body: await over.text(),
      };

      await pull(() => false); // read the first stream to its end
      const got = await fetch(`${base}/llm/v1/conversations/${second}`, { headers });
      const secondMessages = ((await got.json()) as { messages: unknown[] }).messages.length;
      return { refused, firstEvents, lastEvents: names.slice(-2), secondMessages };
    },
    { base: env.edge, token: tokens.access_token },
  );

  // 3. The refusal is the typed problem of the contract (openapi/llm QuotaExceeded).
  expect(out.refused.status).toBe(429);
  expect(out.refused.type).toContain("application/problem+json");
  const problem = JSON.parse(out.refused.body) as {
    code: string;
    quota?: { scope: string; unit: string; limit: number; resets_at: string };
  };
  expect(problem.code).toBe("quota_exhausted");
  expect(problem.quota).toMatchObject({ scope: "user", unit: "tokens", limit: 1500 });
  // resets_at is the next UTC midnight after the refusal. Near midnight the clock may
  // turn between the send and this line, so either of two days is right.
  const midnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const now = new Date();
  const resets = Date.parse(problem.quota?.resets_at ?? "");
  expect([midnight(new Date(now.getTime() - 60_000)), midnight(now)]).toContain(resets);
  expect(out.refused.retryAfter).not.toBeNull();
  const retryAfter = Number(out.refused.retryAfter);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(86400);

  // 4. Nothing was stored for the refused send, so no turn reached the model.
  expect(out.secondMessages).toBe(0);

  // 5. The admitted stream is not touched by the refusal: it ends with usage, done.
  expect(out.firstEvents).toContain("delta");
  expect(out.lastEvents).toEqual(["usage", "done"]);
  await ctx.close();
});
