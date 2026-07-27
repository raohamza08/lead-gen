import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { PipelineStage } from "@leadgen/types";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";

/**
 * Thin dispatcher into the sheets-sync / clickup-sync queues (Part C4/C5).
 * Kept separate from the workers so LeadsService/SequencerService only ever
 * depend on "fire an event", never on Sheets/ClickUp SDK details directly.
 */
@Injectable()
export class SyncService {
  private readonly sheetsQueue: Queue;
  private readonly clickupQueue: Queue;

  constructor() {
    const connection = getRedisConnection();
    this.sheetsQueue = new Queue(QUEUE_NAMES.SHEETS_SYNC, {
      connection,
      defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 2000 } },
    });
    this.clickupQueue = new Queue(QUEUE_NAMES.CLICKUP_SYNC, {
      connection,
      defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 2000 } },
    });
  }

  async onLeadCreated(leadId: string) {
    await Promise.all([
      this.sheetsQueue.add("append-row", { leadId }),
      this.clickupQueue.add("create-task", { leadId }),
    ]);
  }

  async onStageChanged(leadId: string, stage: PipelineStage) {
    await Promise.all([
      this.clickupQueue.add("update-status", { leadId, stage }),
      this.sheetsQueue.add("update-row", { leadId }),
    ]);
  }
}
