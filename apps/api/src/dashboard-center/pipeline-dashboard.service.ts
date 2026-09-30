import { Injectable } from "@nestjs/common";
import { PipelineStage } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { safeRate } from "./dashboard-center.util";

const STAGE_ORDER: PipelineStage[] = [
  "READY_FOR_OUTREACH", "EMAIL_1_SENT", "WAITING_EMAIL_2", "EMAIL_2_SENT", "WAITING_EMAIL_3",
  "EMAIL_3_SENT", "WAITING_EMAIL_4", "EMAIL_4_SENT", "WAITING_EMAIL_5", "EMAIL_5_SENT",
  "LINKEDIN_OUTREACH", "LINKEDIN_FOLLOW_UP", "REPLIED", "MEETING_BOOKED", "PROPOSAL_SENT",
  "NEGOTIATION", "WON", "CLIENT_ONBOARDING", "LOST",
];

const AGE_BUCKETS = [
  { label: "0-3 days", minDays: 0, maxDays: 3 },
  { label: "4-7 days", minDays: 4, maxDays: 7 },
  { label: "8-14 days", minDays: 8, maxDays: 14 },
  { label: "15-30 days", minDays: 15, maxDays: 30 },
  { label: "30+ days", minDays: 31, maxDays: Infinity },
];

@Injectable()
export class PipelineDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getFunnel(orgId: string) {
    const [stageRows, wonCount, lostCount, total] = await Promise.all([
      this.prisma.pipelineState.groupBy({ by: ["stage"], where: { lead: { orgId } }, _count: { _all: true } }),
      this.prisma.pipelineState.count({ where: { lead: { orgId }, stage: "WON" } }),
      this.prisma.pipelineState.count({ where: { lead: { orgId }, stage: "LOST" } }),
      this.prisma.pipelineState.count({ where: { lead: { orgId } } }),
    ]);
    const countByStage = new Map(stageRows.map((r) => [r.stage, r._count._all]));

    return {
      total,
      won: wonCount,
      lost: lostCount,
      conversionRate: safeRate(wonCount, total),
      stages: STAGE_ORDER.map((stage) => ({
        stage,
        count: countByStage.get(stage) ?? 0,
        percentage: safeRate(countByStage.get(stage) ?? 0, total),
      })),
    };
  }

  /** Average dwell time per stage, computed from LeadStageHistory rows
   *  written going forward from 2026-09-30 (Part: Dashboard Center) -- there
   *  is no way to recover dwell time for a transition that happened before
   *  this table existed, so `sampleSize` is returned alongside every stage
   *  so the UI can show "not enough historical data yet" honestly rather
   *  than a misleadingly confident average from one or two data points. */
  async getStageTiming(orgId: string) {
    const rows = await this.prisma.leadStageHistory.findMany({
      where: { orgId, fromStage: { not: null } },
      select: { fromStage: true, toStage: true, transitionedAt: true, leadId: true },
      orderBy: [{ leadId: "asc" }, { transitionedAt: "asc" }],
    });

    // Dwell time in fromStage = this transition's time minus the PREVIOUS
    // transition's time for the same lead (or, for a lead's first recorded
    // transition, we don't know when it entered fromStage, so it's skipped
    // -- a real gap this table's own docblock already documents.
    const lastSeenAt = new Map<string, Date>();
    const durationsByStage = new Map<PipelineStage, number[]>();
    for (const row of rows) {
      const prevAt = lastSeenAt.get(row.leadId);
      if (prevAt && row.fromStage) {
        const minutes = (row.transitionedAt.getTime() - prevAt.getTime()) / 60000;
        const bucket = durationsByStage.get(row.fromStage) ?? [];
        bucket.push(minutes);
        durationsByStage.set(row.fromStage, bucket);
      }
      lastSeenAt.set(row.leadId, row.transitionedAt);
    }

    return STAGE_ORDER.map((stage) => {
      const durations = durationsByStage.get(stage) ?? [];
      return {
        stage,
        sampleSize: durations.length,
        avgMinutesInStage: durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : undefined,
      };
    });
  }

  async getLeadAging(orgId: string) {
    const leads = await this.prisma.pipelineState.findMany({
      where: { lead: { orgId }, stage: { notIn: ["WON", "CLIENT_ONBOARDING", "LOST"] } },
      select: { enteredStageAt: true },
    });
    const now = Date.now();
    const buckets = AGE_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
    for (const lead of leads) {
      const days = (now - lead.enteredStageAt.getTime()) / 86400000;
      const idx = AGE_BUCKETS.findIndex((b) => days >= b.minDays && days <= b.maxDays);
      if (idx >= 0) buckets[idx].count += 1;
    }
    return buckets;
  }
}
