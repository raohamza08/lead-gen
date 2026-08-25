-- Prisma's diff engine repeatedly proposes dropping the hand-added
-- search_vector GIN index/generated-column default on every migration
-- (it can't fully introspect a GENERATED ALWAYS AS (...) STORED column) —
-- stripped here, same fix applied to every prior migration in this repo.

-- AlterTable
ALTER TABLE "email_accounts" ADD COLUMN     "sending_enabled" BOOLEAN NOT NULL DEFAULT false;

-- One-time backfill: preserve current real behavior for accounts that are
-- already ACTIVE and already have real, working send credentials configured
-- (GMAIL: an oauth refresh token; SMTP/MICROSOFT_365: username+password
-- both set) — so a mailbox that's genuinely been sending real campaign
-- emails doesn't go dark the moment this migration runs. Everything else
-- (including any mailbox added only for reading, or added before its send
-- credentials were filled in) defaults to sending_enabled = false and
-- needs an explicit opt-in from an admin going forward.
UPDATE "email_accounts"
SET "sending_enabled" = true
WHERE "status" = 'ACTIVE'
  AND (
    ("provider" = 'GMAIL' AND "oauth_refresh_token" IS NOT NULL)
    OR ("provider" != 'GMAIL' AND "smtp_username" IS NOT NULL AND "smtp_password" IS NOT NULL)
  );
