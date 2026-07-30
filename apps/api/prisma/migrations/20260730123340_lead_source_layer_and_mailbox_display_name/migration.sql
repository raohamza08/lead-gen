-- CreateEnum
CREATE TYPE "LeadSourceLayer" AS ENUM ('SURFACE_WEB', 'LICENSED_DATABASE', 'MANUAL');

-- AlterTable
ALTER TABLE "email_accounts" ADD COLUMN     "display_name" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "source_layer" "LeadSourceLayer" NOT NULL DEFAULT 'SURFACE_WEB';
