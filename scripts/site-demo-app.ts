// Creates (or reuses) the demo app of the site demo (synthwerk#47) and writes its id to
// .stack/site-demo-app-id. The app is in the demo org (the site org) and allows the site
// origin, so studio can trade a widget token for the image demo (NUXT_SITE_DEMO_APP_ID).
// Local and ci stacks only. Needs .stack/ from scripts/stack-secrets.sh, and identity up with
// the studio project id as the token audience (README, Run locally).
//
// Usage: node scripts/site-demo-app.ts
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "../src/config/env.ts";
import { createWidgetApp } from "../src/identity/apps.ts";

const app = await createWidgetApp([new URL(env.siteURL).origin], env.identityAPI);
const file = join(env.secretsDir, "site-demo-app-id");
writeFileSync(file, `${app.id}\n`, { mode: 0o600 });
chmodSync(file, 0o600);
console.log(`Wrote ${file}: the demo app of the site demo allows ${app.origins.join(", ")}.`);
