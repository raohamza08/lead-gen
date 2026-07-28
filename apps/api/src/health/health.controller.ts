import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection } from "../common/queue/redis-connection";

/**
 * Unauthenticated liveness/readiness probe for the platform host (Render's
 * health check, uptime monitors).
 *
 * It reports degraded dependencies with HTTP 200 rather than failing the whole
 * probe: if Redis is down the queues stall, but the API can still serve reads,
 * and returning non-200 would make the host pull a still-useful instance out of
 * rotation. Only a process that can't answer at all is genuinely unhealthy.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    return {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: { database, redis },
    };
  }

  private async checkDatabase(): Promise<string> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "up";
    } catch (err) {
      return `down: ${(err as Error).message.slice(0, 200)}`;
    }
  }

  private async checkRedis(): Promise<string> {
    try {
      await getRedisConnection().ping();
      return "up";
    } catch (err) {
      return `down: ${(err as Error).message.slice(0, 200)}`;
    }
  }
}
