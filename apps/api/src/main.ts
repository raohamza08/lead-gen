import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

/**
 * Allowed browser origins.
 *
 * `APP_BASE_URL` accepts a comma-separated list so one deployment can serve
 * several front ends — a Vercel production domain, its per-branch preview
 * domains, and localhost during development — without reopening CORS to `*`.
 * Credentials are enabled, and `*` is not a legal origin alongside them, so an
 * explicit allowlist is required rather than merely preferable.
 */
function allowedOrigins(): string[] {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowed = allowedOrigins();

  app.enableCors({
    origin: (origin, callback) => {
      // A missing Origin header means a non-browser caller (health probe,
      // curl, the Python workers) — those aren't subject to CORS at all.
      if (!origin) return callback(null, true);
      if (allowed.includes(origin.replace(/\/$/, ""))) return callback(null, true);
      // Vercel mints a new hostname per preview deployment, so preview URLs
      // can't be enumerated ahead of time. Opt in by setting
      // VERCEL_PREVIEW_ORIGIN_SUFFIX to your team's own `.vercel.app` suffix;
      // left unset, previews are simply not allowed.
      const previewSuffix = process.env.VERCEL_PREVIEW_ORIGIN_SUFFIX;
      if (previewSuffix && origin.endsWith(previewSuffix)) return callback(null, true);
      return callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
    },
    credentials: true,
  });

  app.setGlobalPrefix("api/v1", { exclude: ["webhooks/(.*)", "track/(.*)", "unsubscribe"] });

  // Managed hosts (Render, Railway, Fly) inject the port to bind and route to
  // the container's external interface, so binding to 0.0.0.0 is required —
  // a default localhost bind would make the service unreachable and fail the
  // platform's health check.
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");

  // eslint-disable-next-line no-console
  console.log(`API listening on port ${port}; CORS origins: ${allowed.join(", ") || "(none)"}`);
}

bootstrap();
