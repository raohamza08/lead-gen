-- Campaign lifecycle (Part: proper Campaign system, 2026-11-05).
--
-- Hand-written, not `prisma migrate dev`-generated -- the shadow database
-- Prisma needs for diffing fails to replay cleanly past an older, unrelated
-- migration (20261030120000_linkedin_outreach_multi_account references a
-- table that no longer exists), so `migrate dev`'s diff step is unusable in
-- this project right now. This file is still applied the normal way via
-- `prisma migrate deploy`, which only replays pending migrations against the
-- real database and never touches a shadow DB.
--
-- Every new column is defaulted or nullable -- purely additive, safe to
-- apply ahead of the application code that reads/writes it.

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- AlterTable
ALTER TABLE "campaigns"
    ADD COLUMN "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN "daily_send_target" INTEGER NOT NULL DEFAULT 1000,
    ADD COLUMN "monthly_email_target" INTEGER NOT NULL DEFAULT 30000,
    ADD COLUMN "total_sent" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "started_at" TIMESTAMP(3),
    ADD COLUMN "completed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "campaigns_org_id_status_idx" ON "campaigns"("org_id", "status");
