-- Five pipeline stages the sales flow requires but the enum lacked.
--
-- Each new value is positioned relative to a value that ALREADY EXISTS, never
-- relative to another value added by this migration. Postgres will not let a
-- statement reference an enum label added earlier in the same transaction, and
-- Prisma runs migrations in one.
--
-- IF NOT EXISTS makes this re-runnable, which matters because a failed deploy
-- can leave some labels added and others not.

ALTER TYPE "PipelineStage" ADD VALUE IF NOT EXISTS 'VERIFIED' AFTER 'NEW_LEAD';
ALTER TYPE "PipelineStage" ADD VALUE IF NOT EXISTS 'RESEARCH_COMPLETED' BEFORE 'UNDER_REVIEW';
ALTER TYPE "PipelineStage" ADD VALUE IF NOT EXISTS 'LINKEDIN_FOLLOW_UP' AFTER 'LINKEDIN_OUTREACH';
ALTER TYPE "PipelineStage" ADD VALUE IF NOT EXISTS 'NEGOTIATION' AFTER 'PROPOSAL_SENT';
ALTER TYPE "PipelineStage" ADD VALUE IF NOT EXISTS 'CLIENT_ONBOARDING' AFTER 'WON';
