import { env } from "../../src/config/env.ts";
import { edgeRequests, expect, openHost, test } from "../../src/host/widget.ts";
import { demoMember } from "../../src/identity/apps.ts";

// synthwerk#33 and synthwerk-e2e#8: a user over quota sees the quota state in the widget,
// not a model answer. The overlay sets the user quota to 1500 tokens a day; the gateway
// books about 1050 tokens (input estimate + 1024 answer reserve) before each stream. The
// user quota key is the user (sub), shared by the Zitadel token and the widget token of
// the same user. So one long stream that the user's own app holds open (Node, Zitadel
// token) fills the quota, and the widget send in the meantime gets 429 quota_exhausted.
test("signed-in user over quota - the widget shows the quota state, the open stream finishes", async ({
  page,
  app,
}) => {
  test.setTimeout(120_000);
  const user = await demoMember("member", "quota");
  const token = user.tokens.access_token;
  const requests = edgeRequests(page);

  await openHost(page, { widget: "chat", app, token });
  await page.getByRole("button", { name: "Open chat" }).click();
  const input = page.getByRole("textbox", { name: "Write a message" });
  await expect(input).toBeEnabled();

  // 1. Hold the quota: a 100-word echo (100 ms a word) streams for about 10 s.
  const holder = await openStream(token, Array.from({ length: 100 }, (_, i) => `w${i}`).join(" "));
  await holder.firstDelta;

  // 2. The widget send is refused before the model, with the typed problem of the contract.
  const refusedRes = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/llm\/v1\/conversations\/[^/]+\/messages$/.test(r.url()),
  );
  await input.fill("one more");
  await page.getByRole("button", { name: "Send" }).click();
  const refused = await refusedRes;
  expect(refused.status()).toBe(429);
  expect(refused.headers()["content-type"]).toContain("application/problem+json");
  const problem = (await refused.json()) as {
    code: string;
    quota?: { scope: string; unit: string; limit: number; resets_at: string };
  };
  expect(problem.code).toBe("quota_exhausted");
  expect(problem.quota).toMatchObject({ scope: "user", unit: "tokens", limit: 1500 });
  // resets_at is the next UTC midnight; near midnight either of two days is right.
  const midnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  const now = new Date();
  expect([midnight(new Date(now.getTime() - 60_000)), midnight(now)]).toContain(
    Date.parse(problem.quota?.resets_at ?? ""),
  );
  const retryAfter = Number(refused.headers()["retry-after"]);
  expect(retryAfter).toBeGreaterThan(0);
  expect(retryAfter).toBeLessThanOrEqual(86400);

  // 3. The widget shows the quota state with the reset time and blocks the input.
  await expect(page.getByRole("alert")).toContainText("You used all of your chat quota. It resets at");
  await expect(input).toBeDisabled();
  await expect(page.locator("synthwerk-chat .sw-msg--assistant.sw-msg--done")).toHaveCount(0);

  // 4. Nothing was stored for the refused send: the widget's conversation has no turn.
  const created = requests.filter((r) => r === "POST /llm/v1/conversations").length;
  expect(created).toBe(1);
  const convID = /\/llm\/v1\/conversations\/([^/]+)\/messages$/.exec(refused.url())?.[1] ?? "";
  const conv = await fetch(`${env.edge}/llm/v1/conversations/${convID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(conv.status).toBe(200);
  expect(((await conv.json()) as { messages: unknown[] }).messages).toEqual([]);

  // 5. The stream that holds the quota is not touched by the refusal: it ends with usage, done.
  expect((await holder.events).slice(-2)).toEqual(["usage", "done"]);
});

/** Opens a chat stream outside the browser and reads its event names until it ends. */
async function openStream(token: string, content: string) {
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  const made = await fetch(`${env.edge}/llm/v1/conversations`, { method: "POST", headers, body: "{}" });
  if (made.status !== 201) throw new Error(`create: ${made.status} ${await made.text()}`);
  const { id } = (await made.json()) as { id: string };
  const res = await fetch(`${env.edge}/llm/v1/conversations/${id}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) throw new Error(`send: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let markDelta: () => void = () => {};
  const firstDelta = new Promise<void>((resolve) => {
    markDelta = resolve;
  });
  const events = (async () => {
    const names: string[] = [];
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return names;
      buf += decoder.decode(value, { stream: true });
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const name = /^event: (.+)$/m.exec(buf.slice(0, i))?.[1];
        buf = buf.slice(i + 2);
        if (!name) continue;
        names.push(name);
        if (name === "delta") markDelta();
      }
    }
  })();
  return { firstDelta, events };
}
