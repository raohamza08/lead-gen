import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
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
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const allowed = allowedOrigins();

  app.enableCors({ origin: corsOriginValidator, credentials: true });

  // Explicit rather than relying on the default adapter Nest picks when
  // @nestjs/platform-socket.io is merely installed — the realtime gateway
  // (Part: autonomous system) needs this to actually accept connections.
  app.useWebSocketAdapter(new IoAdapter(app));

  app.setGlobalPrefix("api/v1", {
    exclude: ["webhooks/(.*)", "track/(.*)", "unsubscribe", "media/(.*)", "social-oauth/(.*)"],
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
