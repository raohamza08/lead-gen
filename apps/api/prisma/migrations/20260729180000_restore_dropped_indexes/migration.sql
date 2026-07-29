-- CreateIndex
CREATE INDEX "lead_scores_lead_priority_score_idx" ON "lead_scores"("lead_priority_score" DESC);

-- CreateIndex
CREATE INDEX "leads_campaign_id_idx" ON "leads"("campaign_id");

-- CreateIndex
CREATE INDEX "leads_org_company_name_key_idx" ON "leads"("org_id", "company_name_key");

-- CreateIndex
CREATE INDEX "leads_org_linkedin_slug_idx" ON "leads"("org_id", "linkedin_slug");

-- CreateIndex
CREATE INDEX "leads_org_linkedin_url_idx" ON "leads"("org_id", "linkedin_url");
