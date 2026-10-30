// Test host page: a customer site that embeds the real widgets (synthwerk-e2e#8, #9).
// It serves the widget bundles of a synthwerk-widgets build and one page per widget with
// the documented snippet. The page sends a strict CSP header, so the journeys prove the
// widgets run without 'unsafe-inline' or 'unsafe-eval' and reach only the edge.
//
//   GET /chat.html?app=<app id>&api=<edge URL>[&lang=de]
//   GET /vision.html?app=<app id>&api=<edge URL>[&lang=de]
//
// Playwright starts it (playwright.config.ts webServer). Chromium maps *.e2e.test to this
// server, so https://shop.e2e.test:<port> (the app origin) and https://other.e2e.test:<port>
// (an origin no app allows) are the same page on two origins. TLS: a self-signed
// certificate made at start with openssl and never stored in the repo; the browser context
// ignores certificate errors.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "../config/env.ts";

function certificate(): { key: Buffer; cert: Buffer } {
  const dir = mkdtempSync(join(tmpdir(), "e2e-host-"));
  try {
    execFileSync(
      "openssl",
      ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-days", "2"]
        .concat(["-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-subj", "/CN=shop.e2e.test"])
        .concat(["-addext", "subjectAltName=DNS:shop.e2e.test,DNS:other.e2e.test,IP:127.0.0.1"]),
      { stdio: "ignore" },
    );
    return { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WIDGETS: Record<string, { tag: string; file: string }> = {
  "/chat.html": { tag: "synthwerk-chat", file: "synthwerk-chat.js" },
  "/vision.html": { tag: "synthwerk-vision", file: "synthwerk-vision.js" },
};
const BUNDLES = new Set(Object.values(WIDGETS).map((w) => `/dist/${w.file}`));

const escape = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** Only an http(s) origin goes into the CSP and the snippet; anything else is refused. */
function origin(api: string | null): string | null {
  try {
    const u = new URL(api ?? "");
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

function page(tag: string, file: string, app: string, api: string, lang: string | null): string {
  const langAttr = lang ? ` lang="${escape(lang)}"` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${tag} host page</title>
  </head>
  <body>
    <main><h1>Host page</h1></main>
    <script type="module" src="/dist/${file}"></script>
    <${tag} app-id="${escape(app)}" api-url="${escape(api)}"${langAttr}></${tag}>
    <script type="module" src="/host.js"></script>
  </body>
</html>
`;
}

createServer(certificate(), async (req, res) => {
  const url = new URL(req.url ?? "/", "http://host.invalid");
  // The browser asks for an icon on its own. No icon: no 404 in the console.
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (url.pathname === "/host.js") {
    const body = await readFile(join(import.meta.dirname, "host.js"));
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }).end(body);
    return;
  }
  if (BUNDLES.has(url.pathname)) {
    try {
      const body = await readFile(join(env.widgetsDist, url.pathname.slice("/dist/".length)));
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" }).end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end(`no widget build in ${env.widgetsDist}`);
    }
    return;
  }
  const widget = WIDGETS[url.pathname];
  const app = url.searchParams.get("app");
  const api = origin(url.searchParams.get("api"));
  if (!widget || !app || !api) {
    res.writeHead(404).end();
    return;
  }
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    `connect-src ${api}`,
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  res
    .writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "cache-control": "no-store",
    })
    .end(page(widget.tag, widget.file, app, api, url.searchParams.get("lang")));
}).listen(env.hostPort, () => {
  console.log(`host page on ${env.hostOrigin} (widgets from ${env.widgetsDist})`);
});
