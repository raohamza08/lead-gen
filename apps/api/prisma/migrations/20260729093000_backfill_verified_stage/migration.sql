-- Move existing leads to the stage they actually reached.
--
-- Every lead in the table was persisted only after passing verification --
-- unverified candidates are rejected before any insert. Leaving them at
-- NEW_LEAD after VERIFIED was introduced would understate the funnel and force
-- a reviewer to click through two transitions that already happened.
--
-- VERIFIED, not RESEARCH_COMPLETED: these predate the research agent, so
-- claiming research completed would be false.

UPDATE "pipeline_states"
SET "stage" = 'VERIFIED', "entered_stage_at" = now()
WHERE "stage" = 'NEW_LEAD';
