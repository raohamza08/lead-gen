-- Leads produced per priority band, so the 40/40/20 mix can be checked after
-- the fact. A run that hit its total but produced only high-priority leads has
-- spent no exploration budget, and the targeting stops improving -- which is
-- invisible from the total count alone.
ALTER TABLE "extraction_runs" ADD COLUMN "priority_mix" JSONB NOT NULL DEFAULT '{}';
