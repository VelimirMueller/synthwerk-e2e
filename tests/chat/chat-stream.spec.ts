import { expect, test } from "@playwright/test";
import { env, studioClient } from "../../src/config/env.ts";
import { acceptInvite, enterLoginName } from "../../src/flows/invite.ts";
import { exchange, startCodeFlow } from "../../src/flows/oidc.ts";
import { addAuthenticator, credentials, importCredentials } from "../../src/flows/passkey.ts";
import { invite, orgID } from "../../src/zitadel/admin.ts";

// One SSE frame as the contract defines it: id "<message_id>:<seq>", event name,
// one line of JSON as data, at holds the arrival time (performance.now in the page).
type Frame = { id: string; event: string; data: string; at: number };

// synthwerk#36, test 1: a passkey user gets a streamed answer. Real sign-in (invite
// -> passkey enrolment -> code flow), then a real stream through the edge and the
// WAF. The fake provider echoes the message one word per piece (100 ms each, set in
// stack/compose.e2e.yaml), so the journey can assert on the exact answer.
test("passkey user - chats and the answer streams through the edge", async ({ browser }) => {
  test.setTimeout(120_000);
  const demo = await orgID("demo");
  const user = await invite({ org: demo, projectID: studioClient().project_id, roles: ["member"], tag: "chat" });

  // 1. Enrol a passkey, like any invited user.
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

  // 2. Fresh browser, same device: sign in with the passkey. A passkey with user
  //    verification is MFA, so no MFA screen shows.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await importCredentials(await addAuthenticator(ctx, page), creds);
  const flow = await startCodeFlow(page);
  await enterLoginName(page, user.userName);
  const code = await flow.code;
  await expect(page).not.toHaveURL(/\/mfa\//);
  const tokens = await exchange(code, flow.verifier);

  // 3. Chat from the browser at the edge origin, like the widget will (synthwerk#34).
  //    The /stub page stands in for the app page until the widget exists.
  await page.goto(`${env.edge}/stub`);
  const marker = `e2e chat probe ${Date.now()}`;
  const frames = await page.evaluate(
    async ({ base, token, marker }): Promise<Frame[]> => {
      const create = await fetch(`${base}/llm/v1/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      if (create.status !== 201) throw new Error(`create: ${create.status} ${await create.text()}`);
      const conversation = (await create.json()) as { id: string };
      const res = await fetch(`${base}/llm/v1/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: marker }),
      });
      if (!res.ok || !res.body) throw new Error(`send: ${res.status} ${await res.text()}`);

      // Read the stream as it arrives; one frame per SSE event block.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const out: Frame[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: (.+)$/m.exec(chunk)?.[1];
          if (!event) continue; // a ": ping" comment holds the connection open
          out.push({
            id: /^id: (.+)$/m.exec(chunk)?.[1] ?? "",
            event,
            data: /^data: (.+)$/m.exec(chunk)?.[1] ?? "",
            at: performance.now(),
          });
        }
      }
      return out;
    },
    { base: env.edge, token: tokens.access_token, marker },
  );

  // 4. Shape per contract: deltas first, then usage, then done. Never an error event.
  const events = frames.map((f) => f.event);
  expect(events.at(0)).toBe("delta");
  expect(events.filter((e) => e === "error")).toEqual([]);
  expect(events.slice(-2)).toEqual(["usage", "done"]);

  // 5. The answer is this user's turn, streamed in pieces. The fake echoes
  //    "echo: <message>" one word per piece, so a marker in finds the marker out.
  const deltas = frames.filter((f) => f.event === "delta");
  const answer = deltas.map((f) => (JSON.parse(f.data) as { text: string }).text).join("");
  expect(answer).toBe(`echo: ${marker}`);
  expect(deltas.length).toBeGreaterThanOrEqual(4);

  // 6. Every frame names the same message, done carries its id.
  const done = JSON.parse(frames.at(-1)?.data ?? "{}") as { message_id: string; finish_reason: string };
  expect(done.finish_reason).toBe("stop");
  for (const f of frames) expect(f.id.startsWith(`${done.message_id}:`)).toBe(true);

  // TODO(Velimir): the streaming proof above is structural (pieces, order, echo).
  // frames[].at holds the page-clock arrival time of every frame, and the fake
  // delays 100 ms per piece, so a temporal proof fits here: assert the spread
  // between the first and the last delta. Decide whether CI can afford a timing
  // assertion (slow runners) or whether the structure stays the only proof.
  await ctx.close();
});
