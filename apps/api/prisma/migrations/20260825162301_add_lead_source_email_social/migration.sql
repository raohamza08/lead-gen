-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadSourceLayer" ADD VALUE 'EMAIL';
ALTER TYPE "LeadSourceLayer" ADD VALUE 'SOCIAL_MEDIA';

-- CreateIndex
CREATE INDEX "inbound_email_messages_account_id_suggested_category_idx" ON "inbound_email_messages"("account_id", "suggested_category");
