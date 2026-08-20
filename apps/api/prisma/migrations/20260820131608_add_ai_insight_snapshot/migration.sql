-- CreateTable
CREATE TABLE "ai_insight_snapshots" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "insights" JSONB NOT NULL DEFAULT '{}',
    "recommendations" JSONB NOT NULL DEFAULT '{}',
    "email_improvements" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ai_insight_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_insight_snapshots_org_id_key" ON "ai_insight_snapshots"("org_id");

-- AddForeignKey
ALTER TABLE "ai_insight_snapshots" ADD CONSTRAINT "ai_insight_snapshots_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
