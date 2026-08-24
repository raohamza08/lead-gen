-- AlterTable
-- (Prisma's diff engine also proposed dropping and recreating the
-- search_vector GIN index here, misreading the generated tsvector column as
-- drift since it can't fully introspect a GENERATED ALWAYS AS ... STORED
-- expression — removed by hand; that index stays exactly as the previous
-- migration created it.)
ALTER TABLE "inbound_email_messages" ADD COLUMN "message_id_header" TEXT;

-- CreateIndex
CREATE INDEX "inbound_email_messages_account_id_message_id_header_idx" ON "inbound_email_messages"("account_id", "message_id_header");
