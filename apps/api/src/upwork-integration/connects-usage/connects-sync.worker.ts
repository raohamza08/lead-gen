import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { PrismaService } from "../../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../../common/queue/redis-connection";
import { UpworkConnectsSyncService } from "./connects-sync.service";

/** Consumes the repeatable "tick" job from UpworkConnectsSyncQueue -- one
 *  pass over every CONNECTED UpworkApiConnection, same "walk every due row
 *  sequentially, one failure doesn't block the rest" shape as
 *  MetaAdsSyncWorker. EXPIRED/DISCONNECTED/ERROR connections are skipped,
 *  not retried here -- a dead/revoked token needs a human to reconnect via
 *  Settings > Upwork API, not another sync attempt that will fail the same
 *  way every tick. */
@Injectable()
export class UpworkConnectsSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UpworkConnectsSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: UpworkConnectsSyncService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.UPWORK_CONNECTS_SYNC, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`upwork-connects-sync tick failed: ${err.message}`);
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
        // syncConnection already recorded the failure on the connection row
        // -- this catch exists only so one broken org never stops the rest
        // of the tick from running.
        this.logger.warn(`Connects sync failed for org ${connection.orgId}: ${(err as Error).message}`);
      }
    }
  }
}
