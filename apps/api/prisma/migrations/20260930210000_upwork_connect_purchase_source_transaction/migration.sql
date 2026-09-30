-- AlterTable
ALTER TABLE "upwork_connect_purchases" ADD COLUMN "source_transaction_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "upwork_connect_purchases_org_id_source_transaction_id_key" ON "upwork_connect_purchases"("org_id", "source_transaction_id");
