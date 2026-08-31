-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "track_email_open" BOOLEAN NOT NULL DEFAULT false;

-- NOTE: prisma migrate diff again proposed dropping
-- inbound_email_messages_search_vector_idx and clearing search_vector's
-- DEFAULT — same spurious drift stripped in 20260831135714_add_agent_execution
-- (hand-managed tsvector column Prisma can't fully model). Not part of this
-- change; deliberately excluded.

-- CreateTable
CREATE TABLE "hub_email_open_tracking" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMP(3),

    CONSTRAINT "hub_email_open_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hub_email_open_tracking_org_id_idx" ON "hub_email_open_tracking"("org_id");

-- AddForeignKey
ALTER TABLE "hub_email_open_tracking" ADD CONSTRAINT "hub_email_open_tracking_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
