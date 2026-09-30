import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Worker } from "bullmq";
import { PrismaService } from "../common/prisma/prisma.service";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { MetaAdsSyncService } from "./meta-ads-sync.service";

/** Consumes the repeatable "tick" job from MetaAdsSyncQueue -- one pass over
 *  every CONNECTED Meta ad account, same "walk every due row sequentially,
 *  one failure doesn't block the rest" shape as SocialAnalyticsSyncWorker.
 *  EXPIRED accounts are skipped, not retried -- a dead token needs a human
 *  to reconnect, not another sync attempt that will fail the same way. */
@Injectable()
export class MetaAdsSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetaAdsSyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: MetaAdsSyncService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(QUEUE_NAMES.META_ADS_SYNC, () => this.tick(), {
      connection: getRedisConnection(),
      concurrency: 1,
    });
    this.worker.on("failed", (job, err) => {
      this.logger.error(`meta-ads-sync tick failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async tick() {
    const accounts = await this.prisma.metaAdAccount.findMany({ where: { status: "CONNECTED" } });
    for (const account of accounts) {
      try {
        await this.sync.syncAccount(account);
      } catch (err) {
        // syncAccount already recorded the failure on the account row --
        // this catch exists only so one broken account never stops the
        // rest of the tick from running.
        this.logger.warn(`Meta Ads sync failed for account ${account.id}: ${(err as Error).message}`);
      }
    }
  }
}
