-- CreateEnum
CREATE TYPE "PreparationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "SendingSessionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "SendingScheduleFrequency" AS ENUM ('DAILY', 'ONE_TIME');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailMessageStatus" ADD VALUE 'READY_TO_SEND';
ALTER TYPE "EmailMessageStatus" ADD VALUE 'WAITING_FOR_SCHEDULE';
ALTER TYPE "EmailMessageStatus" ADD VALUE 'SENDING';
ALTER TYPE "EmailMessageStatus" ADD VALUE 'RETRY_SCHEDULED';

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "next_send_retry_at" TIMESTAMP(3),
ADD COLUMN     "send_retry_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sending_locked_at" TIMESTAMP(3),
ADD COLUMN     "sending_session_id" TEXT;

-- AlterTable
ALTER TABLE "pipeline_states" ADD COLUMN     "preparation_completed_at" TIMESTAMP(3),
ADD COLUMN     "preparation_status" "PreparationStatus" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "preparation_step" INTEGER;

-- CreateTable
CREATE TABLE "sending_sessions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "status" "SendingSessionStatus" NOT NULL DEFAULT 'PENDING',
    "total_leads" INTEGER NOT NULL DEFAULT 0,
    "successful" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sending_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sending_schedules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" "SendingScheduleFrequency" NOT NULL DEFAULT 'DAILY',
    "send_time" TEXT NOT NULL DEFAULT '09:00',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "one_time_date" TEXT,
    "last_triggered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sending_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sending_schedules_org_id_key" ON "sending_schedules"("org_id");

-- AddForeignKey
ALTER TABLE "sending_sessions" ADD CONSTRAINT "sending_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sending_schedules" ADD CONSTRAINT "sending_schedules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_sending_session_id_fkey" FOREIGN KEY ("sending_session_id") REFERENCES "sending_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
