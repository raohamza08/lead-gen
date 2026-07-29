import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Connect with bounded retries instead of letting a failure kill the process.
   *
   * `$connect()` throwing during onModuleInit aborts Nest's bootstrap and the
   * process exits. Against a hosted database that is the wrong behaviour: a
   * few seconds of pooler unavailability — which Supabase's transaction pooler
   * does exhibit under connection pressure — permanently took the whole API
   * down until someone noticed and restarted it by hand. Observed as
   * `P1001: Can't reach database server`.
   *
   * Retrying rides out the blip. If the database is genuinely gone the process
   * still exits after the last attempt, so a real misconfiguration still fails
   * loudly rather than serving a dead API.
   */
  async onModuleInit() {
    const maxAttempts = Number(process.env.DB_CONNECT_MAX_ATTEMPTS ?? 5);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.$connect();
        if (attempt > 1) this.logger.log(`Database connected on attempt ${attempt}`);
        return;
      } catch (err) {
        const message = (err as Error).message.split("\n")[0];

        if (attempt === maxAttempts) {
          this.logger.error(`Database unreachable after ${maxAttempts} attempts: ${message}`);
          throw err;
        }

        // 1s, 2s, 4s, 8s — capped so boot can never hang indefinitely.
        const backoffMs = Math.min(2 ** (attempt - 1) * 1000, 8000);
        this.logger.warn(
          `Database connect attempt ${attempt}/${maxAttempts} failed (${message}) — retrying in ${backoffMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
