-- CreateTable
CREATE TABLE "ignored_senders" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "from_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ignored_senders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ignored_senders_org_id_from_email_key" ON "ignored_senders"("org_id", "from_email");

-- AddForeignKey
ALTER TABLE "ignored_senders" ADD CONSTRAINT "ignored_senders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
