-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'UPWORK';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "recipient_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "upwork_proposals" ADD COLUMN "accepted_at" TIMESTAMP(3),
ADD COLUMN "notify_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "last_follow_up_notified_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "upwork_proposals_org_id_status_accepted_at_idx" ON "upwork_proposals"("org_id", "status", "accepted_at");
