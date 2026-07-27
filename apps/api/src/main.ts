import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.APP_BASE_URL ?? "http://localhost:3000", credentials: true });
  app.setGlobalPrefix("api/v1", { exclude: ["webhooks/(.*)", "track/(.*)", "unsubscribe"] });

  const port = process.env.API_PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
}

bootstrap();
