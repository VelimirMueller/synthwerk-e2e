import { readFileSync } from "node:fs";
import { join } from "node:path";

// Where the stack runs. Defaults match synthwerk-infra on one machine (local and ci).
const edgePort = process.env.E2E_EDGE_PORT ?? "8080";

export const env = {
  /** Edge on loopback. Node calls go here, with the Host header of the target host. */
  edge: `http://127.0.0.1:${edgePort}`,
  /** Zitadel host as the browser sees it (issuer, passkey rpId: auth.localhost). */
  authHost: `${process.env.E2E_AUTH_DOMAIN ?? "auth.localhost"}:${edgePort}`,
  get authURL() {
    return `http://${this.authHost}`;
  },
  /** Zitadel API for test setup, published by stack/compose.e2e.yaml (not through the WAF). */
  zitadelAPI: `http://127.0.0.1:${process.env.E2E_ZITADEL_API_PORT ?? "8090"}`,
  /**
   * identity API for test setup, published by stack/compose.e2e.yaml (not through the WAF):
   * the site demo app has the origin http://localhost:<site port>, and the edge WAF blocks a
   * localhost URL in a request body (CRS 934110).
   */
  identityAPI: `http://127.0.0.1:${process.env.E2E_IDENTITY_API_PORT ?? "8091"}`,
  /** Mailpit API (D-49). */
  mailpit: process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025",
  /** Studio redirect URI registered by the bootstrap. Nothing listens there: the test catches it. */
  redirectURI: process.env.E2E_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback",
  /** Folder that scripts/stack-secrets.sh fills. */
  secretsDir: process.env.E2E_SECRETS_DIR ?? join(process.cwd(), ".stack"),
  /** Port of the test host page (src/host/serve.ts). */
  hostPort: Number(process.env.E2E_HOST_PORT ?? "4174"),
  /**
   * Origin of the host page, a customer site; the widget app allows only this origin.
   * Chromium maps *.e2e.test to 127.0.0.1 (playwright.config.ts). https with a throwaway
   * certificate: identity takes http only for localhost, and the edge WAF blocks a
   * localhost URL in a request body (CRS 934110, SSRF).
   */
  get hostOrigin() {
    return `https://shop.e2e.test:${this.hostPort}`;
  },
  /** Same server, other origin: no app allows it (the origin error journeys). */
  get foreignOrigin() {
    return `https://other.e2e.test:${this.hostPort}`;
  },
  /** dist/ of a synthwerk-widgets build (synthwerk-chat.js, synthwerk-vision.js). */
  widgetsDist: process.env.E2E_WIDGETS_DIST ?? join(process.cwd(), "..", "synthwerk-widgets", "dist"),
  /** Port of studio in the stack (compose profile studio, SYNTHWERK_STUDIO_PORT). */
  sitePort: Number(process.env.E2E_SITE_PORT ?? "3001"),
  /** The public site as the browser sees it: studio's own origin (synthwerk#45). */
  get siteURL() {
    return `http://localhost:${this.sitePort}`;
  },
  /** Same server for Node calls: loopback address, Host header localhost:<port>. */
  get siteLoopback() {
    return `http://127.0.0.1:${this.sitePort}`;
  },
  /**
   * The analytics script that stack/compose.e2e.yaml gives studio. A third-party origin on
   * purpose: the request audit proves it loads only after the opt-in. The test answers it.
   */
  siteAnalyticsURL: process.env.E2E_SITE_ANALYTICS_URL ?? "https://analytics.e2e.test/script.js",
};

export type StudioClient = { project_id: string; app_id: string; client_id: string; client_secret: string };

export function adminPAT(): string {
  return readFileSync(join(env.secretsDir, "admin.pat"), "utf8").trim();
}

/** PAT of the login client (IAM_LOGIN_CLIENT): it may finish auth requests with a session. */
export function loginPAT(): string {
  return readFileSync(join(env.secretsDir, "login-client.pat"), "utf8").trim();
}

/** Zitadel id of the org whose builder pages the public site shows (scripts/stack-secrets.sh). */
export function siteOrgID(): string {
  return readFileSync(join(env.secretsDir, "site-org-id"), "utf8").trim();
}

/** The demo app of the site demo (scripts/site-demo-app.ts, NUXT_SITE_DEMO_APP_ID of studio). */
export function siteDemoAppID(): string {
  return readFileSync(join(env.secretsDir, "site-demo-app-id"), "utf8").trim();
}

export function studioClient(): StudioClient {
  return JSON.parse(readFileSync(join(env.secretsDir, "studio-client.json"), "utf8")) as StudioClient;
}
