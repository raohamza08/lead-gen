import { BadRequestException, Body, Controller, Headers, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../common/prisma/prisma.service";
import { LeadsService } from "../leads/leads.service";
import { verifyHmacSignature } from "./signature.util";
import { PipelineStage } from "@leadgen/types";

// "new lead" and "under review" used to map to their own PipelineStage
// values; both were removed 2026-08-29 (no agent was ever gated on either),
// so a ClickUp card still carrying one of those old statuses now just goes
// unmapped below — a no-op, not an error.
const CLICKUP_TO_PIPELINE_STAGE: Record<string, PipelineStage> = {
  "ready for outreach": PipelineStage.READY_FOR_OUTREACH,
  "replied": PipelineStage.REPLIED,
  "meeting booked": PipelineStage.MEETING_BOOKED,
  "proposal sent": PipelineStage.PROPOSAL_SENT,
  "won": PipelineStage.WON,
  "lost": PipelineStage.LOST,
};

/**
 * Ingests ClickUp's `taskStatusUpdated` webhook (Part C5) — this is what lets
 * a reviewer drive automation just by dragging a card. Idempotency: ClickUp
 * can redeliver, so this always re-derives target state from the payload
 * rather than assuming "haven't seen this event before".
 */
@Controller("webhooks/clickup")
export class ClickupWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Headers("x-signature") signature: string, @Body() body: any) {
    const secret = this.config.get<string>("CLICKUP_WEBHOOK_SECRET");
    if (secret && !verifyHmacSignature(JSON.stringify(body), signature, secret)) {
      throw new BadRequestException("Invalid webhook signature");
    }

    if (body.event !== "taskStatusUpdated") {
      return { ignored: true };
    }

    const clickupTaskId: string = body.task_id;
    const newStatus: string = body.history_items?.[0]?.after?.status?.toLowerCase();
    const stage = newStatus ? CLICKUP_TO_PIPELINE_STAGE[newStatus] : undefined;
    if (!stage) return { ignored: true, reason: "unmapped status" };

    const sync = await this.prisma.clickupSync.findFirst({ where: { clickupTaskId }, include: { lead: true } });
    if (!sync) return { ignored: true, reason: "unknown task" };

    await this.leadsService.advanceStage(sync.lead.orgId, sync.leadId, stage);
    return { ok: true };
  }
}
