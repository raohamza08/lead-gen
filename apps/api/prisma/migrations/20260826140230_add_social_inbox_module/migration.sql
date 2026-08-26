-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "conversation_id" TEXT;

-- AlterTable
ALTER TABLE "social_account_access" ADD COLUMN     "can_view" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "social_conversations" (
    "id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "external_conversation_id" TEXT NOT NULL,
    "contact_external_id" TEXT,
    "contact_name" TEXT,
    "contact_username" TEXT,
    "contact_profile_image_url" TEXT,
    "last_message" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "external_message_id" TEXT NOT NULL,
    "from_us" BOOLEAN NOT NULL,
    "sender_name" TEXT,
    "message_text" TEXT,
    "media_url" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_internal_notes" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_internal_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_conversations_last_message_at_idx" ON "social_conversations"("last_message_at" DESC);

-- CreateIndex
CREATE INDEX "social_conversations_status_idx" ON "social_conversations"("status");

-- CreateIndex
CREATE INDEX "social_conversations_assigned_to_user_id_idx" ON "social_conversations"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "social_conversations_unread_count_idx" ON "social_conversations"("unread_count");

-- CreateIndex
CREATE UNIQUE INDEX "social_conversations_social_account_id_external_conversatio_key" ON "social_conversations"("social_account_id", "external_conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_messages_conversation_id_external_message_id_key" ON "social_messages"("conversation_id", "external_message_id");

-- CreateIndex
CREATE INDEX "social_internal_notes_conversation_id_idx" ON "social_internal_notes"("conversation_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "social_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_conversations" ADD CONSTRAINT "social_conversations_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_messages" ADD CONSTRAINT "social_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "social_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_internal_notes" ADD CONSTRAINT "social_internal_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "social_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_internal_notes" ADD CONSTRAINT "social_internal_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
