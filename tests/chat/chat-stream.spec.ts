import { signInWithPasskey } from "../../src/flows/passkey-sign-in.ts";
import { edgeRequests, expect, openHost, pageErrors, test } from "../../src/host/widget.ts";
import { waitForMember } from "../../src/identity/apps.ts";

// synthwerk#36 test 1 and synthwerk-e2e#8: a passkey user chats through the real
// <synthwerk-chat> on a customer page. Real sign-in (invite -> passkey -> code flow), the
// host hands the Zitadel token to the widget, the widget trades it for a widget token at
// identity (bound to the page origin) and streams the answer from llm through the edge and
// the WAF. The page origin is not in the edge CORS list: identity and llm answer CORS per
// app. The fake provider echoes the message one word per piece (100 ms each, overlay).
test("passkey user - chats through the widget and the answer streams in pieces", async ({ browser, app }) => {
  test.setTimeout(120_000);
  const user = await signInWithPasskey(browser, "chat");
  await waitForMember(user.tokens.access_token);
  const { page } = user;
  const requests = edgeRequests(page);
  const errors = pageErrors(page);

  await openHost(page, { widget: "chat", app, token: user.tokens.access_token });
  await page.getByRole("button", { name: "Open chat" }).click();
  const input = page.getByRole("textbox", { name: "Write a message" });
  await expect(input).toBeEnabled();

  // Record every text the answer bubble shows while it grows: a stream shows partial
  // answers, one blob shows only the final text.
  await page.evaluate(() => {
    const w = window as unknown as { answerSeen: string[] };
    w.answerSeen = [];
    const root = document.querySelector("synthwerk-chat")?.shadowRoot;
    if (!root) throw new Error("no shadow root on synthwerk-chat");
    new MutationObserver(() => {
      const text = root.querySelector(".sw-msg--assistant:not(.sw-msg--greeting)")?.textContent?.trim() ?? "";
      if (text && w.answerSeen.at(-1) !== text) w.answerSeen.push(text);
    }).observe(root, { subtree: true, childList: true, characterData: true });
  });

  const marker = `e2e widget probe ${Date.now()}`;
  const streamed = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/llm\/v1\/conversations\/[^/]+\/messages$/.test(r.url()),
  );
  await input.fill(marker);
  await page.getByRole("button", { name: "Send" }).click();

  // 1. The answer is this user's turn: the fake echoes "echo: <message>". The bubble
  //    starts with a label for screen readers ("Assistant: ").
  const answer = page.locator("synthwerk-chat .sw-msg--assistant.sw-msg--done");
  await expect(answer).toHaveText(`Assistant: echo: ${marker}`);

  // 2. It arrived in more than one piece: an SSE answer, and the bubble showed growing
  //    partial answers before the full one (one blob would show only the full text). The
  //    widget reads the body itself, so the browser keeps no copy of the frames.
  const res = await streamed;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/event-stream");
  const seen = await page.evaluate(() => (window as unknown as { answerSeen: string[] }).answerSeen);
  const full = `Assistant: echo: ${marker}`;
  const partial = seen.filter((t) => t !== full && full.startsWith(t) && t.length > "Assistant: ".length);
  expect(partial.length, `bubble texts: ${JSON.stringify(seen)}`).toBeGreaterThanOrEqual(2);

  // 3. The widget talks to the edge only in the documented order: public settings, one
  //    token trade, then llm with the widget token.
  expect(requests.filter((r) => !r.startsWith("OPTIONS "))).toEqual([
    `GET /identity/v1/apps/${app.id}/widget-settings`,
    `POST /identity/v1/apps/${app.id}/widget-tokens`,
    "POST /llm/v1/conversations",
    expect.stringMatching(/^POST \/llm\/v1\/conversations\/[^/]+\/messages$/),
  ]);
  expect(errors).toEqual([]);
  await user.context.close();
});
