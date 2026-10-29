import { request as httpRequest } from "node:http";

export type Reply = { status: number; body: string; location?: string; json<T = unknown>(): T };

/**
 * One HTTP call to a loopback URL with an explicit Host header. Node does not resolve
 * *.localhost everywhere (the Playwright container has no such rule), so calls go to
 * 127.0.0.1 and the edge routes by Host.
 */
export function call(
  url: string,
  opts: { method?: string; host?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method ?? "GET",
        headers: {
          ...(opts.host ? { Host: opts.host } : {}),
          // A fixed length, not chunked: CRS rule 920180 blocks a POST without it.
          ...(opts.body !== undefined ? { "Content-Length": String(Buffer.byteLength(opts.body)) } : {}),
          ...opts.headers,
        },
        timeout: 15_000,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: data,
            location: res.headers.location,
            json: <T>() => JSON.parse(data) as T,
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout: ${opts.method ?? "GET"} ${u.pathname}`)));
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
