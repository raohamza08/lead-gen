-- CreateTable
CREATE TABLE "upwork_invite_proposal_drafts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_by_name" TEXT,
    "invite_text" TEXT NOT NULL,
    "client_name" TEXT,
    "client_needs" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "cover_letter" TEXT NOT NULL,
    "job_type" TEXT,
    "suggested_profile" TEXT,
    "profile_reason" TEXT,
    "overall_assessment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_invite_proposal_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upwork_invite_proposal_drafts_org_id_created_at_idx" ON "upwork_invite_proposal_drafts"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "upwork_invite_proposal_drafts" ADD CONSTRAINT "upwork_invite_proposal_drafts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
