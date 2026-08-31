-- NOTE: prisma migrate diff again proposed dropping
-- inbound_email_messages_search_vector_idx and clearing search_vector's
-- DEFAULT — same spurious drift stripped in the prior migrations this
-- session (hand-managed tsvector column Prisma can't fully model). Not part
-- of this change; deliberately excluded.

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "entity_id" TEXT,
ADD COLUMN     "entity_type" TEXT,
ADD COLUMN     "ip_address" TEXT,
ADD COLUMN     "metadata" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "org_id" TEXT,
ADD COLUMN     "result" TEXT NOT NULL DEFAULT 'SUCCESS';

-- Backfill: existing rows predate orgId, but it's derivable from the actor
-- (every existing row was written by the audit-log interceptor, which
-- always had an authenticated actor for a lead mutation) or, failing that,
-- from the lead itself.
UPDATE "audit_logs" al SET "org_id" = u."org_id"
FROM "users" u WHERE al."actor_id" = u."id" AND al."org_id" IS NULL;

UPDATE "audit_logs" al SET "org_id" = l."org_id"
FROM "leads" l WHERE al."lead_id" = l."id" AND al."org_id" IS NULL;

-- CreateIndex
CREATE INDEX "audit_logs_org_id_created_at_idx" ON "audit_logs"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
