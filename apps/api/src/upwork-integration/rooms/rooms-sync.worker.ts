import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import { PrismaService } from "../../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";
import { UpworkRoomsSyncService } from "./rooms-sync.service";

/** Routes by job name (Part: two-tier sync, 2026-10-23) — "quick-tick"
 *  (every 15 min) runs the cheap recent-rooms-only pass, "full-tick"
 *  (every 6h) runs the complete walk + full-replace cleanup. See
 *  UpworkRoomsSyncQueue/UpworkRoomsSyncService for the full reasoning. */
@Injectable()
export class UpworkRoomsSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpworkRoomsSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: UpworkRoomsSyncService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.UPWORK_ROOMS_SYNC, (job) => this.tick(job), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`upwork-rooms-sync ${job?.name ?? "tick"} failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick(job: Job) {
    const full = job.name === "full-tick";
    const connections = await this.prisma.upworkApiConnection.findMany({ where: { status: "CONNECTED" } });
    for (const connection of connections) {
      try {
        if (full) {
          await this.sync.syncConnectionFull(connection);
        } else {
          await this.sync.syncConnectionQuick(connection);
        }
      } catch (err) {
        this.logger.warn(`Rooms ${job.name} failed for org ${connection.orgId}: ${(err as Error).message}`);
      }
    }
  }
}
