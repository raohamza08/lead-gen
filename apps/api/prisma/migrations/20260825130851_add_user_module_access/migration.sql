-- Prisma's diff engine repeatedly proposes dropping the hand-added
-- search_vector GIN index/generated-column default on every migration
-- (it can't fully introspect a GENERATED ALWAYS AS (...) STORED column) —
-- stripped here, same fix applied to every prior migration in this repo.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_hub_access" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lead_gen_access" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "social_media_access" BOOLEAN NOT NULL DEFAULT true;
