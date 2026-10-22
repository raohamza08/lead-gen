-- CreateTable
CREATE TABLE "upwork_connects_snapshots" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connects_balance" INTEGER NOT NULL,
    "rollover_balance" INTEGER NOT NULL,
    "connects_balance_free" INTEGER NOT NULL,
    "connects_balance_paid" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_connects_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upwork_connects_transactions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "reason" TEXT,
    "amount_raw" TEXT NOT NULL,
    "amount_currency" TEXT NOT NULL,
    "amount_display" TEXT NOT NULL,
    "job_id" TEXT,
    "job_title" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_connects_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upwork_connects_snapshots_org_id_captured_at_idx" ON "upwork_connects_snapshots"("org_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "upwork_connects_transactions_org_id_dedupe_key_key" ON "upwork_connects_transactions"("org_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "upwork_connects_transactions_org_id_occurred_at_idx" ON "upwork_connects_transactions"("org_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "upwork_connects_snapshots" ADD CONSTRAINT "upwork_connects_snapshots_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upwork_connects_transactions" ADD CONSTRAINT "upwork_connects_transactions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
