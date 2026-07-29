-- Campaigns: the grouping that makes performance attributable.
--
-- Without it "best offer", "best sequence" and "best niche" are unanswerable —
-- every lead looks identical to analytics, and the learning loop has nothing to
-- compare against.

CREATE TABLE "campaigns" (
    "id"                TEXT NOT NULL,
    "org_id"            TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "niche"             TEXT NOT NULL,
    "country"           TEXT,
    "offer"             TEXT,
    "case_study"        TEXT,
    "goal"              TEXT,
    "target_leads"      INTEGER NOT NULL DEFAULT 100,
    "email_sequence"    JSONB NOT NULL DEFAULT '[]',
    "linkedin_sequence" JSONB NOT NULL DEFAULT '[]',
    "filter_id"         TEXT,
    "active"            BOOLEAN NOT NULL DEFAULT true,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaigns_org_id_active_idx" ON "campaigns"("org_id", "active");

-- Nullable: leads created before campaigns existed, and any created outside a
-- campaign, simply have none. A NOT NULL default would invent an attribution
-- that was never true.
ALTER TABLE "leads" ADD COLUMN "campaign_id" TEXT;
CREATE INDEX "leads_campaign_id_idx" ON "leads"("campaign_id");

ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_filter_id_fkey"
    FOREIGN KEY ("filter_id") REFERENCES "niche_filters"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey"
    FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
