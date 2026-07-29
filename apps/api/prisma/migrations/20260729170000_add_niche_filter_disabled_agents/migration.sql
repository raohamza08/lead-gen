-- DropIndex
DROP INDEX "lead_scores_lead_priority_score_idx";

-- DropIndex
DROP INDEX "leads_campaign_id_idx";

-- DropIndex
DROP INDEX "leads_org_company_name_key_idx";

-- DropIndex
DROP INDEX "leads_org_linkedin_slug_idx";

-- DropIndex
DROP INDEX "leads_org_linkedin_url_idx";

-- AlterTable
ALTER TABLE "niche_filters" ADD COLUMN     "disabled_agents" TEXT[] DEFAULT ARRAY[]::TEXT[];
