-- AlterTable
ALTER TABLE "email_accounts" ADD COLUMN     "imap_encryption" TEXT,
ADD COLUMN     "imap_host" TEXT,
ADD COLUMN     "imap_password_enc" TEXT,
ADD COLUMN     "imap_port" INTEGER,
ADD COLUMN     "imap_username" TEXT,
ADD COLUMN     "inbound_sync_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_imap_uid" INTEGER,
ADD COLUMN     "mailbox_label" TEXT;

-- CreateTable
CREATE TABLE "inbound_email_threads" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "participants" JSONB NOT NULL DEFAULT '[]',
    "lead_id" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_email_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_email_messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "from_name" TEXT,
    "from_email" TEXT NOT NULL,
    "to_emails" TEXT[],
    "cc_emails" TEXT[],
    "bcc_emails" TEXT[],
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_important" BOOLEAN NOT NULL DEFAULT false,
    "is_ignored" BOOLEAN NOT NULL DEFAULT false,
    "has_attachments" BOOLEAN NOT NULL DEFAULT false,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "suggested_category" TEXT,
    "ai_suggested_action" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_tags" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_email_message_tags" (
    "message_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "inbound_email_message_tags_pkey" PRIMARY KEY ("message_id","tag_id")
);

-- CreateTable
CREATE TABLE "email_account_access" (
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "can_reply" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_account_access_pkey" PRIMARY KEY ("user_id","account_id")
);

-- CreateIndex
CREATE INDEX "inbound_email_threads_org_id_account_id_last_message_at_idx" ON "inbound_email_threads"("org_id", "account_id", "last_message_at");

-- CreateIndex
CREATE INDEX "inbound_email_threads_org_id_lead_id_idx" ON "inbound_email_threads"("org_id", "lead_id");

-- CreateIndex
CREATE INDEX "inbound_email_messages_thread_id_idx" ON "inbound_email_messages"("thread_id");

-- CreateIndex
CREATE INDEX "inbound_email_messages_account_id_is_read_idx" ON "inbound_email_messages"("account_id", "is_read");

-- CreateIndex
CREATE INDEX "inbound_email_messages_account_id_is_ignored_idx" ON "inbound_email_messages"("account_id", "is_ignored");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_email_messages_account_id_provider_message_id_key" ON "inbound_email_messages"("account_id", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_tags_org_id_name_key" ON "email_tags"("org_id", "name");

-- AddForeignKey
ALTER TABLE "inbound_email_threads" ADD CONSTRAINT "inbound_email_threads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_email_threads" ADD CONSTRAINT "inbound_email_threads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_email_threads" ADD CONSTRAINT "inbound_email_threads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_email_messages" ADD CONSTRAINT "inbound_email_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "inbound_email_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_email_messages" ADD CONSTRAINT "inbound_email_messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tags" ADD CONSTRAINT "email_tags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_email_message_tags" ADD CONSTRAINT "inbound_email_message_tags_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "inbound_email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_email_message_tags" ADD CONSTRAINT "inbound_email_message_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "email_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_account_access" ADD CONSTRAINT "email_account_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_account_access" ADD CONSTRAINT "email_account_access_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "email_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Full-text search over subject + body for the Email Hub global search
-- (Part: Powerful Filtering / Search). A generated column keeps the tsvector
-- automatically in sync with every insert/update — no application-code
-- responsibility to remember to update it.
ALTER TABLE "inbound_email_messages"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("subject", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("body_text", '')), 'B')
  ) STORED;

CREATE INDEX "inbound_email_messages_search_vector_idx"
  ON "inbound_email_messages" USING GIN ("search_vector");
