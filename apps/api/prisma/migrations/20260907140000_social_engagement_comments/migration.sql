-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('NEW', 'RESPONDED', 'IGNORED');

-- CreateTable
CREATE TABLE "social_comments" (
    "id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "external_post_id" TEXT NOT NULL,
    "external_comment_id" TEXT NOT NULL,
    "parent_comment_id" TEXT,
    "author_external_id" TEXT,
    "author_name" TEXT,
    "author_profile_image_url" TEXT,
    "text" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL,
    "from_us" BOOLEAN NOT NULL DEFAULT false,
    "status" "EngagementStatus" NOT NULL DEFAULT 'NEW',
    "assigned_to_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_comments_social_account_id_posted_at_idx" ON "social_comments"("social_account_id", "posted_at");

-- CreateIndex
CREATE INDEX "social_comments_status_idx" ON "social_comments"("status");

-- CreateIndex
CREATE INDEX "social_comments_assigned_to_user_id_idx" ON "social_comments"("assigned_to_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_comments_social_account_id_external_comment_id_key" ON "social_comments"("social_account_id", "external_comment_id");

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_comments" ADD CONSTRAINT "social_comments_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
