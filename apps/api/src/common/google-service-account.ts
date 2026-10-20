/**
 * Decodes a Google service-account PEM private key stored as base64 in an
 * env var (Part: Website Analytics, 2026-10-20 — real bug, found live).
 *
 * The original convention here was the common one: store the PEM with its
 * real newlines replaced by literal "\n" (backslash-n), unescape with
 * `.replace(/\\n/g, "\n")` at read time. That works fine when a `.env` is
 * loaded directly by `dotenv` inside Node -- but this app's systemd units
 * use `EnvironmentFile=/opt/outly/app/.env` (see outly-api.service), which
 * means **systemd's own environment-file parser** populates `process.env`
 * before Node (and therefore `dotenv`) ever runs. Confirmed by reading the
 * live process's real environment via `/proc/<pid>/environ`: systemd
 * silently strips the backslash from every `\n`, leaving a bare `n` fused
 * into the base64 body (`KEY-----nMIIE...`) -- not a newline, not even a
 * recognizable separator, just silent corruption with no error at
 * startup. The failure only surfaced later, at first real use, as an
 * opaque OpenSSL `DECODER routines::unsupported` error.
 *
 * Base64 sidesteps this entirely: its alphabet (A-Za-z0-9+/=) has no
 * character that any shell, dotenv, or systemd env-file parser treats
 * specially, so there is nothing left for any layer to misinterpret.
 */
export function decodeServiceAccountKey(base64Value: string): string {
  return Buffer.from(base64Value, "base64").toString("utf8");
}
