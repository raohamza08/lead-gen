-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('EMAIL', 'LEADS', 'AGENTS', 'AUTOMATIONS', 'SYSTEM', 'ERRORS', 'SECURITY', 'OTHER');

-- NOTE: prisma migrate diff also proposed dropping
-- inbound_email_messages_search_vector_idx and clearing search_vector's
-- DEFAULT — same spurious drift stripped in the two prior migrations this
-- session (hand-managed tsvector column Prisma can't fully model). Not part
-- of this change; deliberately excluded.

-- AlterTable: add the new columns first, `read` stays for now so the
-- backfill below can still read it before it's dropped.
ALTER TABLE "notifications"
  ADD COLUMN "category" "NotificationCategory" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "entity_type" TEXT,
  ADD COLUMN "entity_id" TEXT,
  ADD COLUMN "action_url" TEXT;

-- CreateTable
CREATE TABLE "notification_user_states" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),

    CONSTRAINT "notification_user_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_user_states_user_id_idx" ON "notification_user_states"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_user_states_notification_id_user_id_key" ON "notification_user_states"("notification_id", "user_id");

-- AddForeignKey
ALTER TABLE "notification_user_states" ADD CONSTRAINT "notification_user_states_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_user_states" ADD CONSTRAINT "notification_user_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data migration: the old `read` boolean was org-wide (one shared flag for
-- every user), so there is no correct per-user backfill — but leaving every
-- previously-read notification looking "unread" for every user would flood
-- everyone's bell with old notifications the first time this ships. Best
-- available approximation: a notification that was already marked read is
-- backfilled as read, at the same timestamp it was created, for every user
-- in its org. A notification left unread stays unread for everyone (no row
-- needed — absence of a NotificationUserState row already means unread).
INSERT INTO "notification_user_states" ("id", "notification_id", "user_id", "read_at")
SELECT gen_random_uuid(), n."id", u."id", n."created_at"
FROM "notifications" n
JOIN "users" u ON u."org_id" = n."org_id"
WHERE n."read" = true;

-- DropIndex
DROP INDEX "notifications_org_id_read_created_at_idx";

-- CreateIndex
CREATE INDEX "notifications_org_id_category_created_at_idx" ON "notifications"("org_id", "category", "created_at");

-- AlterTable: drop the now-superseded shared read flag.
ALTER TABLE "notifications" DROP COLUMN "read";
