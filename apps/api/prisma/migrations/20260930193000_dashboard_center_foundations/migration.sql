-- CreateTable
CREATE TABLE "lead_stage_history" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "from_stage" "PipelineStage",
    "to_stage" "PipelineStage" NOT NULL,
    "transitioned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_user_id" TEXT,

    CONSTRAINT "lead_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upwork_connect_purchases" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "purchased_at" TIMESTAMP(3) NOT NULL,
    "connects_amount" INTEGER NOT NULL,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "notes" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_connect_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benchmarks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "target_value" DOUBLE PRECISION NOT NULL,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_stage_history_lead_id_transitioned_at_idx" ON "lead_stage_history"("lead_id", "transitioned_at");

-- CreateIndex
CREATE INDEX "lead_stage_history_org_id_to_stage_transitioned_at_idx" ON "lead_stage_history"("org_id", "to_stage", "transitioned_at");

-- CreateIndex
CREATE INDEX "upwork_connect_purchases_org_id_purchased_at_idx" ON "upwork_connect_purchases"("org_id", "purchased_at");

-- CreateIndex
CREATE UNIQUE INDEX "benchmarks_org_id_metric_key_key" ON "benchmarks"("org_id", "metric_key");

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_history" ADD CONSTRAINT "lead_stage_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upwork_connect_purchases" ADD CONSTRAINT "upwork_connect_purchases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upwork_connect_purchases" ADD CONSTRAINT "upwork_connect_purchases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
