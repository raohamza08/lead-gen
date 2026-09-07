-- CreateTable
CREATE TABLE "social_account_analytics_snapshots" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "follower_count" INTEGER,
    "following_count" INTEGER,
    "posts_count" INTEGER,
    "reach" INTEGER,
    "impressions" INTEGER,
    "engagement_rate" DOUBLE PRECISION,
    "like_count" INTEGER,
    "comment_count" INTEGER,
    "share_count" INTEGER,
    "save_count" INTEGER,

    CONSTRAINT "social_account_analytics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_account_analytics_snapshots_account_id_captured_at_idx" ON "social_account_analytics_snapshots"("account_id", "captured_at");

-- AddForeignKey
ALTER TABLE "social_account_analytics_snapshots" ADD CONSTRAINT "social_account_analytics_snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
