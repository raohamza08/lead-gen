-- CreateEnum
CREATE TYPE "UpworkProfileGroup" AS ENUM ('GRAPHICS', 'TECH');

-- AlterTable
ALTER TABLE "upwork_api_rooms" ADD COLUMN     "assigned_profile_names" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "upwork_freelancer_profiles" ADD COLUMN     "group" "UpworkProfileGroup";
