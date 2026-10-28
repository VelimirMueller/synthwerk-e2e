import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(secret: string): Buffer {
  let bits = "";
  for (const ch of secret.replace(/[\s=]/g, "").toUpperCase()) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("secret is not base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

/** RFC 6238 code (SHA-1, 6 digits, 30 s), as authenticator apps make it. */
export function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const mac = createHmac("sha1", base32(secret)).update(counter).digest();
  const off = (mac[mac.length - 1] ?? 0) & 0x0f;
  const bin = (mac.readUInt32BE(off) & 0x7fffffff) % 1_000_000;
  return bin.toString().padStart(6, "0");
}
