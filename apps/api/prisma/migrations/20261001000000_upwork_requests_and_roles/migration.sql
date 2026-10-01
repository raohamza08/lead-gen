-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PROJECT_MANAGER';
ALTER TYPE "Role" ADD VALUE 'BUSINESS_DEVELOPER';
ALTER TYPE "Role" ADD VALUE 'EMAIL_REVIEWER';
ALTER TYPE "Role" ADD VALUE 'ADS_MANAGER';
ALTER TYPE "Role" ADD VALUE 'LEAD_GEN_MANAGER';

-- CreateEnum
CREATE TYPE "UpworkRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED');

-- AlterTable
ALTER TABLE "upwork_proposals" ADD COLUMN     "onboarded_at" TIMESTAMP(3),
ADD COLUMN     "project_hours" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "upwork_requests" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "project_manager_id" TEXT NOT NULL,
    "request_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "UpworkRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "total_requested_hours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewed_by_user_id" TEXT,
    "review_notes" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upwork_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upwork_request_items" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL,
    "requested_hours" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "upwork_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upwork_profile_access" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "profile_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_profile_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upwork_requests_org_id_status_idx" ON "upwork_requests"("org_id", "status");

-- CreateIndex
CREATE INDEX "upwork_requests_org_id_project_manager_id_idx" ON "upwork_requests"("org_id", "project_manager_id");

-- CreateIndex
CREATE INDEX "upwork_requests_org_id_request_date_idx" ON "upwork_requests"("org_id", "request_date");

-- CreateIndex
CREATE UNIQUE INDEX "upwork_request_items_request_id_profile_name_key" ON "upwork_request_items"("request_id", "profile_name");

-- CreateIndex
CREATE UNIQUE INDEX "upwork_profile_access_user_id_profile_name_key" ON "upwork_profile_access"("user_id", "profile_name");

-- CreateIndex
CREATE INDEX "upwork_proposals_org_id_type_status_onboarded_at_idx" ON "upwork_proposals"("org_id", "type", "status", "onboarded_at");

-- AddForeignKey
ALTER TABLE "upwork_requests" ADD CONSTRAINT "upwork_requests_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upwork_requests" ADD CONSTRAINT "upwork_requests_project_manager_id_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upwork_requests" ADD CONSTRAINT "upwork_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upwork_request_items" ADD CONSTRAINT "upwork_request_items_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "upwork_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upwork_profile_access" ADD CONSTRAINT "upwork_profile_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
