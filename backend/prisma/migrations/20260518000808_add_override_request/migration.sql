-- CreateEnum
CREATE TYPE "OverrideRequestStatus" AS ENUM ('pending', 'accepted', 'declined', 'expired');

-- CreateTable
CREATE TABLE "OverrideRequest" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "blockingType" TEXT,
    "blockingStart" TIMESTAMP(3),
    "blockingEnd" TIMESTAMP(3),
    "message" TEXT,
    "status" "OverrideRequestStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OverrideRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OverrideRequest_token_key" ON "OverrideRequest"("token");

-- CreateIndex
CREATE INDEX "OverrideRequest_eventId_personId_status_idx" ON "OverrideRequest"("eventId", "personId", "status");

-- AddForeignKey
ALTER TABLE "OverrideRequest" ADD CONSTRAINT "OverrideRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OverrideRequest" ADD CONSTRAINT "OverrideRequest_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
