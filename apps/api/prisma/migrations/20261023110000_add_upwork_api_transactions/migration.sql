-- CreateTable
CREATE TABLE "upwork_api_transactions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "upwork_record_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3),
    "type" TEXT,
    "accounting_subtype" TEXT,
    "description" TEXT,
    "amount_raw" TEXT,
    "amount_currency" TEXT,
    "amount_display" TEXT,
    "payment_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_api_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_api_transactions_org_id_upwork_record_id_key" ON "upwork_api_transactions"("org_id", "upwork_record_id");

-- CreateIndex
CREATE INDEX "upwork_api_transactions_org_id_occurred_at_idx" ON "upwork_api_transactions"("org_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "upwork_api_transactions" ADD CONSTRAINT "upwork_api_transactions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
