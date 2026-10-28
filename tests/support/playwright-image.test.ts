// The journeys run in mcr.microsoft.com/playwright (no apt on the runner; RAG pitfall
// "github-actions-playwright-install-with-deps-hangs-forever"). The image holds the
// browsers for one Playwright version only, so its tag must equal the locked
// @playwright/test version, pinned by digest. On a bump: read the new digest with
//   docker buildx imagetools inspect mcr.microsoft.com/playwright:v<version>-noble
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = join(import.meta.dirname, "..", "..");
const IMAGE = /mcr\.microsoft\.com\/playwright:v([^\s@]+)-noble(@sha256:[0-9a-f]{64})?/g;

function locked(): string {
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const v = new Set([...lock.matchAll(/^ {2}'@playwright\/test@([^'(]+)[^']*':$/gm)].map((m) => m[1]));
  assert.equal(v.size, 1, `one locked @playwright/test version, found ${[...v].join(", ") || "none"}`);
  return [...v][0] as string;
}

const refs = readdirSync(join(root, ".github", "workflows"))
  .filter((f) => /\.ya?ml$/.test(f))
  .flatMap((f) =>
    [...readFileSync(join(root, ".github", "workflows", f), "utf8").matchAll(IMAGE)].map((m) => ({
      f,
      version: m[1],
      digest: m[2],
    })),
  );

test("ci.yml runs the journeys in the Playwright image", () => {
  assert.ok(refs.some((r) => r.f === "ci.yml"));
});

test("image tag equals the locked @playwright/test version, pinned by digest", () => {
  const v = locked();
  for (const r of refs) {
    assert.equal(r.version, v, `${r.f}: image v${r.version}, locked ${v}`);
    assert.ok(r.digest, `${r.f}: no digest`);
  }
});
