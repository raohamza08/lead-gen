import IORedis from "ioredis";

let connection: IORedis | null = null;

/** Shared IORedis connection for all BullMQ queues/workers (Part E5). */
export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null, // required by BullMQ workers
    });
  }
  return connection;
}

export const QUEUE_NAMES = {
  WAIT_TIMERS: "wait-timers",
  SHEETS_SYNC: "sheets-sync",
  CLICKUP_SYNC: "clickup-sync",
  // Every call out to the Python AI workers that used to be a raw fetch with
  // no retry (Part: autonomous system) — see agent-dispatch.worker.ts.
  AGENT_DISPATCH: "agent-dispatch",
  // Strictly one-at-a-time enrichment for a bulk CSV import (Part: lead
  // import) — separate from AGENT_DISPATCH (concurrency 5) because the user
  // explicitly wants imported leads processed one after another, not in a
  // burst. See import-enrichment.worker.ts.
  IMPORT_ENRICHMENT: "import-enrichment",
  // Polls every inboundSyncEnabled EmailAccount on a repeatable schedule
  // (Part: Email Hub) — see email-hub-sync.worker.ts.
  EMAIL_SYNC: "email-sync",
  // Polls due SCHEDULED SocialPosts on a repeatable schedule (Part: Social
  // Media Management) — see social-publish.worker.ts.
  SOCIAL_PUBLISH: "social-publish",
  // Reconciliation pass over every connected FB/IG account's conversations
  // (Part: Unified Social Media DM Monitoring) — the webhook is the primary
  // real-time path, this is the safety net for anything it missed. See
  // social-inbox-sync.worker.ts.
  SOCIAL_INBOX_SYNC: "social-inbox-sync",
  // Re-dispatches AgentExecution rows whose retry is due, and reclaims
  // RUNNING rows a crashed worker left stuck (Part: reliability overhaul,
  // 2026-08-31) — see agent-execution-sweep.worker.ts.
  AGENT_EXECUTION_SWEEP: "agent-execution-sweep",
  // Centralized dispatch queue for every send in the 5-email sequence (Part:
  // Preparation Pipeline / Sending Queue, 2026-09-01) — see sending.worker.ts.
  SENDING_QUEUE: "sending-queue",
  // Proactively refreshes any connected social account's access token before
  // it expires (Part: Connected Social Accounts token vault, 2026-09-07) —
  // see social-token-refresh.worker.ts. Separate queue from SOCIAL_PUBLISH
  // since this runs on its own, much longer cadence.
  SOCIAL_TOKEN_REFRESH: "social-token-refresh",
  // Periodic account-level analytics snapshot (Part: Social Hub Analytics,
  // 2026-09-07) -- see social-analytics-sync.worker.ts.
  SOCIAL_ANALYTICS_SYNC: "social-analytics-sync",
  // Reconciliation pass over every connected account's comments (Part:
  // Social Hub Engagement, 2026-09-07) -- see
  // social-engagement-sync.worker.ts. Poll-only in this version, same
  // reasoning SOCIAL_INBOX_SYNC's own docblock gives for DMs.
  SOCIAL_ENGAGEMENT_SYNC: "social-engagement-sync",
  // Re-dispatches RETRY_SCHEDULED messages whose retry is due, and reclaims
  // stale SENDING locks a crashed worker left stuck — same shape as
  // AGENT_EXECUTION_SWEEP. See sending-sweep.worker.ts.
  SENDING_SWEEP: "sending-sweep",
} as const;
