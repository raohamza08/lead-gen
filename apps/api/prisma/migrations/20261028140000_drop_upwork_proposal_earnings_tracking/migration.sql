-- AlterTable
ALTER TABLE "upwork_proposals" DROP COLUMN "client_earnings",
DROP COLUMN "net_earnings",
DROP COLUMN "service_fee_amount",
DROP COLUMN "service_fee_type",
DROP COLUMN "service_fee_value";

-- DropEnum
DROP TYPE "UpworkServiceFeeType";
