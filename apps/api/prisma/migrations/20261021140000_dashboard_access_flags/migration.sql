-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dashboard_overview_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_leads_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_email_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_inbox_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_social_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_upwork_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_meta_ads_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_website_analytics_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_pipeline_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_team_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_activity_access" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dashboard_benchmarks_access" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: preserve today's real Dashboard Center access exactly, so this
-- migration changes nothing visible until an admin deliberately grants a
-- tab to someone beyond their role's current reach. Mirrors
-- DashboardCenterTabs' FULL_ACCESS_ROLES / UPWORK_ONLY_ROLES that this
-- feature replaces.
UPDATE "users" SET
  "dashboard_overview_access" = true,
  "dashboard_leads_access" = true,
  "dashboard_email_access" = true,
  "dashboard_inbox_access" = true,
  "dashboard_social_access" = true,
  "dashboard_upwork_access" = true,
  "dashboard_meta_ads_access" = true,
  "dashboard_website_analytics_access" = true,
  "dashboard_pipeline_access" = true,
  "dashboard_team_access" = true,
  "dashboard_activity_access" = true,
  "dashboard_benchmarks_access" = true
WHERE "role" IN ('ADMIN', 'MANAGER');

UPDATE "users" SET "dashboard_upwork_access" = true
WHERE "role" = 'BUSINESS_DEVELOPER';
