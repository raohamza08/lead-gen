-- DropForeignKey
ALTER TABLE "social_post_versions" DROP CONSTRAINT "social_post_versions_account_id_fkey";

-- AlterTable
ALTER TABLE "social_post_versions" ALTER COLUMN "account_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "social_post_versions" ADD CONSTRAINT "social_post_versions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
