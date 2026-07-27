-- Adds real-integration config columns that surfaced while wiring the
-- Sheets/ClickUp/Gmail/SMTP stubs to actual provider APIs:
--   * niche_filters.clickup_list_id — one ClickUp List per niche (Part C5)
--   * email_accounts.oauth_refresh_token / last_history_id — per-mailbox Gmail
--     OAuth credential + Gmail history API cursor (Part G1 / gmail webhook)
--   * email_accounts.smtp_* — per-mailbox SMTP AUTH credentials (MICROSOFT_365/SMTP)
-- Hand-written (not `prisma migrate diff`) because no shadow database is
-- available in this environment; validated with `prisma validate` against
-- the resulting schema instead. Same caveat as the initial migration: not
-- yet applied to a live database.

ALTER TABLE "niche_filters" ADD COLUMN "clickup_list_id" TEXT;

ALTER TABLE "email_accounts" ADD COLUMN "oauth_refresh_token" TEXT;
ALTER TABLE "email_accounts" ADD COLUMN "last_history_id" TEXT;
ALTER TABLE "email_accounts" ADD COLUMN "smtp_host" TEXT;
ALTER TABLE "email_accounts" ADD COLUMN "smtp_port" INTEGER;
ALTER TABLE "email_accounts" ADD COLUMN "smtp_username" TEXT;
ALTER TABLE "email_accounts" ADD COLUMN "smtp_password" TEXT;
