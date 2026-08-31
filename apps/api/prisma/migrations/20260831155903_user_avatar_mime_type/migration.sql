-- NOTE: prisma migrate diff again proposed dropping
-- inbound_email_messages_search_vector_idx and clearing search_vector's
-- DEFAULT — same spurious drift stripped in the prior migrations this
-- session (hand-managed tsvector column Prisma can't fully model). Not part
-- of this change; deliberately excluded.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_mime_type" TEXT;
