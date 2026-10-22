-- CreateTable
CREATE TABLE "upwork_api_freelancer_profiles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "freelancer_user_id" TEXT NOT NULL,
    "freelancer_name" TEXT,
    "top_rated_status" TEXT,
    "total_earnings" DOUBLE PRECISION,
    "total_jobs" INTEGER,
    "total_hourly_jobs" INTEGER,
    "total_fixed_jobs" INTEGER,
    "total_feedback" DOUBLE PRECISION,
    "last_worked_on" TIMESTAMP(3),
    "skills_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upwork_api_freelancer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_api_freelancer_profiles_org_id_freelancer_user_id_key" ON "upwork_api_freelancer_profiles"("org_id", "freelancer_user_id");

-- AddForeignKey
ALTER TABLE "upwork_api_freelancer_profiles" ADD CONSTRAINT "upwork_api_freelancer_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
