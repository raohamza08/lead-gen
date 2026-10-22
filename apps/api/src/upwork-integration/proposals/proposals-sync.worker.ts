import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { PrismaService } from "../../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";
import { UpworkProposalsSyncService } from "./proposals-sync.service";

/** Consumes the repeatable "tick" job from UpworkProposalsSyncQueue -- same
 *  "walk every CONNECTED connection sequentially, one failure doesn't block
 *  the rest" shape as UpworkConnectsSyncWorker/MetaAdsSyncWorker. */
@Injectable()
export class UpworkProposalsSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpworkProposalsSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: UpworkProposalsSyncService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.UPWORK_PROPOSALS_SYNC, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`upwork-proposals-sync tick failed: ${err.message}`);
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
        this.logger.warn(`Proposals sync failed for org ${connection.orgId}: ${(err as Error).message}`);
      }
    }
  }
}
