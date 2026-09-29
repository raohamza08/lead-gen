-- CreateEnum
CREATE TYPE "UpworkProposalType" AS ENUM ('BIDDING', 'INVITE');

-- CreateEnum
CREATE TYPE "UpworkAccountType" AS ENUM ('TRAINING', 'LIVE');

-- CreateEnum
CREATE TYPE "UpworkProposalStatus" AS ENUM ('SUBMITTED', 'IN_DISCUSSION', 'FOLLOW_UP_1', 'FOLLOW_UP_2', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "upwork_access" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "upwork_proposals" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "type" "UpworkProposalType" NOT NULL,
    "profile_name" TEXT NOT NULL,
    "job_category" TEXT NOT NULL,
    "job_link" TEXT NOT NULL,
    "cover_letter" TEXT NOT NULL,
    "connects" INTEGER,
    "account_type" "UpworkAccountType",
    "submitted_by" TEXT NOT NULL,
    "clickup_task_id" TEXT,
    "client_name" TEXT,
    "status" "UpworkProposalStatus" NOT NULL DEFAULT 'SUBMITTED',
    "closed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upwork_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upwork_proposals_org_id_type_idx" ON "upwork_proposals"("org_id", "type");

-- CreateIndex
CREATE INDEX "upwork_proposals_org_id_status_idx" ON "upwork_proposals"("org_id", "status");

-- CreateIndex
CREATE INDEX "upwork_proposals_org_id_created_at_idx" ON "upwork_proposals"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "upwork_proposals" ADD CONSTRAINT "upwork_proposals_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
