-- Part: Upwork proposal status pruning + fixed-price option, 2026-10-16
-- (explicit user request: "just keep these statuses only", and "add the
-- option to mark them as fixed projects").
--
-- Postgres can't DROP a value from an existing enum type in place, so the
-- status change is a type-swap: migrate every ACCEPTED row to IN_DISCUSSION
-- (closest surviving status) while the column is still the old type, build
-- the new enum (without ACCEPTED, with TEST_TASK/FOLLOW_UP_3 added),
-- repoint the column at it via a text cast, then drop the old type.

UPDATE "upwork_proposals" SET "status" = 'IN_DISCUSSION' WHERE "status" = 'ACCEPTED';

CREATE TYPE "UpworkProposalStatus_new" AS ENUM (
  'SUBMITTED', 'VIEWED', 'IN_DISCUSSION', 'TEST_TASK',
  'FOLLOW_UP_1', 'FOLLOW_UP_2', 'FOLLOW_UP_3', 'WON', 'LOST'
);

ALTER TABLE "upwork_proposals" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "upwork_proposals"
  ALTER COLUMN "status" TYPE "UpworkProposalStatus_new"
  USING ("status"::text::"UpworkProposalStatus_new");
ALTER TABLE "upwork_proposals" ALTER COLUMN "status" SET DEFAULT 'SUBMITTED';

DROP TYPE "UpworkProposalStatus";
ALTER TYPE "UpworkProposalStatus_new" RENAME TO "UpworkProposalStatus";

-- Hourly vs fixed-price (Part: Upwork Proposals fixed-price option, 2026-10-16).
CREATE TYPE "UpworkProjectPricingType" AS ENUM ('HOURLY', 'FIXED');

ALTER TABLE "upwork_proposals"
  ADD COLUMN "pricing_type" "UpworkProjectPricingType" NOT NULL DEFAULT 'HOURLY';
