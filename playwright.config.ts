import { defineConfig, devices } from "@playwright/test";
import { env } from "./src/config/env.ts";

// Chromium only: the passkey tests use the CDP virtual authenticator (spec #36).
// The host page origins (src/config/env.ts) are names for the loopback host page.
const HOST_RESOLVER = "--host-resolver-rules=MAP *.e2e.test 127.0.0.1";

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // The customer page that embeds the real widgets (synthwerk-e2e#8, #9).
  webServer: {
    command: "node src/host/serve.ts",
    url: `https://127.0.0.1:${env.hostPort}/healthz`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    trace: "on-first-retry",
    video: "retain-on-failure",
    locale: "en-US",
    // The host page has a throwaway self-signed certificate (src/host/serve.ts).
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/vision-camera.spec.ts",
      use: { ...devices["Desktop Chrome"], launchOptions: { args: [HOST_RESOLVER] } },
    },
    {
      // New headless Chromium: the default headless shell has no media capture, so the
      // fake camera fails with NotSupportedError there. Only the camera journey runs here:
      // new headless refuses a navigation to an empty 4xx page (redirect-uri.spec.ts).
      name: "chromium-camera",
      testMatch: "**/vision-camera.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chromium",
        launchOptions: { args: [HOST_RESOLVER, "--use-fake-device-for-media-stream"] },
      },
    },
  ],
});
