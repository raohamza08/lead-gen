-- AlterTable
ALTER TABLE "upwork_api_transactions" ADD COLUMN     "assignment_company_name" TEXT;

-- CreateIndex
CREATE INDEX "upwork_api_transactions_org_id_assignment_company_name_idx" ON "upwork_api_transactions"("org_id", "assignment_company_name");
