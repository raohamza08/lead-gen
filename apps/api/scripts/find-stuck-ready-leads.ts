/**
 * Read-only diagnostic — find leads stuck at READY_FOR_OUTREACH with a
 * failed email_draft AgentExecution, and show WHY (errorSummary/
 * errorDetail/status/attempt) so we know whether the failure is genuinely
 * structural (needs a human to fix underlying lead data) or something that
 * should have kept auto-retrying but didn't. Writes nothing.
 *
 *   npx ts-node --transpile-only apps/api/scripts/find-stuck-ready-leads.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const leads = await prisma.lead.findMany({
    where: { pipelineState: { stage: "READY_FOR_OUTREACH" } },
    select: {
      id: true,
      companyName: true,
      verifiedEmail: true,
      verifiedWebsite: true,
      email: true,
      pipelineState: { select: { stage: true, preparationStatus: true, enteredStageAt: true } },
    },
  });
  console.log(`${leads.length} lead(s) at READY_FOR_OUTREACH.`);

  for (const lead of leads) {
    const exec = await prisma.agentExecution.findUnique({
      where: { leadId_agent: { leadId: lead.id, agent: "email_draft" } },
    });
    const msg = await prisma.emailMessage.findFirst({
      where: { leadId: lead.id, sequenceStep: 1 },
      select: { status: true, failureReason: true, subject: true, bodyHtml: true },
    });
    console.log(
      `\nlead=${lead.id} "${lead.companyName}" preparationStatus=${lead.pipelineState?.preparationStatus} ` +
        `email=${lead.email ?? "null"} verifiedEmail=${lead.verifiedEmail}\n` +
        `  AgentExecution: status=${exec?.status ?? "none"} attempt=${exec?.attempt} nextRetryAt=${exec?.nextRetryAt}\n` +
        `    errorSummary=${exec?.errorSummary}\n` +
        `    errorDetail=${(exec?.errorDetail ?? "").slice(0, 300)}\n` +
        `  EmailMessage(step1): status=${msg?.status} failureReason=${msg?.failureReason} hasContent=${!!(msg?.subject || msg?.bodyHtml)}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
