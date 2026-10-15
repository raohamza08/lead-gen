-- CreateEnum
CREATE TYPE "UpworkProposalDraftFetchStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "upwork_proposal_writing_access" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "upwork_proposal_writing_settings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "agency_background" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL,
    "word_count_target" INTEGER NOT NULL DEFAULT 150,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_proposal_writing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upwork_proposal_drafts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "job_url" TEXT NOT NULL,
    "job_title" TEXT,
    "job_description" TEXT,
    "client_info" JSONB,
    "client_needs" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "cover_letter" TEXT NOT NULL,
    "fetch_status" "UpworkProposalDraftFetchStatus" NOT NULL DEFAULT 'SUCCESS',
    "fetch_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_proposal_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_proposal_writing_settings_org_id_key" ON "upwork_proposal_writing_settings"("org_id");

-- CreateIndex
CREATE INDEX "upwork_proposal_drafts_org_id_created_at_idx" ON "upwork_proposal_drafts"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "upwork_proposal_writing_settings" ADD CONSTRAINT "upwork_proposal_writing_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upwork_proposal_drafts" ADD CONSTRAINT "upwork_proposal_drafts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

