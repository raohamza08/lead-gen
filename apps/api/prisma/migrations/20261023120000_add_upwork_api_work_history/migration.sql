-- CreateTable
CREATE TABLE "upwork_api_work_history_entries" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "freelancer_user_id" TEXT NOT NULL,
    "freelancer_name" TEXT,
    "upwork_contract_id" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "total_charge" TEXT,
    "total_hours" TEXT,
    "feedback_to_freelancer_score" DOUBLE PRECISION,
    "feedback_to_client_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upwork_api_work_history_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_api_work_history_entries_org_id_upwork_contract_id_key" ON "upwork_api_work_history_entries"("org_id", "upwork_contract_id");

-- CreateIndex
CREATE INDEX "upwork_api_work_history_entries_org_id_freelancer_user_id_idx" ON "upwork_api_work_history_entries"("org_id", "freelancer_user_id");

-- AddForeignKey
ALTER TABLE "upwork_api_work_history_entries" ADD CONSTRAINT "upwork_api_work_history_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
