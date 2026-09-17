-- Makes the two remaining required-with-no-onDelete User references
-- nullable with ON DELETE SET NULL (Part: delete user, 2026-09-17), so a
-- User row can actually be deleted -- everything else pointing at users.id
-- already cascades or sets null; these two were the last blockers.

-- DropForeignKey
ALTER TABLE "lead_imports" DROP CONSTRAINT "lead_imports_uploaded_by_user_id_fkey";

-- AlterTable
ALTER TABLE "lead_imports" ALTER COLUMN "uploaded_by_user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "social_internal_notes" DROP CONSTRAINT "social_internal_notes_user_id_fkey";

-- AlterTable
ALTER TABLE "social_internal_notes" ALTER COLUMN "user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "social_internal_notes" ADD CONSTRAINT "social_internal_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
