import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma, AgentExecutionStatus, NotificationCategory } from "@prisma/client";
import { PrismaService } from "../common/prisma/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { NotificationsService } from "../notifications/notifications.service";

/** A RUNNING row older than this is treated as abandoned (worker crashed
 *  mid-run) rather than a real lock — see AgentExecutionSweepWorker. */
export const STALE_RUNNING_MS = 10 * 60 * 1000;

/** Exponential from ~1 minute, capped at ~1 hour — matches the spec's
 *  "retry approximately every hour" together with "progressively increasing
 *  delays to avoid hammering an unavailable API". */
function backoffMs(attempt: number): number {
  const minutes = Math.min(60, 2 ** (attempt - 1));
  return minutes * 60 * 1000;
}

/** After this many failed attempts on the same (lead, agent), escalate to a
 *  human via NotificationsService — below that, the retry banner on the
 *  card is enough; not every transient blip needs a notification. */
const NOTIFY_AFTER_ATTEMPTS = 3;

/** Maps a raw exception/error string to the short, human-readable summary
 *  the spec wants on the lead card ("Claude limit reached", not a
 *  traceback). The full text is kept separately as errorDetail for logs. */
export function classifyError(agent: string, raw: string): string {
  const text = raw.toLowerCase();
  const model = agent === "email_draft" || agent === "linkedin_draft" ? "Gemini" : "Claude";
  if (text.includes("rate limit") || text.includes("429") || text.includes("quota")) {
    return `${model} limit reached`;
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return "API timeout";
  }
  if (text.includes("connection") || text.includes("network") || text.includes("econnrefused")) {
    return "API unavailable";
  }
  return "Agent execution failed";
}

export interface StartExecutionInput {
  orgId: string;
  leadId: string;
  agent: string;
  payload?: Record<string, unknown>;
}

export interface FailExecutionInput {
  leadId: string;
  agent: string;
  executionId: string;
  errorDetail: string;
  retryable: boolean;
  /** email_draft already has its own immediate notification via
   *  LeadsService.receiveEmailDraftFailure — skip the threshold-based one
   *  here so a single failure doesn't surface twice. */
  skipNotification?: boolean;
}

/**
 * Current retry/lock state for one (lead, agent) pair (Part: reliability
 * overhaul, 2026-08-31). Generalizes the pattern from commit ae6d24e (which
 * fixed exactly one silent-failure path, email drafting) to every agent kind
 * dispatched through AgentDispatchQueue — see AgentExecution's schema
 * docblock for why `agent` matches AgentDispatchJob["kind"].
 *
 * A lead only ever advances stage from an explicit success callback
 * (SequencerService.onStageEntered's callers, LeadsService.receiveEmailDraft,
 * etc.) — nothing here moves a lead forward. This service's only job is
 * making a failure visible (errorSummary/nextRetryAt on the card) and
 * retried automatically instead of silently permanent.
 */
