/**
 * Read-only diagnostic — the pipeline board's "Next stage in: Xd Xh" countdown
 * only ever renders when PipelineState.nextActionAt is set, which only
 * happens once a lead has sent an email and entered the 3-business-day wait
 * before the next one (SequencerService.scheduleWait, called for
 * WAITING_EMAIL_2/3/4/5). This checks whether any lead is currently in that
 * state at all, to distinguish "the countdown is broken" from "no lead has
 * gotten far enough in the sequence yet for one to exist."
 *
 *   npx ts-node --transpile-only apps/api/scripts/check-countdown-state.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const byStage = await prisma.pipelineState.groupBy({
    by: ["stage"],
    _count: true,
  });
  console.log("Lead count by pipeline stage:");
  for (const row of byStage) console.log(`  ${row.stage}: ${row._count}`);

  const withCountdown = await prisma.pipelineState.findMany({
    where: { nextActionAt: { not: null } },
    select: { leadId: true, stage: true, nextActionAt: true, waitJobId: true },
  });
  console.log(`\n${withCountdown.length} PipelineState row(s) with a non-null nextActionAt:`);
  for (const row of withCountdown) {
    console.log(`  lead=${row.leadId} stage=${row.stage} nextActionAt=${row.nextActionAt?.toISOString()} waitJobId=${row.waitJobId}`);
  }

  const waitingStages = ["WAITING_EMAIL_2", "WAITING_EMAIL_3", "WAITING_EMAIL_4", "WAITING_EMAIL_5"];
  const inWaitingStage = await prisma.pipelineState.findMany({
    where: { stage: { in: waitingStages as any } },
    select: { leadId: true, stage: true, nextActionAt: true, waitJobId: true, enteredStageAt: true },
  });
  console.log(`\n${inWaitingStage.length} lead(s) in a WAITING_EMAIL_* stage:`);
  for (const row of inWaitingStage) {
    console.log(
      `  lead=${row.leadId} stage=${row.stage} enteredStageAt=${row.enteredStageAt.toISOString()} ` +
        `nextActionAt=${row.nextActionAt?.toISOString() ?? "NULL"} waitJobId=${row.waitJobId ?? "NULL"}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
