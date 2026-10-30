-- LinkedIn Outreach: move from one shared session per org to multiple named
-- accounts per org. The table pre-dates this migration (created via an
-- earlier `db push`, confirmed present in production with the exact
-- columns/constraints referenced below via `prisma db pull`), so this is a
-- straight rename + column add + unique-constraint drop, not a fresh CREATE.

ALTER TABLE "linkedin_outreach_sessions" RENAME TO "linkedin_outreach_accounts";

ALTER TABLE "linkedin_outreach_accounts" RENAME CONSTRAINT "linkedin_outreach_sessions_pkey" TO "linkedin_outreach_accounts_pkey";

ALTER TABLE "linkedin_outreach_accounts" DROP CONSTRAINT "linkedin_outreach_sessions_org_id_fkey";

DROP INDEX IF EXISTS "linkedin_outreach_sessions_org_id_key";

ALTER TABLE "linkedin_outreach_accounts" ADD COLUMN "label" TEXT NOT NULL DEFAULT 'Primary';

CREATE INDEX "linkedin_outreach_accounts_org_id_idx" ON "linkedin_outreach_accounts"("org_id");

ALTER TABLE "linkedin_outreach_accounts" ADD CONSTRAINT "linkedin_outreach_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
