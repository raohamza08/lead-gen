/**
 * Allowed browser origins, shared between the HTTP server (main.ts) and the
 * WebSocket gateway (realtime/realtime.gateway.ts) so the two never drift —
 * a socket connection rejected by a stricter policy than the REST API would
 * look like a random disconnect with no explanation in the browser console.
 *
 * `APP_BASE_URL` accepts a comma-separated list so one deployment can serve
 * several front ends — a Vercel production domain, its per-branch preview
 * domains, and localhost during development — without reopening CORS to `*`.
 * Credentials are enabled, and `*` is not a legal origin alongside them, so an
 * explicit allowlist is required rather than merely preferable.
 */
export function allowedOrigins(): string[] {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/** Shared validator for both Express's `cors()` and socket.io's gateway
 *  `cors.origin` option — both accept the same `(origin, callback)` shape. */
export function corsOriginValidator(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  // A missing Origin header means a non-browser caller (health probe, curl,
  // the Python workers) — those aren't subject to CORS at all.
  if (!origin) return callback(null, true);
  const allowed = allowedOrigins();
  if (allowed.includes(origin.replace(/\/$/, ""))) return callback(null, true);
  // Vercel mints a new hostname per preview deployment, so preview URLs can't
  // be enumerated ahead of time. Opt in by setting VERCEL_PREVIEW_ORIGIN_SUFFIX
  // to your team's own `.vercel.app` suffix; left unset, previews are simply
  // not allowed.
  const previewSuffix = process.env.VERCEL_PREVIEW_ORIGIN_SUFFIX;
  if (previewSuffix && origin.endsWith(previewSuffix)) return callback(null, true);
  return callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
}
