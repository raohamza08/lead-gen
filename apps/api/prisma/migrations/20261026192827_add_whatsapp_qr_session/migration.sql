-- CreateEnum
CREATE TYPE "WhatsAppQrSessionStatus" AS ENUM ('CONNECTING', 'QR_PENDING', 'CONNECTED', 'DISCONNECTED', 'LOGGED_OUT');

-- AlterEnum
ALTER TYPE "SocialPlatform" ADD VALUE 'WHATSAPP_QR';

-- CreateTable
CREATE TABLE "whatsapp_qr_sessions" (
    "id" TEXT NOT NULL,
    "social_account_id" TEXT NOT NULL,
    "status" "WhatsAppQrSessionStatus" NOT NULL DEFAULT 'CONNECTING',
    "last_qr_at" TIMESTAMP(3),
    "last_connected_at" TIMESTAMP(3),
    "last_disconnected_at" TIMESTAMP(3),
    "disconnect_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_qr_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_qr_sessions_social_account_id_key" ON "whatsapp_qr_sessions"("social_account_id");

-- AddForeignKey
ALTER TABLE "whatsapp_qr_sessions" ADD CONSTRAINT "whatsapp_qr_sessions_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
