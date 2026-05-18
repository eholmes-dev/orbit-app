-- CreateEnum
CREATE TYPE "ArchiveKind" AS ENUM ('declined_assignment', 'accepted_conflict', 'cancelled_event');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ArchiveEntry" (
    "id" TEXT NOT NULL,
    "kind" "ArchiveKind" NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT,
    "reason" TEXT,
    "conflictReason" TEXT,
    "conflictShortBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchiveEntry_createdAt_idx" ON "ArchiveEntry"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ArchiveEntry_eventId_idx" ON "ArchiveEntry"("eventId");

-- AddForeignKey
ALTER TABLE "ArchiveEntry" ADD CONSTRAINT "ArchiveEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveEntry" ADD CONSTRAINT "ArchiveEntry_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
