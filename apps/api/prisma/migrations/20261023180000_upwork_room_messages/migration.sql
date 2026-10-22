-- AlterTable
ALTER TABLE "upwork_api_rooms" ADD COLUMN "locally_read_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "upwork_api_room_messages" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "upwork_room_id" TEXT NOT NULL,
    "upwork_story_id" TEXT NOT NULL,
    "message" TEXT,
    "sender_name" TEXT,
    "sender_org_name" TEXT,
    "sender_is_agency" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upwork_api_room_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_api_room_messages_org_id_upwork_story_id_key" ON "upwork_api_room_messages"("org_id", "upwork_story_id");

-- CreateIndex
CREATE INDEX "upwork_api_room_messages_org_id_upwork_room_id_created_at_idx" ON "upwork_api_room_messages"("org_id", "upwork_room_id", "created_at");

-- AddForeignKey
ALTER TABLE "upwork_api_room_messages" ADD CONSTRAINT "upwork_api_room_messages_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
