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
  /** Mailpit API (D-49). */
  mailpit: process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:8025",
  /** Studio redirect URI registered by the bootstrap. Nothing listens there: the test catches it. */
  redirectURI: process.env.E2E_REDIRECT_URI ?? "http://localhost:3000/api/auth/callback",
  /** Folder that scripts/stack-secrets.sh fills. */
  secretsDir: process.env.E2E_SECRETS_DIR ?? join(process.cwd(), ".stack"),
};

export type StudioClient = { project_id: string; app_id: string; client_id: string; client_secret: string };

export function adminPAT(): string {
  return readFileSync(join(env.secretsDir, "admin.pat"), "utf8").trim();
}

export function studioClient(): StudioClient {
  return JSON.parse(readFileSync(join(env.secretsDir, "studio-client.json"), "utf8")) as StudioClient;
}
