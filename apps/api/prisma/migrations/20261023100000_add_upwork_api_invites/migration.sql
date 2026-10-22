-- CreateTable
CREATE TABLE "upwork_api_invites" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "upwork_invitation_id" TEXT NOT NULL,
    "context" TEXT,
    "client_user_id" TEXT,
    "client_name" TEXT,
    "freelancer_user_id" TEXT,
    "freelancer_name" TEXT,
    "job_id" TEXT,
    "job_title" TEXT,
    "invitation_letter" TEXT,
    "invite_attempt" INTEGER,
    "status" TEXT,
    "acceptance_duration" TEXT,
    "upfront_payment_pct" DOUBLE PRECISION,
    "cover_letter" TEXT,
    "upwork_created_by" TEXT,
    "upwork_created_at" TIMESTAMP(3),
    "upwork_modified_by" TEXT,
    "upwork_modified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upwork_api_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_api_invites_org_id_upwork_invitation_id_key" ON "upwork_api_invites"("org_id", "upwork_invitation_id");

-- CreateIndex
CREATE INDEX "upwork_api_invites_org_id_status_idx" ON "upwork_api_invites"("org_id", "status");

-- CreateIndex
CREATE INDEX "upwork_api_invites_org_id_upwork_modified_at_idx" ON "upwork_api_invites"("org_id", "upwork_modified_at");

-- AddForeignKey
ALTER TABLE "upwork_api_invites" ADD CONSTRAINT "upwork_api_invites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
