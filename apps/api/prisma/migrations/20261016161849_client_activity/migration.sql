-- AlterTable
ALTER TABLE "upwork_discovered_jobs" ADD COLUMN     "client_activity" TEXT;

-- AlterTable
ALTER TABLE "upwork_proposal_drafts" ADD COLUMN     "client_activity" TEXT,
ADD COLUMN     "months_since_joined" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "upwork_proposal_writing_settings" ADD COLUMN     "min_hires_per_year" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "new_client_window_months" INTEGER NOT NULL DEFAULT 3;

