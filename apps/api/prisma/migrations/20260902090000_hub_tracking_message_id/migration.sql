-- AlterTable
ALTER TABLE "hub_email_open_tracking" ADD COLUMN     "message_id_header" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "hub_email_open_tracking_message_id_header_key" ON "hub_email_open_tracking"("message_id_header");
