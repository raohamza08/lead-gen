-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'LEAD_REVIEWER', 'SALES_REP', 'VIEWER');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('NEW_LEAD', 'UNDER_REVIEW', 'READY_FOR_OUTREACH', 'EMAIL_1_SENT', 'WAITING_2_DAYS', 'EMAIL_2_SENT', 'WAITING_1_2_DAYS', 'GEMINI_DRAFTING', 'PERSONALIZED_PITCH', 'LINKEDIN_OUTREACH', 'REPLIED', 'MEETING_BOOKED', 'PROPOSAL_SENT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "UrgencyLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ExtractionRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'COMPLETED_SHORT_OF_TARGET', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailProvider" AS ENUM ('GMAIL', 'MICROSOFT_365', 'SMTP');

-- CreateEnum
CREATE TYPE "EmailAccountStatus" AS ENUM ('ACTIVE', 'PAUSED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "EmailMessageStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GeneratedBy" AS ENUM ('TEMPLATE', 'CLAUDE', 'GEMINI', 'HUMAN_EDIT');

-- CreateEnum
CREATE TYPE "EmailEventType" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED', 'SPAM_COMPLAINT', 'UNSUBSCRIBED', 'BLOCKED', 'FAILED');

-- CreateEnum
CREATE TYPE "LinkedinStatus" AS ENUM ('NOT_STARTED', 'CONNECTION_SENT', 'ACCEPTED', 'MESSAGE_SENT', 'REPLIED', 'MEETING_SCHEDULED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "niche_filters" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "sub_niche" TEXT,
    "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "company_size_min" INTEGER,
    "company_size_max" INTEGER,
    "revenue_band_min" TEXT,
    "revenue_band_max" TEXT,
    "employee_count_min" INTEGER,
    "employee_count_max" INTEGER,
    "jobTitles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "funding_stage" TEXT,
    "business_model" TEXT,
    "b2b_or_b2c" TEXT,
    "daily_target" INTEGER NOT NULL DEFAULT 100,
    "source_priority" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schedule_cron" TEXT NOT NULL DEFAULT '0 6 * * *',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "niche_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_runs" (
    "id" TEXT NOT NULL,
    "filter_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "leads_found" INTEGER NOT NULL DEFAULT 0,
    "leads_verified" INTEGER NOT NULL DEFAULT 0,
    "duplicates_skipped" INTEGER NOT NULL DEFAULT 0,
    "status" "ExtractionRunStatus" NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "run_id" TEXT,
    "filter_id" TEXT,
    "assigned_user_id" TEXT,
    "company_name" TEXT NOT NULL,
    "website" TEXT,
    "website_domain" TEXT,
    "linkedin_url" TEXT,
    "contact_name" TEXT,
    "job_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "industry" TEXT,
    "sub_niche" TEXT,
    "country" TEXT,
    "city" TEXT,
    "company_size" TEXT,
    "revenue_band" TEXT,
    "employee_count" INTEGER,
    "tech_stack" JSONB NOT NULL DEFAULT '[]',
    "business_model" TEXT,
    "b2b_or_b2c" TEXT,
    "business_description" TEXT,
    "current_crm" TEXT,
    "verified_email" BOOLEAN NOT NULL DEFAULT false,
    "verified_linkedin" BOOLEAN NOT NULL DEFAULT false,
    "verified_website" BOOLEAN NOT NULL DEFAULT false,
    "possible_duplicate" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMP(3),

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_scores" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "lead_score" INTEGER NOT NULL,
    "confidence_score" INTEGER NOT NULL,
    "ai_opportunity_score" INTEGER NOT NULL,
    "automation_score" INTEGER NOT NULL,
    "crm_readiness_score" INTEGER NOT NULL,
    "website_quality_score" INTEGER NOT NULL,
    "fit_reason" TEXT,
    "suggested_services" TEXT,
    "expected_value" DECIMAL(65,30),
    "priority" "Priority",
    "scored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_notes" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "reviewer_id" TEXT,
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
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_states" (
    "lead_id" TEXT NOT NULL,
    "stage" "PipelineStage" NOT NULL DEFAULT 'NEW_LEAD',
    "entered_stage_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_action_at" TIMESTAMP(3),
    "wait_job_id" TEXT,

    CONSTRAINT "pipeline_states_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "email_accounts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "provider" "EmailProvider" NOT NULL,
    "address" TEXT NOT NULL,
    "daily_limit" INTEGER NOT NULL DEFAULT 30,
    "hourly_limit" INTEGER NOT NULL DEFAULT 5,
    "warmup_active" BOOLEAN NOT NULL DEFAULT true,
    "status" "EmailAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "account_id" TEXT,
    "sequence_step" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "rationale" JSONB,
    "generated_by" "GeneratedBy" NOT NULL,
    "status" "EmailMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduled_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "event_type" "EmailEventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linkedin_activities" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "user_id" TEXT,
    "status" "LinkedinStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linkedin_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clickup_syncs" (
    "lead_id" TEXT NOT NULL,
    "clickup_task_id" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clickup_syncs_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "sheets_syncs" (
    "lead_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sheets_syncs_pkey" PRIMARY KEY ("lead_id")
);

-- CreateTable
CREATE TABLE "case_studies" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "case_studies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_entries" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "diff" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "leads_org_id_industry_idx" ON "leads"("org_id", "industry");

-- CreateIndex
CREATE INDEX "leads_org_id_created_at_idx" ON "leads"("org_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "leads_org_id_website_domain_key" ON "leads"("org_id", "website_domain");

-- CreateIndex
CREATE UNIQUE INDEX "leads_org_id_email_key" ON "leads"("org_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "lead_scores_lead_id_key" ON "lead_scores"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_notes_lead_id_key" ON "review_notes"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_address_key" ON "email_accounts"("address");

-- CreateIndex
CREATE INDEX "email_messages_lead_id_idx" ON "email_messages"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_entries_org_id_email_key" ON "suppression_entries"("org_id", "email");

-- CreateIndex
CREATE INDEX "audit_logs_lead_id_idx" ON "audit_logs"("lead_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "niche_filters" ADD CONSTRAINT "niche_filters_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_filter_id_fkey" FOREIGN KEY ("filter_id") REFERENCES "niche_filters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "extraction_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_filter_id_fkey" FOREIGN KEY ("filter_id") REFERENCES "niche_filters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_notes" ADD CONSTRAINT "review_notes_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_states" ADD CONSTRAINT "pipeline_states_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "email_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_activities" ADD CONSTRAINT "linkedin_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linkedin_activities" ADD CONSTRAINT "linkedin_activities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clickup_syncs" ADD CONSTRAINT "clickup_syncs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheets_syncs" ADD CONSTRAINT "sheets_syncs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_studies" ADD CONSTRAINT "case_studies_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppression_entries" ADD CONSTRAINT "suppression_entries_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