@Injectable()
export class AgentExecutionService {
  private readonly logger = new Logger(AgentExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Acquires the (leadId, agent) lock and returns a fresh executionId. Races
   * are resolved at the database level: the unique constraint on
   * (leadId, agent) makes the fallback `updateMany` below an atomic
   * conditional acquire — two callers racing for the same row serialize on
   * Postgres's row lock, and only the one whose WHERE still matches after
   * the first commits gets count > 0.
   */
  async start(input: StartExecutionInput): Promise<{ executionId: string }> {
    const { orgId, leadId, agent, payload } = input;
    const executionId = randomUUID();
    const now = new Date();

    try {
      await this.prisma.agentExecution.create({
        data: {
          leadId,
          agent,
          executionId,
          status: AgentExecutionStatus.RUNNING,
          attempt: 1,
          startedAt: now,
          lastAttemptAt: now,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
        throw err;
      }
      const existing = await this.prisma.agentExecution.findUniqueOrThrow({
        where: { leadId_agent: { leadId, agent } },
      });
      const staleCutoff = new Date(now.getTime() - STALE_RUNNING_MS);
      const result = await this.prisma.agentExecution.updateMany({
        where: {
          leadId,
          agent,
          OR: [{ status: { not: AgentExecutionStatus.RUNNING } }, { lastAttemptAt: { lt: staleCutoff } }],
        },
        data: {
          executionId,
          status: AgentExecutionStatus.RUNNING,
          lastAttemptAt: now,
          nextRetryAt: null,
          attempt: existing.status === AgentExecutionStatus.SUCCEEDED ? 1 : existing.attempt + 1,
          payload: (payload ?? existing.payload ?? {}) as Prisma.InputJsonValue,
        },
      });
      if (result.count === 0) {
        throw new ConflictException(`${agent} is already running for lead ${leadId}`);
      }
    }

    this.emitUpdate(orgId, leadId, agent);
    return { executionId };
  }

  /** Ignores a report whose executionId no longer matches the current row —
   *  a late success/failure from an attempt already superseded by a newer
   *  retry must not overwrite that newer attempt's state. */
  async succeed(orgId: string, leadId: string, agent: string, executionId: string): Promise<{ updated: boolean }> {
    // Read first so a recovery (it had been failing) can be told apart from
    // a routine first-try success — notifying on every ordinary completion
    // would be noise (every lead runs several of these), but "it recovered
    // after retrying" is exactly the kind of thing Part 1 asks to surface.
    const existing = await this.prisma.agentExecution.findFirst({ where: { leadId, agent, executionId } });
    const wasRecovering = existing?.status === AgentExecutionStatus.FAILED_RETRY_SCHEDULED;

    const result = await this.prisma.agentExecution.updateMany({
      where: { leadId, agent, executionId },
      data: {
        status: AgentExecutionStatus.SUCCEEDED,
        lastAttemptAt: new Date(),
        nextRetryAt: null,
        errorSummary: null,
        errorDetail: null,
      },
    });
    if (result.count === 0) return { updated: false };
    this.emitUpdate(orgId, leadId, agent);

    if (wasRecovering) {
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { companyName: true } });
      await this.notifications.notify(orgId, {
        category: NotificationCategory.AGENTS,
        type: "AGENT_EXECUTION_RECOVERED",
        severity: "WARNING",
        title: "Agent Completed",
        message: `${agent} succeeded for ${lead?.companyName ?? leadId} after ${existing?.attempt ?? 1} attempt(s).`,
        leadId,
        entityType: "agentExecution",
        entityId: agent,
        actionUrl: `/leads/${leadId}`,
      });
    }
    return { updated: true };
  }

  async fail(orgId: string, input: FailExecutionInput): Promise<{ updated: boolean }> {
    const { leadId, agent, executionId, errorDetail, retryable, skipNotification } = input;
    const existing = await this.prisma.agentExecution.findUnique({ where: { leadId_agent: { leadId, agent } } });
    if (!existing || existing.executionId !== executionId) {
      this.logger.debug(`Ignoring stale failure report for ${agent} on lead ${leadId}`);
      return { updated: false };
    }

    const errorSummary = classifyError(agent, errorDetail);
    const status = retryable ? AgentExecutionStatus.FAILED_RETRY_SCHEDULED : AgentExecutionStatus.FAILED_TERMINAL;
    const nextRetryAt = retryable ? new Date(Date.now() + backoffMs(existing.attempt)) : null;

    await this.prisma.agentExecution.update({
      where: { leadId_agent: { leadId, agent } },
      data: {
        status,
        nextRetryAt,
        errorSummary,
        errorDetail: errorDetail.slice(0, 4000),
        lastAttemptAt: new Date(),
      },
    });
    this.emitUpdate(orgId, leadId, agent);

    if (!skipNotification) {
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { companyName: true } });
      const name = lead?.companyName ?? leadId;

      if (existing.attempt >= NOTIFY_AFTER_ATTEMPTS) {
        await this.notifications.notify(orgId, {
          category: NotificationCategory.AGENTS,
          type: "AGENT_EXECUTION_FAILED",
          severity: "ERROR",
          title: "Lead Automation Failed",
          message: `${agent} failed ${existing.attempt} times for ${name}: ${errorSummary}`,
          leadId,
          entityType: "agentExecution",
          entityId: agent,
          actionUrl: `/leads/${leadId}`,
        });
      } else if (retryable && existing.attempt === 1) {
        // One lightweight heads-up per failure episode, not one per hourly
        // retry tick — the lead card's own ErrorBanner already shows live
        // "Next retry: Xm" for every attempt; this is just the one-time
        // "something started failing" signal for the Notification Center.
        await this.notifications.notify(orgId, {
          category: NotificationCategory.AGENTS,
          type: "AGENT_RETRY_SCHEDULED",
          severity: "WARNING",
          title: "Agent Retry Scheduled",
          message: `${agent} failed for ${name} (${errorSummary}) — retrying automatically.`,
          leadId,
          entityType: "agentExecution",
          entityId: agent,
          actionUrl: `/leads/${leadId}`,
        });
      }
    }

    return { updated: true };
  }

  private emitUpdate(orgId: string, leadId: string, agent: string) {
    this.prisma.agentExecution
      .findUnique({ where: { leadId_agent: { leadId, agent } } })
      .then((row) => {
        if (!row) return;
        this.realtime.emitToOrg(orgId, "agentExecution.updated", {
          leadId,
          agent,
          status: row.status,
          attempt: row.attempt,
          errorSummary: row.errorSummary,
          lastAttemptAt: row.lastAttemptAt,
          nextRetryAt: row.nextRetryAt,
        });
      })
      .catch((err) => this.logger.warn(`could not emit agentExecution.updated: ${(err as Error).message}`));
  }
}
