-- CreateEnum
CREATE TYPE "MetaAdAccountStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'DISCONNECTED', 'ERROR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "meta_ads_access" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "meta_ad_accounts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT,
    "timezone_name" TEXT,
    "business_id" TEXT,
    "business_name" TEXT,
    "status" "MetaAdAccountStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "access_token_enc" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "connected_by_user_id" TEXT,
    "connected_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_sync_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_campaigns" (
    "id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "external_campaign_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "objective" TEXT,
    "daily_budget" DOUBLE PRECISION,
    "lifetime_budget" DOUBLE PRECISION,
    "buying_type" TEXT,
    "start_time" TIMESTAMP(3),
    "stop_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_ad_sets" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "external_ad_set_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "daily_budget" DOUBLE PRECISION,
    "lifetime_budget" DOUBLE PRECISION,
    "optimization_goal" TEXT,
    "billing_event" TEXT,
    "start_time" TIMESTAMP(3),
    "end_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ad_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_ads_entities" (
    "id" TEXT NOT NULL,
    "ad_set_id" TEXT NOT NULL,
    "external_ad_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "creative_id" TEXT,
    "thumbnail_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meta_ads_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_ad_insights_daily" (
    "id" TEXT NOT NULL,
    "ad_account_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "ad_set_id" TEXT,
    "ad_id" TEXT,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "frequency" DOUBLE PRECISION,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "link_clicks" INTEGER,
    "spend" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION,
    "cpc" DOUBLE PRECISION,
    "cpm" DOUBLE PRECISION,
    "video_views" INTEGER,
    "landing_page_views" INTEGER,
    "actions" JSONB,
    "action_values" JSONB,
    "cost_per_action_type" JSONB,
    "purchase_roas" JSONB,
    "currency" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ad_insights_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meta_ad_accounts_org_id_external_account_id_key" ON "meta_ad_accounts"("org_id", "external_account_id");

-- CreateIndex
CREATE INDEX "meta_campaigns_ad_account_id_idx" ON "meta_campaigns"("ad_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_campaigns_ad_account_id_external_campaign_id_key" ON "meta_campaigns"("ad_account_id", "external_campaign_id");

-- CreateIndex
CREATE INDEX "meta_ad_sets_campaign_id_idx" ON "meta_ad_sets"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_ad_sets_campaign_id_external_ad_set_id_key" ON "meta_ad_sets"("campaign_id", "external_ad_set_id");

-- CreateIndex
CREATE INDEX "meta_ads_entities_ad_set_id_idx" ON "meta_ads_entities"("ad_set_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_ads_entities_ad_set_id_external_ad_id_key" ON "meta_ads_entities"("ad_set_id", "external_ad_id");

-- CreateIndex
CREATE INDEX "meta_ad_insights_daily_ad_account_id_date_idx" ON "meta_ad_insights_daily"("ad_account_id", "date");

-- CreateIndex
CREATE INDEX "meta_ad_insights_daily_campaign_id_date_idx" ON "meta_ad_insights_daily"("campaign_id", "date");

-- CreateIndex
CREATE INDEX "meta_ad_insights_daily_ad_set_id_date_idx" ON "meta_ad_insights_daily"("ad_set_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meta_ad_insights_daily_ad_id_date_key" ON "meta_ad_insights_daily"("ad_id", "date");

-- AddForeignKey
ALTER TABLE "meta_ad_accounts" ADD CONSTRAINT "meta_ad_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_campaigns" ADD CONSTRAINT "meta_campaigns_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "meta_ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ad_sets" ADD CONSTRAINT "meta_ad_sets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "meta_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ads_entities" ADD CONSTRAINT "meta_ads_entities_ad_set_id_fkey" FOREIGN KEY ("ad_set_id") REFERENCES "meta_ad_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ad_insights_daily" ADD CONSTRAINT "meta_ad_insights_daily_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "meta_ad_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ad_insights_daily" ADD CONSTRAINT "meta_ad_insights_daily_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "meta_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ad_insights_daily" ADD CONSTRAINT "meta_ad_insights_daily_ad_set_id_fkey" FOREIGN KEY ("ad_set_id") REFERENCES "meta_ad_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meta_ad_insights_daily" ADD CONSTRAINT "meta_ad_insights_daily_ad_id_fkey" FOREIGN KEY ("ad_id") REFERENCES "meta_ads_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
