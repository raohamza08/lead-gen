-- Outputs of the Company Intelligence, Website Audit and Buyer Intelligence
-- agents.
--
-- Website findings live on the lead rather than only on the score because a
-- reviewer quotes them back to the prospect — they are evidence a salesperson
-- reads, not just inputs to a number.
--
-- Everything is nullable or defaulted, so leads created before these agents
-- existed stay valid rather than becoming unreadable.

ALTER TABLE "leads"
  ADD COLUMN "swot_analysis"   JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "competitors"     JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "recent_news"     JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "marketing_stack" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "ux_issues"       TEXT,
  ADD COLUMN "seo_issues"      TEXT,
  ADD COLUMN "buyer_persona"   TEXT;

ALTER TABLE "lead_scores"
  ADD COLUMN "digital_maturity_score"       INTEGER,
  ADD COLUMN "ai_readiness_score"           INTEGER,
  ADD COLUMN "automation_opportunity_score" INTEGER,
  ADD COLUMN "authority_score"              INTEGER,
  ADD COLUMN "engagement_score"             INTEGER,
  ADD COLUMN "project_complexity"           TEXT;
