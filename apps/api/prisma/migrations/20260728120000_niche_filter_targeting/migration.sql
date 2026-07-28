-- Sales Navigator-style targeting filters on niche_filters.
--
-- Every array column defaults to '{}' and NOT NULL, so existing rows get an
-- empty array rather than NULL. Empty is read as "no constraint on this
-- dimension" throughout the codebase, which is what keeps already-configured
-- filters returning leads unchanged after this migration.

ALTER TABLE "niche_filters"
  ADD COLUMN "company_types"          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "growth_stages"          TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "company_keywords"       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "departments"            TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "seniority_levels"       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "years_in_business_min"  INTEGER,
  ADD COLUMN "years_in_business_max"  INTEGER,
  ADD COLUMN "hiring_signals"         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "website_conditions"     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "ai_opportunity_signals" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "exclusion_signals"      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "exclude_industries"     TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "exclude_keywords"       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "exclude_companies"      TEXT[] NOT NULL DEFAULT '{}';
