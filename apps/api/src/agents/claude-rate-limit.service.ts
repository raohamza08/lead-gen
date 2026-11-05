import { Injectable } from "@nestjs/common";
import { getRedisConnection } from "../common/queue/redis-connection";

/** How long a detected rate-limit cools new dispatch down for (Part:
 *  Claude-budget-aware drip scheduler, 2026-11-05) -- long enough that a
 *  genuinely saturated Claude subscription window gets real breathing room
 *  instead of DraftSchedulerWorker immediately trying again next tick and
 *  burning another retry into the same wall; short enough that a transient
 *  blip doesn't stall the whole pipeline for hours. */
const COOLDOWN_SECONDS = 15 * 60;

function key(orgId: string): string {
  return `claude-rate-limit-cooldown:${orgId}`;
}

/**
 * A simple, Redis-backed circuit breaker between AgentExecutionService
 * (which already classifies a failure as rate-limit-shaped, see
 * classifyError) and DraftSchedulerWorker (which needs to know "don't
 * dispatch more right now" before every tick). Deliberately NOT in-process
 * state -- this API runs as one systemd service today, but Redis is the
 * same shared source of truth every other cross-cutting signal in this
 * codebase already uses, so it keeps working unchanged if that ever
 * changes. A TTL key, not a flag that needs explicit clearing: the cooldown
 * just expires on its own, no "resume" call to remember to make.
 */
@Injectable()
export class ClaudeRateLimitService {
  async markRateLimited(orgId: string): Promise<void> {
    await getRedisConnection().set(key(orgId), "1", "EX", COOLDOWN_SECONDS);
  }

  async isRateLimited(orgId: string): Promise<boolean> {
    return (await getRedisConnection().exists(key(orgId))) === 1;
  }
}
