import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { getRedisConnection, QUEUE_NAMES } from "./redis-connection";

export interface ImportEnrichmentJob {
  leadId: string;
  orgId: string;
}

/**
 * A separate, concurrency-1 queue for enrichment triggered by a bulk CSV
 * import (Part: lead import) — deliberately not the shared AgentDispatchQueue
 * (concurrency 5). A large import dispatching several leads at once still
 * bursts the Claude CLI's own concurrency limit and floods the AI workers
 * all at once; this processes imported leads strictly one at a time instead,
 * at the user's explicit request. See import-enrichment.worker.ts for how
 * "one at a time" is actually enforced (it's not just a delay).
 */
@Injectable()
export class ImportEnrichmentQueue {
  private readonly queue = new Queue<ImportEnrichmentJob>(QUEUE_NAMES.IMPORT_ENRICHMENT, {
    connection: getRedisConnection(),
    // No retries here — the underlying dispatch to the AI workers already
    // retries via AgentDispatchQueue; retrying this outer job too would just
    // restart the wait loop needlessly.
    defaultJobOptions: { attempts: 1 },
  });

  add(job: ImportEnrichmentJob) {
    return this.queue.add("enrich", job);
  }
}
