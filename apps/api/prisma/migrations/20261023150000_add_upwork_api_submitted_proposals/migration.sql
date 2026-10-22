-- CreateTable
CREATE TABLE "upwork_api_submitted_proposals" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "job_reference" TEXT NOT NULL,
    "selected_contractor_id" TEXT NOT NULL,
    "upwork_proposal_id" TEXT,
    "status" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_api_submitted_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_api_submitted_proposals_org_id_job_reference_selec_key" ON "upwork_api_submitted_proposals"("org_id", "job_reference", "selected_contractor_id");

-- AddForeignKey
ALTER TABLE "upwork_api_submitted_proposals" ADD CONSTRAINT "upwork_api_submitted_proposals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
