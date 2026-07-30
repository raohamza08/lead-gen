import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service";
import { InternalAuthGuard } from "../common/guards/internal-auth.guard";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtClaims } from "@leadgen/types";

interface AgentRunPayload {
  agent: string;
  status: string;
  durationMs: number;
  attempts?: number;
  error?: string;
  notes?: string[];
  leadId?: string;
}

@Controller("agent-runs")
export class AgentRunsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Batch ingestion from the Python workers.
   *
   * Batched rather than one request per agent because a single extraction run
   * produces seven records per candidate — at 100 leads/day that is 700 HTTP
   * round trips the workers would spend waiting on instead of finding leads.
   */
  @Post()
  @UseGuards(InternalAuthGuard)
  async record(
    @Body("orgId") orgId: string,
    @Body("runId") runId: string | undefined,
    @Body("records") records: AgentRunPayload[],
  ) {
    if (!orgId || !Array.isArray(records) || records.length === 0) {
      return { recorded: 0 };
    }

    const result = await this.prisma.agentRun.createMany({
      data: records.map((r) => ({
        orgId,
        runId,
        // Only set once a candidate survives long enough to become a lead —
        // the worker tags these after create_lead returns, so a rejected
        // candidate's records simply have none.
        leadId: r.leadId,
        agent: r.agent,
        status: r.status,
        durationMs: Math.max(0, Math.trunc(r.durationMs ?? 0)),
        attempts: Math.max(1, Math.trunc(r.attempts ?? 1)),
        // Truncated: an agent error can carry a full model response, and a
        // dashboard row does not need it.
        error: r.error?.slice(0, 2000),
        notes: (r.notes ?? []).slice(0, 20),
      })),
    });

    return { recorded: result.count };
  }

  /**
   * Fleet health for the Automation / AI Performance dashboards: per-agent
   * volume, failure rate and latency over a trailing window.
   */
  @Get("health")
  @UseGuards(JwtAuthGuard)
  async health(@CurrentUser() user: JwtClaims, @Query("hours") hours?: string) {
    const windowHours = Math.min(Math.max(Number(hours) || 24, 1), 24 * 30);
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const grouped = await this.prisma.agentRun.groupBy({
      by: ["agent", "status"],
      where: { orgId: user.orgId, startedAt: { gte: since } },
      _count: { _all: true },
      _avg: { durationMs: true },
      _sum: { durationMs: true },
    });

    // Rolled up per agent in TypeScript rather than SQL: the row count here is
    // agents x statuses (tens), so a second query would cost more than the loop.
    const byAgent = new Map<string, {
      agent: string; total: number; failed: number; degraded: number;
      avgDurationMs: number; totalDurationMs: number;
    }>();

    for (const row of grouped) {
      const entry = byAgent.get(row.agent) ?? {
        agent: row.agent, total: 0, failed: 0, degraded: 0,
        avgDurationMs: 0, totalDurationMs: 0,
      };
      const count = row._count._all;
      entry.total += count;
      if (row.status === "FAILED" || row.status === "FATAL") entry.failed += count;
      if (row.status === "DEGRADED") entry.degraded += count;
      entry.totalDurationMs += row._sum.durationMs ?? 0;
      byAgent.set(row.agent, entry);
    }

    const agents = [...byAgent.values()].map((a) => ({
      ...a,
      avgDurationMs: a.total ? Math.round(a.totalDurationMs / a.total) : 0,
      failureRate: a.total ? Math.round((a.failed / a.total) * 1000) / 10 : 0,
      degradedRate: a.total ? Math.round((a.degraded / a.total) * 1000) / 10 : 0,
    })).sort((x, y) => y.total - x.total);

    return {
      windowHours,
      totalRuns: agents.reduce((n, a) => n + a.total, 0),
      totalFailures: agents.reduce((n, a) => n + a.failed, 0),
      agents,
    };
  }

  /** Recent agent activity, newest first — the Automation dashboard's live feed. */
  @Get("recent")
  @UseGuards(JwtAuthGuard)
  recent(@CurrentUser() user: JwtClaims, @Query("limit") limit?: string) {
    return this.prisma.agentRun.findMany({
      where: { orgId: user.orgId },
      orderBy: { startedAt: "desc" },
      take: Math.min(Math.max(Number(limit) || 50, 1), 200),
    });
  }
}
