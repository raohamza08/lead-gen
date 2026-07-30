-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "lead_id" TEXT;

-- CreateIndex
CREATE INDEX "agent_runs_lead_id_started_at_idx" ON "agent_runs"("lead_id", "started_at");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
