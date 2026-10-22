import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { PrismaService } from "../../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";
import { UpworkFreelancerProfilesSyncService } from "./freelancer-profiles-sync.service";

@Injectable()
export class UpworkFreelancerProfilesSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpworkFreelancerProfilesSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: UpworkFreelancerProfilesSyncService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.UPWORK_FREELANCER_PROFILES_SYNC, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`upwork-freelancer-profiles-sync tick failed: ${err.message}`);
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
        this.logger.warn(`Freelancer profiles sync failed for org ${connection.orgId}: ${(err as Error).message}`);
      }
    }
  }
}
