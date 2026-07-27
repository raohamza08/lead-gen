import { createHmac, timingSafeEqual } from "crypto";

/**
 * Constant-time HMAC verification for webhook signatures (Part G1/I2 — webhook
 * endpoints are an internet-facing attack surface and must verify signatures,
 * not just accept payloads). Used for both ClickUp and a generic HMAC-signed
 * provider.
 *
 * NOTE: for exact byte-for-byte verification, wire a raw-body middleware
 * (e.g. `express.raw()` on this route) instead of re-stringifying the parsed
 * body — re-serialization can differ from what the provider actually signed
 * (key order, whitespace). Flagged here rather than silently "working" on
 * the happy path only.
 */
export function verifyHmacSignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
