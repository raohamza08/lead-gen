-- Restructures the outreach sequence from 3 emails (Email1/2 static
-- templates + Gemini-drafted Email3) to the 5-email sequence (Problem
-- Trigger / Industry Insight / Proof / Soft Offer / Breakup), all AI-drafted
-- via the Claude CLI (Part: 5-email sequence, 2026-08-12).
--
-- Postgres enums can't drop/rename values in place, so this recreates the
-- type. Written by hand (not `prisma migrate dev`, which refused to run
-- non-interactively for a change that removes enum values) after confirming
-- no live PipelineState row uses any of the four removed values — verified
-- against the production DB before writing this file.

ALTER TYPE "PipelineStage" RENAME TO "PipelineStage_old";

CREATE TYPE "PipelineStage" AS ENUM (
  'NEW_LEAD',
  'VERIFIED',
  'RESEARCH_COMPLETED',
  'UNDER_REVIEW',
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
ALTER TABLE "pipeline_states" ALTER COLUMN "stage" SET DEFAULT 'NEW_LEAD';

ALTER TABLE "pipeline_states" ALTER COLUMN "previous_stage" TYPE "PipelineStage" USING ("previous_stage"::text::"PipelineStage");

DROP TYPE "PipelineStage_old";
