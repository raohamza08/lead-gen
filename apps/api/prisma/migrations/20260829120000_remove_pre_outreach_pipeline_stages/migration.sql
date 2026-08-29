-- Collapses NEW_LEAD/VERIFIED/RESEARCH_COMPLETED/UNDER_REVIEW into a single
-- entry stage (Part: pipeline simplification, 2026-08-29). No agent or
-- automation was ever gated on any of these four — the AI research pipeline
-- runs off lead creation regardless of stage, and autoAdvanceToOutreach
-- already walked every lead through all four the instant verifiedEmail was
-- true. The only real checkpoint (a verified email) now gates right at
-- READY_FOR_OUTREACH, via the new bulk "Verify emails" action there, instead
-- of four unearned rungs a lead had to be walked through first.
--
-- Data first, type second: any pipeline_states row still sitting in one of
-- the four removed stages moves to READY_FOR_OUTREACH (the new entry point)
-- before the enum type is swapped, since the USING cast below fails on a
-- value the new type doesn't contain. previous_stage is nulled rather than
-- remapped — "came from Ready" would be a fabricated history for a row that
-- actually came from NEW_LEAD/VERIFIED/etc.
UPDATE "pipeline_states"
SET "stage" = 'READY_FOR_OUTREACH'
WHERE "stage" IN ('NEW_LEAD', 'VERIFIED', 'RESEARCH_COMPLETED', 'UNDER_REVIEW');

UPDATE "pipeline_states"
SET "previous_stage" = NULL
WHERE "previous_stage" IN ('NEW_LEAD', 'VERIFIED', 'RESEARCH_COMPLETED', 'UNDER_REVIEW');

-- Postgres enums can't drop values in place — recreate the type, same
-- approach as 20260812120000_five_email_sequence.
ALTER TYPE "PipelineStage" RENAME TO "PipelineStage_old";

CREATE TYPE "PipelineStage" AS ENUM (
  'READY_FOR_OUTREACH',
  'EMAIL_1_SENT',
  'WAITING_EMAIL_2',
  'EMAIL_2_SENT',
  'WAITING_EMAIL_3',
  'EMAIL_3_SENT',
  'WAITING_EMAIL_4',
  'EMAIL_4_SENT',
  'WAITING_EMAIL_5',
  'EMAIL_5_SENT',
  'LINKEDIN_OUTREACH',
  'LINKEDIN_FOLLOW_UP',
  'REPLIED',
  'MEETING_BOOKED',
  'PROPOSAL_SENT',
  'NEGOTIATION',
  'WON',
  'CLIENT_ONBOARDING',
  'LOST'
);

ALTER TABLE "pipeline_states" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "pipeline_states" ALTER COLUMN "stage" TYPE "PipelineStage" USING ("stage"::text::"PipelineStage");
ALTER TABLE "pipeline_states" ALTER COLUMN "stage" SET DEFAULT 'READY_FOR_OUTREACH';

ALTER TABLE "pipeline_states" ALTER COLUMN "previous_stage" TYPE "PipelineStage" USING ("previous_stage"::text::"PipelineStage");

DROP TYPE "PipelineStage_old";
