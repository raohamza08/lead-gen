-- AlterTable
ALTER TABLE "upwork_proposal_drafts" ADD COLUMN     "is_long_term" BOOLEAN,
ADD COLUMN     "job_type" TEXT,
ADD COLUMN     "overall_assessment" TEXT,
ADD COLUMN     "posted_minutes_ago" INTEGER,
ADD COLUMN     "profile_reason" TEXT,
ADD COLUMN     "spend_tier" TEXT,
ADD COLUMN     "suggested_bid_amount" TEXT,
ADD COLUMN     "suggested_profile" TEXT,
ADD COLUMN     "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "upwork_proposal_writing_settings" DROP COLUMN "word_count_target",
ADD COLUMN     "excluded_countries" TEXT[] DEFAULT ARRAY['India', 'Pakistan', 'Philippines']::TEXT[],
ADD COLUMN     "non_technical_word_limit" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "technical_word_limit" INTEGER NOT NULL DEFAULT 400;

-- CreateTable
CREATE TABLE "upwork_freelancer_profiles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upwork_freelancer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upwork_freelancer_profiles_org_id_active_idx" ON "upwork_freelancer_profiles"("org_id", "active");

-- AddForeignKey
ALTER TABLE "upwork_freelancer_profiles" ADD CONSTRAINT "upwork_freelancer_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

