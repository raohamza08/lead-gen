/** The API's own public root — where things like the email open-tracking pixel
 *  and social media public asset URLs resolve back to. Distinct from
 *  APP_BASE_URL (the dashboard's origin, used for CORS/browser redirects):
 *  those must hit this NestJS process, not the Next.js frontend. Falls back
 *  to localhost for dev, where such links simply won't resolve externally —
 *  acceptable since nothing external needs to reach them in dev. */
export function apiPublicUrl(): string {
  return (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT ?? process.env.API_PORT ?? 4000}`).replace(/\/$/, "");
}
