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
  EMAIL_SEND: "email-send",
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
} as const;
