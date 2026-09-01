-- NOTE: prisma migrate diff again proposed dropping
-- inbound_email_messages_search_vector_idx and clearing search_vector's
-- DEFAULT — same spurious drift stripped in every prior migration this
-- session (hand-managed tsvector column Prisma can't fully model). Not part
-- of this change; deliberately excluded.

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "verified_opened_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "hub_email_open_tracking" ADD COLUMN     "raw_open_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verified_opened_at" TIMESTAMP(3);

-- Backfill: apply the same 180s rule retroactively so existing "opened"
-- emails don't silently disappear from the Opened section the moment this
-- ships. A message with a real OPENED event at least 180s after its sentAt
-- becomes verified; one whose only OPENED event(s) were all earlier than
-- that stays unverified (it was always a false-positive-shaped signal,
-- this migration just stops trusting it).
UPDATE "email_messages" m
SET "verified_opened_at" = sub.first_valid_open
FROM (
  SELECT e."message_id", MIN(e."occurred_at") AS first_valid_open
  FROM "email_events" e
  JOIN "email_messages" mm ON mm."id" = e."message_id"
  WHERE e."event_type" = 'OPENED'
    AND mm."sent_at" IS NOT NULL
    AND e."occurred_at" >= mm."sent_at" + INTERVAL '180 seconds'
  GROUP BY e."message_id"
) sub
WHERE m."id" = sub."message_id";

UPDATE "hub_email_open_tracking"
SET "raw_open_count" = 1,
    "verified_opened_at" = "opened_at"
WHERE "opened_at" IS NOT NULL
  AND "opened_at" >= "sent_at" + INTERVAL '180 seconds';

UPDATE "hub_email_open_tracking"
SET "raw_open_count" = 1
WHERE "opened_at" IS NOT NULL
  AND "raw_open_count" = 0;
