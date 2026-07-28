-- Full lead-intelligence payload and the complete scoring rubric.
--
-- Every column is nullable or defaulted, so existing leads and scores stay
-- valid: an older lead simply has no research evidence and no sub-scores,
-- rather than becoming unreadable.

ALTER TABLE "leads"
  -- The contact's own LinkedIn, distinct from linkedin_url (the company page).
  ADD COLUMN "contact_linkedin_url"     TEXT,
  ADD COLUMN "estimated_revenue"        TEXT,
  ADD COLUMN "website_platform"         TEXT,
  ADD COLUMN "automation_tools"         JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "ai_usage"                 TEXT,
  ADD COLUMN "growth_signals"           JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "pain_points"              TEXT,
  ADD COLUMN "ai_opportunities"         TEXT,
  ADD COLUMN "automation_opportunities" TEXT,
  ADD COLUMN "research_evidence"        TEXT;

ALTER TABLE "lead_scores"
  ADD COLUMN "business_fit_score"           INTEGER,
  ADD COLUMN "buying_intent_score"          INTEGER,
  ADD COLUMN "budget_score"                 INTEGER,
  ADD COLUMN "technology_gap_score"         INTEGER,
  ADD COLUMN "decision_maker_access_score"  INTEGER,
  ADD COLUMN "lead_priority_score"          INTEGER;

-- The pipeline ranks by priority score, so make that ordering cheap.
CREATE INDEX "lead_scores_lead_priority_score_idx"
  ON "lead_scores"("lead_priority_score" DESC NULLS LAST);

-- Tier-2 duplicate detection matches on company name and LinkedIn URL, not
-- just domain and email. Without these the checks are sequential scans.
CREATE INDEX "leads_org_company_name_idx" ON "leads"("org_id", lower("company_name"));
CREATE INDEX "leads_org_linkedin_url_idx" ON "leads"("org_id", "linkedin_url");
