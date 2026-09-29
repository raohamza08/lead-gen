-- CreateTable
CREATE TABLE "agent_optimization_cycles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metrics" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "previous_score" DOUBLE PRECISION,
    "verdict" TEXT,
    "changes_applied" JSONB NOT NULL DEFAULT '[]',
    "reverted" BOOLEAN NOT NULL DEFAULT false,
    "recommendations_raw" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "agent_optimization_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_optimization_cycles_org_id_run_at_idx" ON "agent_optimization_cycles"("org_id", "run_at");

-- AddForeignKey
ALTER TABLE "agent_optimization_cycles" ADD CONSTRAINT "agent_optimization_cycles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
