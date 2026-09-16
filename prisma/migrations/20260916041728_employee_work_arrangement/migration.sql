-- CreateEnum
CREATE TYPE "WorkArrangement" AS ENUM ('ON_SITE', 'HYBRID', 'REMOTE');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "onSiteDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "workArrangement" "WorkArrangement" NOT NULL DEFAULT 'ON_SITE';
