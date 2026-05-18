-- AlterEnum
ALTER TYPE "ArchiveKind" ADD VALUE 'reduced_requirement';

-- AlterTable
ALTER TABLE "ArchiveEntry" ADD COLUMN     "newRequiredStaffCount" INTEGER,
ADD COLUMN     "previousRequiredStaffCount" INTEGER;
