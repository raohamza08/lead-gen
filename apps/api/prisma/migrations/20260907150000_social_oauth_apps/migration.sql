-- CreateTable
CREATE TABLE "social_oauth_apps" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "name" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_enc" TEXT NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_oauth_apps_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "social_accounts" ADD COLUMN "oauth_app_id" TEXT;

-- AddForeignKey
ALTER TABLE "social_oauth_apps" ADD CONSTRAINT "social_oauth_apps_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_oauth_app_id_fkey" FOREIGN KEY ("oauth_app_id") REFERENCES "social_oauth_apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
