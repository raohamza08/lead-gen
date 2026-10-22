-- CreateTable
CREATE TABLE "upwork_api_proposals" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "upwork_proposal_id" TEXT NOT NULL,
    "freelancer_user_id" TEXT,
    "freelancer_name" TEXT,
    "job_id" TEXT,
    "job_title" TEXT,
    "charge_rate_raw" TEXT,
    "charge_rate_currency" TEXT,
    "charge_rate_display" TEXT,
    "upfront_payment_pct" DOUBLE PRECISION,
    "status" TEXT NOT NULL,
    "status_reason" TEXT,
    "viewed_by_client" BOOLEAN,
    "upwork_created_at" TIMESTAMP(3),
    "upwork_modified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upwork_api_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_api_proposals_org_id_upwork_proposal_id_key" ON "upwork_api_proposals"("org_id", "upwork_proposal_id");

-- CreateIndex
CREATE INDEX "upwork_api_proposals_org_id_status_idx" ON "upwork_api_proposals"("org_id", "status");

-- CreateIndex
CREATE INDEX "upwork_api_proposals_org_id_upwork_modified_at_idx" ON "upwork_api_proposals"("org_id", "upwork_modified_at");

-- AddForeignKey
ALTER TABLE "upwork_api_proposals" ADD CONSTRAINT "upwork_api_proposals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
