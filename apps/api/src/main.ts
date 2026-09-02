import "reflect-metadata";
import compression from "compression";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { AppModule } from "./app.module";
import { allowedOrigins, corsOriginValidator } from "./common/cors";

async function bootstrap() {
  // rawBody: true stashes the exact request bytes on req.rawBody for every
  // route (Nest's built-in mechanism, not a custom body-parser swap) while
  // req.body still parses as JSON as before -- needed for the Meta webhook
  // route's signature verification, which must hash the exact bytes Meta
  // signed, not a re-serialized JSON.stringify(body) that can differ in key
  // order/whitespace (see webhooks/signature.util.ts's own docblock on this).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // No response compression existed at all (Part: Email Hub reading-pane
  // performance, 2026-09-02) — confirmed live: a 7-message thread with
  // ~450KB of HTML per message (a real, legitimately large quoted-reply
  // chain, not a bug) served a 3.4MB uncompressed JSON response. The raw
  // DB query and NestJS response pipeline together took ~300ms measured
  // locally on the VPS — the actual slowness a user sees opening that
  // email is almost entirely the 3.4MB download itself. Email HTML is
  // highly repetitive text (the same CSS/tags/quoted-history over and
  // over), so gzip routinely cuts a payload like this by 80-90%; this is
  // a transparent, zero-risk win every JSON response gets, not just this
  // one endpoint.
  app.use(compression());

  // Default Express JSON limit (100kb) is well under a single email
  // attachment's base64 size (~33% larger than the raw file) — raised via
  // Nest's own useBodyParser (not a second app.use(json(...))) so the
  // rawBody-capturing verify callback set up above stays wired through.
  // Email Hub compose/reply attachments are capped at 15MB raw combined,
  // see EmailHubService.assertAttachmentsWithinLimit.
  app.useBodyParser("json", { limit: "21mb" });

  const allowed = allowedOrigins();

  app.enableCors({ origin: corsOriginValidator, credentials: true });

  // Explicit rather than relying on the default adapter Nest picks when
  // @nestjs/platform-socket.io is merely installed — the realtime gateway
  // (Part: autonomous system) needs this to actually accept connections.
  app.useWebSocketAdapter(new IoAdapter(app));

  app.setGlobalPrefix("api/v1", {
    // users/:id/avatar (AvatarFileController) is public-by-design, same
    // reasoning as media/(.*) below — a plain <img src> can't carry the
    // Bearer token the api/v1 prefix's routes otherwise require, and its
    // URL is built without the prefix (users.service.ts's avatarUrl),
    // matching how media's own public URL is built. Without this exclusion
    // that URL 404'd against the real (prefixed) route while every avatar
    // in the app silently failed to load.
    exclude: ["webhooks/(.*)", "track/(.*)", "unsubscribe", "media/(.*)", "social-oauth/(.*)", "users/:id/avatar"],
  });

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
