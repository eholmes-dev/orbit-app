-- CreateIndex
CREATE INDEX "Assignment_eventId_status_idx" ON "Assignment"("eventId", "status");

-- CreateIndex
CREATE INDEX "Assignment_personId_status_idx" ON "Assignment"("personId", "status");

-- CreateIndex
CREATE INDEX "Assignment_status_idx" ON "Assignment"("status");

-- CreateIndex
CREATE INDEX "Event_cancelledAt_startDateTime_idx" ON "Event"("cancelledAt", "startDateTime");

-- CreateIndex
CREATE INDEX "Event_startDateTime_idx" ON "Event"("startDateTime");
