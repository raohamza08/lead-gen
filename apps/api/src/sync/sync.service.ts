import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { PipelineStage } from "@leadgen/types";
import { getRedisConnection, QUEUE_NAMES } from "../common/queue/redis-connection";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";

/**
 * Thin dispatcher into the sheets-sync / clickup-sync queues (Part C4/C5).
 * Kept separate from the workers so LeadsService/SequencerService only ever
 * depend on "fire an event", never on Sheets/ClickUp SDK details directly.
 *
 * Also the single choke point for the "lead.created"/"lead.stageChanged"
 * realtime events (Part: autonomous system) — every lead-creation and
 * stage-transition site in the app already calls onLeadCreated/onStageChanged,
 * so emitting here gives every one of them a live dashboard update for free
 * instead of threading RealtimeGateway through each call site individually.
 */
@Injectable()
export class SyncService {
  private readonly sheetsQueue: Queue;
  private readonly clickupQueue: Queue;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {
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
    await this.emitLive(leadId, "lead.created", { leadId });
  }

  async onStageChanged(leadId: string, stage: PipelineStage) {
    await Promise.all([
      this.clickupQueue.add("update-status", { leadId, stage }),
      this.sheetsQueue.add("update-row", { leadId }),
    ]);
    await this.emitLive(leadId, "lead.stageChanged", { leadId, stage });
  }

  private async emitLive(leadId: string, event: string, payload: unknown) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { orgId: true } });
    if (lead) this.realtime.emitToOrg(lead.orgId, event, payload);
  }
}
