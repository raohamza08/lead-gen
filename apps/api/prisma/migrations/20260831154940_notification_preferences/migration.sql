-- NOTE: prisma migrate diff again proposed dropping
-- inbound_email_messages_search_vector_idx and clearing search_vector's
-- DEFAULT — same spurious drift stripped in the prior migrations this
-- session (hand-managed tsvector column Prisma can't fully model). Not part
-- of this change; deliberately excluded.

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "desktop_enabled" BOOLEAN NOT NULL DEFAULT false,
    "sound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sound_tone" TEXT NOT NULL DEFAULT 'DEFAULT',
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "leads_enabled" BOOLEAN NOT NULL DEFAULT true,
    "agents_enabled" BOOLEAN NOT NULL DEFAULT true,
    "automations_enabled" BOOLEAN NOT NULL DEFAULT true,
    "social_enabled" BOOLEAN NOT NULL DEFAULT true,
    "system_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
