import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { PrismaService } from "../../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";
import { UpworkWorkHistorySyncService } from "./work-history-sync.service";

@Injectable()
export class UpworkWorkHistorySyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpworkWorkHistorySyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: UpworkWorkHistorySyncService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.UPWORK_WORK_HISTORY_SYNC, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`upwork-work-history-sync tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const connections = await this.prisma.upworkApiConnection.findMany({ where: { status: "CONNECTED" } });
    for (const connection of connections) {
      try {
        await this.sync.syncConnection(connection);
      } catch (err) {
        this.logger.warn(`Work history sync failed for org ${connection.orgId}: ${(err as Error).message}`);
      }
    }
  }
}
