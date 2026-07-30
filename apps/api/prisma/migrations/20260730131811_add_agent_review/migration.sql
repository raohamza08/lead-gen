-- CreateTable
CREATE TABLE "agent_reviews" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "website_issues" TEXT,
    "business_problems" TEXT,
    "opportunities" TEXT,
    "automation_opportunities" TEXT,
    "crm_issues" TEXT,
    "sales_issues" TEXT,
    "marketing_issues" TEXT,
    "operational_issues" TEXT,
    "suggested_service" TEXT,
    "suggested_offer" TEXT,
    "suggested_case_study" TEXT,
    "suggested_hook" TEXT,
    "pain_points" TEXT,
    "urgency_level" "UrgencyLevel",
    "expected_value" DECIMAL(65,30),
    "notes" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_reviews_lead_id_key" ON "agent_reviews"("lead_id");

-- AddForeignKey
ALTER TABLE "agent_reviews" ADD CONSTRAINT "agent_reviews_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
