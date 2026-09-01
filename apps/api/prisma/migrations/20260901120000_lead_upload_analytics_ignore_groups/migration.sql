-- CreateEnum
CREATE TYPE "LeadImportSourceMethod" AS ENUM ('CSV', 'MANUAL');

-- CreateEnum
CREATE TYPE "IgnoreRuleType" AS ENUM ('SENDER', 'DOMAIN');

-- AlterTable
ALTER TABLE "ignored_senders" ADD COLUMN     "created_by_user_id" TEXT,
ADD COLUMN     "rule_type" "IgnoreRuleType" NOT NULL DEFAULT 'SENDER',
ADD COLUMN     "sender_domain" TEXT,
ALTER COLUMN "from_email" DROP NOT NULL;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "import_id" TEXT,
ADD COLUMN     "uploaded_by_user_id" TEXT;

-- CreateTable
CREATE TABLE "lead_imports" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "source_method" "LeadImportSourceMethod" NOT NULL DEFAULT 'CSV',
    "file_name" TEXT,
    "total_records" INTEGER NOT NULL,
    "successful_records" INTEGER NOT NULL DEFAULT 0,
    "duplicate_records" INTEGER NOT NULL DEFAULT 0,
    "invalid_records" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_imports_org_id_created_at_idx" ON "lead_imports"("org_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ignored_senders_org_id_sender_domain_key" ON "ignored_senders"("org_id", "sender_domain");

-- AddForeignKey
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "lead_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ignored_senders" ADD CONSTRAINT "ignored_senders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
