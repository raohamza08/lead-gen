-- NOTE: prisma migrate diff again proposed dropping
-- inbound_email_messages_search_vector_idx and clearing search_vector's
-- DEFAULT — same spurious drift stripped in the prior migrations this
-- session (hand-managed tsvector column Prisma can't fully model). Not part
-- of this change; deliberately excluded.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_primary_admin" BOOLEAN NOT NULL DEFAULT false;

-- Bootstrap: every existing org gets exactly one primary admin, chosen as
-- its earliest-created ADMIN-role user — deterministic, not a runtime
-- guess. An org with no ADMIN at all (shouldn't happen given seed.ts always
-- creates one, but not assumed) simply gets none; UsersService can grant it
-- to someone explicitly later.
WITH earliest_admin AS (
  SELECT DISTINCT ON (org_id) id
  FROM "users"
  WHERE role = 'ADMIN' AND active = true
  ORDER BY org_id, created_at ASC
)
UPDATE "users" SET "is_primary_admin" = true WHERE id IN (SELECT id FROM earliest_admin);
