-- AlterTable
ALTER TABLE "users" ADD COLUMN     "upwork_chat_reminder_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "upwork_chat_reminder_threshold_minutes" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "upwork_room_reminder_states" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "upwork_room_id" TEXT NOT NULL,
    "last_notified_message_at" TIMESTAMP(3) NOT NULL,
    "notified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_room_reminder_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_room_reminder_states_org_id_user_id_upwork_room_id_key" ON "upwork_room_reminder_states"("org_id", "user_id", "upwork_room_id");

-- AddForeignKey
ALTER TABLE "upwork_room_reminder_states" ADD CONSTRAINT "upwork_room_reminder_states_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upwork_room_reminder_states" ADD CONSTRAINT "upwork_room_reminder_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
