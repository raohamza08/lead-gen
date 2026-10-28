-- CreateEnum
CREATE TYPE "UpworkServiceFeeType" AS ENUM ('PERCENT', 'FIXED');

-- AlterTable
ALTER TABLE "upwork_proposals" ADD COLUMN     "client_earnings" DECIMAL(65,30),
ADD COLUMN     "net_earnings" DECIMAL(65,30),
ADD COLUMN     "service_fee_amount" DECIMAL(65,30),
ADD COLUMN     "service_fee_type" "UpworkServiceFeeType",
ADD COLUMN     "service_fee_value" DECIMAL(65,30);
