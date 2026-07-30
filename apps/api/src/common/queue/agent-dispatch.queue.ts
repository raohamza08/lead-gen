import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "./redis-connection";

/**
 * Every call out to the Python AI workers used to be a bare `fetch()` —
 * dispatchEnrichment, dispatchGeminiDraft, requestLinkedinDraft, niche-filter
 * run-now — each with its own try/catch that logged and gave up on the first
 * network blip. Routing them all through one retried BullMQ queue means a
 * transient failure (the workers restarting, a brief network hiccup) no
 * longer silently strands a lead; see agent-dispatch.worker.ts for the retry
 * policy and AgentDispatchWorker.onFailed for what happens once retries are
 * exhausted.
 */
export type AgentDispatchJob =
  | { kind: "enrich"; leadId: string; orgId: string }
  | { kind: "pitch_draft"; leadId: string; orgId: string; orgContext?: Record<string, unknown> }
  | { kind: "linkedin_draft"; leadId: string; orgId: string }
  | {
      kind: "extraction_run";
      runId: string;
      orgId: string;
      filter: Record<string, unknown>;
      searchBrief?: string;
    };

@Injectable()
export class AgentDispatchQueue {
  private readonly queue = new Queue<AgentDispatchJob>(QUEUE_NAMES.AGENT_DISPATCH, {
    connection: getRedisConnection(),
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
  });

  add(job: AgentDispatchJob) {
    return this.queue.add(job.kind, job);
  }
}
