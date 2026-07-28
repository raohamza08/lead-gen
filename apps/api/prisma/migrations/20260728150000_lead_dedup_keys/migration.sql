-- Persisted normalised keys for tier-2 duplicate detection.
--
-- Normalising in application code and then querying the raw column matches
-- nothing that the raw column wouldn't already have matched, so the normalised
-- value has to live in the database to be useful.
--
-- Both are nullable: a lead with no LinkedIn URL simply has no slug, and NULL
-- never equals NULL in SQL, which is exactly the wanted behaviour — two leads
-- both missing a LinkedIn URL are not duplicates of each other.

ALTER TABLE "leads"
  ADD COLUMN "company_name_key" TEXT,
  ADD COLUMN "linkedin_slug"    TEXT;

-- Backfill existing rows. This mirrors normaliseCompanyName/normaliseLinkedin
-- in leads.service.ts: lower-case, drop punctuation and common legal suffixes,
-- collapse whitespace; strip scheme/host/trailing slash from LinkedIn URLs.
UPDATE "leads"
SET "company_name_key" = NULLIF(
      trim(regexp_replace(
        regexp_replace(
          regexp_replace(lower("company_name"), '[.,]', ' ', 'g'),
          '\y(ltd|limited|llc|inc|incorporated|corp|corporation|gmbh|bv|plc|pty|co)\y', ' ', 'g'
        ),
        '\s+', ' ', 'g'
      )), '')
WHERE "company_name" IS NOT NULL;

UPDATE "leads"
SET "linkedin_slug" = NULLIF(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower("linkedin_url"), '^https?://', ''),
          '^([a-z]{2,3}\.)?linkedin\.com/', ''
        ),
        '/+$', ''
      ), '')
WHERE "linkedin_url" IS NOT NULL;

-- Duplicate checks run on every single lead insert, so they must not be scans.
CREATE INDEX "leads_org_company_name_key_idx" ON "leads"("org_id", "company_name_key");
CREATE INDEX "leads_org_linkedin_slug_idx"    ON "leads"("org_id", "linkedin_slug");
