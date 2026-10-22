-- AlterTable
ALTER TABLE "users" ADD COLUMN     "upwork_agency_overview_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_organization_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_transactions_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_bidding_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_invites_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_contract_proposals_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_submit_proposal_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_work_history_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_freelancers_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_rooms_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_jobs_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_ontology_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_agency_connection_access" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: preserve today's real access exactly, so this migration changes
-- nothing visible until an admin deliberately narrows or grants a specific
-- page beyond what someone already has. Anyone who currently has the old
-- coarse upwork_api_access flag gets every new per-page flag set true
-- (matching "the whole group was visible to them before"); everyone else
-- stays false on all of them (matching "they couldn't see any of it
-- before"). Same reasoning as the Dashboard Center per-tab migration this
-- mirrors (20261021140000_dashboard_access_flags).
UPDATE "users" SET
  "upwork_agency_overview_access" = true,
  "upwork_agency_organization_access" = true,
  "upwork_agency_transactions_access" = true,
  "upwork_agency_bidding_access" = true,
  "upwork_agency_invites_access" = true,
  "upwork_agency_contract_proposals_access" = true,
  "upwork_agency_submit_proposal_access" = true,
  "upwork_agency_work_history_access" = true,
  "upwork_agency_freelancers_access" = true,
  "upwork_agency_rooms_access" = true,
  "upwork_agency_jobs_access" = true,
  "upwork_agency_ontology_access" = true,
  "upwork_agency_connection_access" = true
WHERE "upwork_api_access" = true;
