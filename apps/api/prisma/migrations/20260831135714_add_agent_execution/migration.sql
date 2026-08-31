-- CreateEnum
CREATE TYPE "AgentExecutionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED_RETRY_SCHEDULED', 'FAILED_TERMINAL');

-- NOTE: prisma migrate diff also proposed dropping
-- inbound_email_messages_search_vector_idx and clearing search_vector's
-- DEFAULT. That's spurious drift, not part of this change — search_vector is
-- a hand-managed tsvector column (Unsupported("tsvector") in schema.prisma)
-- that Prisma's diff engine can't fully model, same trap documented for the
-- disabledAgents migration on 2026-07-29. Deliberately stripped here; do not
-- re-add without checking why the search index would actually need to change.

-- CreateTable
CREATE TABLE "agent_executions" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "execution_id" TEXT NOT NULL,
    "status" "AgentExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error_summary" TEXT,
    "error_detail" TEXT,
    "payload" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_retry_at" TIMESTAMP(3),

    CONSTRAINT "agent_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_executions_status_next_retry_at_idx" ON "agent_executions"("status", "next_retry_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_executions_lead_id_agent_key" ON "agent_executions"("lead_id", "agent");

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
