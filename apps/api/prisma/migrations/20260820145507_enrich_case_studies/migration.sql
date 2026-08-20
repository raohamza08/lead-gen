/*
  Warnings:

  - Added the required column `rawStory` to the `case_studies` table without a default value. This is not possible if the table is not empty.
  - Added the required column `submitted_industry` to the `case_studies` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updated_at` to the `case_studies` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CaseStudyStatus" AS ENUM ('PENDING_REVIEW', 'READY', 'NEEDS_ATTENTION');

-- AlterTable
ALTER TABLE "case_studies" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "rawStory" TEXT NOT NULL,
ADD COLUMN     "review_notes" TEXT,
ADD COLUMN     "status" "CaseStudyStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
ADD COLUMN     "submitted_industry" TEXT NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "case_studies_org_id_industry_idx" ON "case_studies"("org_id", "industry");
