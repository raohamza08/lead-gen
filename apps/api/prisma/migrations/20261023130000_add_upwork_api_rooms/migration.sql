-- CreateTable
CREATE TABLE "upwork_api_rooms" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "upwork_room_id" TEXT NOT NULL,
    "room_name" TEXT,
    "room_type" TEXT,
    "num_users" INTEGER,
    "num_unread" INTEGER,
    "upwork_created_at" TIMESTAMP(3),
    "latest_message" TEXT,
    "latest_message_at" TIMESTAMP(3),
    "latest_message_from" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upwork_api_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upwork_api_rooms_org_id_upwork_room_id_key" ON "upwork_api_rooms"("org_id", "upwork_room_id");

-- AddForeignKey
ALTER TABLE "upwork_api_rooms" ADD CONSTRAINT "upwork_api_rooms_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
