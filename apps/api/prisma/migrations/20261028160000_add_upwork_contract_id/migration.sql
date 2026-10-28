-- AlterTable
ALTER TABLE "upwork_api_transactions" ADD COLUMN     "contract_id" TEXT;

-- AlterTable
ALTER TABLE "upwork_proposals" ADD COLUMN     "contract_id" TEXT;

-- CreateIndex
CREATE INDEX "upwork_api_transactions_org_id_contract_id_idx" ON "upwork_api_transactions"("org_id", "contract_id");
