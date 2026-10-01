-- AlterTable
ALTER TABLE "users" ADD COLUMN     "upwork_bidding_access" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "upwork_invite_access" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "upwork_requests_access" BOOLEAN NOT NULL DEFAULT true;
