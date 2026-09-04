/**
 * One-time backfill for leads stuck at EMAIL_N_SENT with no wait timer ever
 * scheduled (Part: pipeline countdown fix, 2026-09-04) -- companion to the
 * leads.service.ts fix that wires SequencerService.onStageEntered into
 * receiveEmailDraft. That fix only takes effect for FUTURE drafts; it does
 * nothing for the ~150 leads that already reached EMAIL_1_SENT (or later)
 * under the old, broken code path and have sat there ever since with
 * PipelineState.nextActionAt/waitJobId both null.
 *
 * For each such lead, schedules the same delayed BullMQ job
 * SequencerService.scheduleWait would have -- except anchored at
 * enteredStageAt + 3 business days, not "3 business days from now": these
 * leads have often already sat stuck far longer than the intended wait, so
 * restarting a fresh 3-day countdown today would make them wait even
 * longer through no fault of the recipient. A lead whose 3-business-day
 * mark has already passed gets a ~0ms delay instead -- the existing live
 * SequencerService wait-timer worker (already running as part of the API
 * process) picks it up and advances the lead on its own, no separate
 * trigger needed.
 *
 *   npx ts-node --transpile-only apps/api/scripts/backfill-wait-timers.ts --dry-run
 *   npx ts-node --transpile-only apps/api/scripts/backfill-wait-timers.ts
 */
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

const WAIT_AFTER: Record<string, string> = {
  EMAIL_1_SENT: "WAITING_EMAIL_2",
  EMAIL_2_SENT: "WAITING_EMAIL_3",
  EMAIL_3_SENT: "WAITING_EMAIL_4",
  EMAIL_4_SENT: "WAITING_EMAIL_5",
};
const SEQUENCE_WAIT_BUSINESS_DAYS = 3;

/** Mirrors sequencer.service.ts's businessDaysDelayMs, but anchored at an
 *  arbitrary start date instead of always "now" -- see this file's
 *  docblock for why that matters here specifically. */
function businessDaysAfter(start: Date, days: number): Date {
  const d = new Date(start.getTime());
  let count = 0;
  while (count < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return d;
}

async function main() {
  // Module-level, not function-local (Part: pipeline countdown fix,
  // 2026-09-04) -- an open Redis connection keeps the event loop alive, so
  // an error thrown before reaching connection.quit() below used to leave
  // the process running forever instead of exiting on the catch handler's
  // error (confirmed live: this is exactly what made the pre-fix jobId bug
  // look like a silent hang rather than the immediate, loud rejection it
  // actually was). The explicit process.exit(1) in the catch handler below
  // is the real fix; closing the connection here is just cleanliness for
  // the success path.
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  const waitQueue = new Queue("wait-timers", { connection });

  const stuck = await prisma.pipelineState.findMany({
    where: {
      stage: { in: Object.keys(WAIT_AFTER) as any },
      nextActionAt: null,
      waitJobId: null,
    },
    select: { leadId: true, stage: true, enteredStageAt: true },
  });

  console.log(`Found ${stuck.length} lead(s) stuck at EMAIL_N_SENT with no wait timer ever scheduled.`);

  for (const state of stuck) {
    const nextStage = WAIT_AFTER[state.stage];
    const target = businessDaysAfter(state.enteredStageAt, SEQUENCE_WAIT_BUSINESS_DAYS);
    const delayMs = Math.max(0, target.getTime() - Date.now());

    console.log(
      `  lead=${state.leadId} stage=${state.stage} -> ${nextStage} ` +
        `enteredStageAt=${state.enteredStageAt.toISOString()} target=${target.toISOString()} delayMs=${delayMs}`,
    );

    if (DRY_RUN) continue;

    const job = await waitQueue.add(
      "advance",
      { leadId: state.leadId, nextStage },
      // `-`, not `:` -- see sequencer.service.ts's scheduleWait docblock for
      // why a colon-separated jobId with 4 parts throws every time.
      { delay: delayMs, jobId: `wait-${state.leadId}-${nextStage}-${Date.now()}` },
    );
    await prisma.pipelineState.update({
      where: { leadId: state.leadId },
      data: { waitJobId: job.id, nextActionAt: new Date(Date.now() + delayMs) },
    });
  }

  console.log(`\n${DRY_RUN ? "[dry run] Would schedule" : "Scheduled"} ${stuck.length} wait timer(s).`);
  await connection.quit();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
