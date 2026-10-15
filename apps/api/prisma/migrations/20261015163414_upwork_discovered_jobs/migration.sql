-- CreateTable
CREATE TABLE "upwork_discovered_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "job_url" TEXT NOT NULL,
    "title" TEXT,
    "posted_at" TIMESTAMP(3),
    "facts" JSONB,
    "client" JSONB,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "spend_tier" TEXT,
    "is_long_term" BOOLEAN,
    "is_hourly" BOOLEAN,
    "recommendation" TEXT NOT NULL DEFAULT 'MAYBE',
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upwork_discovered_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "upwork_discovered_jobs_org_id_discovered_at_idx" ON "upwork_discovered_jobs"("org_id", "discovered_at");

-- CreateIndex
CREATE UNIQUE INDEX "upwork_discovered_jobs_org_id_job_url_key" ON "upwork_discovered_jobs"("org_id", "job_url");

-- AddForeignKey
ALTER TABLE "upwork_discovered_jobs" ADD CONSTRAINT "upwork_discovered_jobs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

