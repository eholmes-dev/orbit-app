import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { generateScheduleSchema } from "../schemas/schedule.js";
import { randomBytes } from "node:crypto";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  sendMail,
} from "../lib/graph.js";

export const scheduleRouter = Router();

const SCHEDULER_URL = process.env.SCHEDULER_URL ?? "http://localhost:8000";

const assignmentIncludeForResponse = {
  event: {
    select: {
      id: true,
      title: true,
      startDateTime: true,
      endDateTime: true,
      priorityTier: true,
      // First required label is used by the Schedule grid to color the shift
      // card (closest analog to "role"). Include all required labels in case
      // we surface more than one later.
      requiredLabels: { select: { id: true, name: true } },
    },
  },
  person: { select: { id: true, name: true, email: true } },
} as const;

interface SolverAssignment {
  event_id: string;
  person_id: string;
}
interface SolverConflict {
  event_id: string;
  reason: string;
  short_by: number;
  message: string;
}
interface SolverWarning {
  person_id: string;
  type: string;
  value: number;
  message: string;
}
interface SolverResponse {
  status: string;
  assignments: SolverAssignment[];
  conflicts: SolverConflict[];
  warnings: SolverWarning[];
  solve_time_ms: number;
}

scheduleRouter.get(
  "/assignments",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query;
    const assignments = await prisma.assignment.findMany({
      where: {
        status: { not: "declined" },
        event:
          from || to
            ? {
                AND: [
                  from ? { endDateTime: { gte: new Date(String(from)) } } : {},
                  to ? { startDateTime: { lte: new Date(String(to)) } } : {},
                ],
              }
            : undefined,
      },
      include: assignmentIncludeForResponse,
      orderBy: { event: { startDateTime: "asc" } },
    });
    res.json(assignments);
  }),
);

scheduleRouter.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const { startDate, endDate, timeLimitSeconds } =
      generateScheduleSchema.parse(req.body);
    const rangeStart = new Date(startDate);
    const rangeEnd = new Date(endDate);

    // 1. Gather events that overlap the requested range. Cancelled events
    // (Event.cancelledAt != null) are excluded — admin already decided not to
    // staff them, so they shouldn't generate conflicts on regen.
    const events = await prisma.event.findMany({
      where: {
        cancelledAt: null,
        startDateTime: { lt: rangeEnd },
        endDateTime: { gt: rangeStart },
      },
      include: { requiredLabels: { select: { id: true } } },
    });

    // 2. Gather active people with their labels.
    const people = await prisma.person.findMany({
      where: { active: true },
      include: { labels: { select: { id: true } } },
    });

    // 3. Gather availability windows that overlap the range.
    const availability = await prisma.availability.findMany({
      where: {
        startDateTime: { lt: rangeEnd },
        endDateTime: { gt: rangeStart },
      },
    });

    // 3b. Gather declined (event, person) pairs for events in range — solver
    // must exclude these from consideration.
    const eventIdsInRange = events.map((e) => e.id);
    const declined = await prisma.assignment.findMany({
      where: { eventId: { in: eventIdsInRange }, status: "declined" },
      select: { eventId: true, personId: true },
    });

    // 4. Build solver payload.
    const solverPayload = {
      people: people.map((p) => ({
        id: p.id,
        label_ids: p.labels.map((l) => l.id),
        max_hours_per_week: p.maxHoursPerWeek,
        preferred_hours: p.preferredHours,
      })),
      events: events.map((e) => ({
        id: e.id,
        start: e.startDateTime.toISOString(),
        end: e.endDateTime.toISOString(),
        priority_tier: e.priorityTier,
        required_staff_count: e.requiredStaffCount,
        is_hard_requirement: e.isHardRequirement,
        required_label_ids: e.requiredLabels.map((l) => l.id),
      })),
      availability: availability.map((a) => ({
        person_id: a.personId,
        start: a.startDateTime.toISOString(),
        end: a.endDateTime.toISOString(),
        type: a.type,
      })),
      declined_pairs: declined.map((d) => ({
        event_id: d.eventId,
        person_id: d.personId,
      })),
      time_limit_seconds: timeLimitSeconds ?? 10,
    };

    // 5. Call scheduler.
    let solverResult: SolverResponse;
    try {
      const resp = await fetch(`${SCHEDULER_URL}/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(solverPayload),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new HttpError(502, `Scheduler returned ${resp.status}: ${text}`);
      }
      solverResult = (await resp.json()) as SolverResponse;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Scheduler unreachable: ${(err as Error).message}`);
    }

    // 6. Persist: drop existing proposed assignments for these events
    //    (confirmed and declined survive), then insert the solver's new picks.
    if (eventIdsInRange.length > 0) {
      await prisma.assignment.deleteMany({
        where: { eventId: { in: eventIdsInRange }, status: "proposed" },
      });
    }

    if (solverResult.assignments.length > 0) {
      await prisma.assignment.createMany({
        data: solverResult.assignments.map((a) => ({
          eventId: a.event_id,
          personId: a.person_id,
          status: "proposed",
        })),
        skipDuplicates: true,
      });
    }

    // 7. Return assignments hydrated with event + person info. Declined rows
    // are excluded from the UI list — they exist purely as solver constraints.
    const hydrated = await prisma.assignment.findMany({
      where: {
        eventId: { in: eventIdsInRange },
        status: { not: "declined" },
      },
      include: assignmentIncludeForResponse,
      orderBy: { event: { startDateTime: "asc" } },
    });

    // Hydrate warnings with the person's name so the UI can show "Jane Doe"
    // instead of a raw cuid. We already have `people` in scope from step 2.
    const personNameById = new Map(people.map((p) => [p.id, p.name]));
    const hydratedWarnings = solverResult.warnings.map((w) => ({
      ...w,
      person_name: personNameById.get(w.person_id) ?? w.person_id,
    }));

    // Snapshot of what the solver was actually given. The frontend caches
    // this so admins can run a "why wasn't X scheduled?" diagnostic against
    // the exact inputs the solver saw, without needing the backend to re-fetch.
    const inputSnapshot = {
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        label_ids: p.labels.map((l) => l.id),
        max_hours_per_week: p.maxHoursPerWeek,
      })),
      events: events.map((e) => ({
        id: e.id,
        title: e.title,
        start: e.startDateTime.toISOString(),
        end: e.endDateTime.toISOString(),
        required_label_ids: e.requiredLabels.map((l) => l.id),
        required_staff_count: e.requiredStaffCount,
      })),
      availability: availability.map((a) => ({
        person_id: a.personId,
        start: a.startDateTime.toISOString(),
        end: a.endDateTime.toISOString(),
        type: a.type,
      })),
      declined_pairs: declined.map((d) => ({
        event_id: d.eventId,
        person_id: d.personId,
      })),
    };

    res.json({
      status: solverResult.status,
      solveTimeMs: solverResult.solve_time_ms,
      counts: {
        events: events.length,
        people: people.length,
        assignments: solverResult.assignments.length,
        conflicts: solverResult.conflicts.length,
        warnings: solverResult.warnings.length,
      },
      inputSnapshot,
      assignments: hydrated,
      conflicts: solverResult.conflicts,
      warnings: hydratedWarnings,
    });
  }),
);

const confirmSchema = z.object({
  assignmentIds: z.array(z.string()).optional(),
});

scheduleRouter.post(
  "/confirm",
  asyncHandler(async (req, res) => {
    const { assignmentIds } = confirmSchema.parse(req.body);

    const proposed = await prisma.assignment.findMany({
      where: {
        status: "proposed",
        ...(assignmentIds ? { id: { in: assignmentIds } } : {}),
      },
      include: assignmentIncludeForResponse,
    });

    const results: Array<{
      assignmentId: string;
      status: "confirmed" | "failed";
      error?: string;
    }> = [];

    for (const a of proposed) {
      try {
        // Idempotency (audit #6): if a previous attempt already created the
        // Outlook event but failed to flip the DB row to confirmed (or admin
        // is retrying), reuse the existing externalEventId rather than
        // creating a duplicate Outlook event.
        let externalEventId = a.externalEventId;
        if (!externalEventId) {
          const bodyText =
            `Tier ${a.event.priorityTier} shift.\n` +
            `Assigned to ${a.person.name} by Orbit Scheduler.`;
          externalEventId = await createCalendarEvent(a.person.email, {
            subject: a.event.title,
            start: a.event.startDateTime,
            end: a.event.endDateTime,
            bodyText,
          });
          // Persist externalEventId immediately so a retry recovers cleanly
          // even if the status flip below loses a race. Only touches the row
          // if it's still proposed — a concurrent decline already cleared it.
          await prisma.assignment.updateMany({
            where: { id: a.id, status: "proposed" },
            data: { externalEventId },
          });
        }

        // Atomic status flip (audit #3): only confirm if the row is still
        // proposed. If a concurrent Decline / Remove moved it elsewhere, we
        // lost the race and need to clean up the Outlook event we created.
        const updated = await prisma.assignment.updateMany({
          where: { id: a.id, status: "proposed" },
          data: {
            status: "confirmed",
            externalEventId,
            syncedToOutlookAt: new Date(),
          },
        });
        if (updated.count === 0) {
          try {
            await deleteCalendarEvent(a.person.email, externalEventId);
          } catch {
            // Best-effort. Orphan logged in the failed result below.
          }
          results.push({
            assignmentId: a.id,
            status: "failed",
            error:
              "Assignment was changed (declined or removed) during sync; Outlook event rolled back.",
          });
          continue;
        }
        results.push({ assignmentId: a.id, status: "confirmed" });
      } catch (err) {
        results.push({
          assignmentId: a.id,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Return the affected assignments hydrated with their new status so the
    // frontend can patch its local view without re-running the solver.
    const updatedAssignments = await prisma.assignment.findMany({
      where: { id: { in: proposed.map((p) => p.id) } },
      include: assignmentIncludeForResponse,
      orderBy: { event: { startDateTime: "asc" } },
    });

    res.json({
      confirmed: results.filter((r) => r.status === "confirmed").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
      updatedAssignments,
    });
  }),
);

const unconfirmSchema = z.object({
  assignmentIds: z.array(z.string()).min(1).max(200),
});

// Roll back a previous Confirm & sync. For each given assignment:
//   - if confirmed AND has externalEventId, delete the Outlook event first
//   - flip status back to proposed and clear externalEventId/syncedToOutlookAt
// Per-assignment failure handling matches /confirm: one bad Outlook delete
// doesn't block the rest of the batch.
scheduleRouter.post(
  "/unconfirm",
  asyncHandler(async (req, res) => {
    const { assignmentIds } = unconfirmSchema.parse(req.body);

    const confirmed = await prisma.assignment.findMany({
      where: { id: { in: assignmentIds }, status: "confirmed" },
      include: { person: { select: { email: true } } },
    });

    const results: Array<{
      assignmentId: string;
      status: "unconfirmed" | "failed";
      error?: string;
    }> = [];

    for (const a of confirmed) {
      // Atomic flip first (audit #3): only unconfirm if the row is still
      // confirmed AND still has the externalEventId we read. A concurrent
      // /confirm wouldn't change a confirmed row, but a concurrent /decline
      // could have already cleared everything — in which case our cleanup
      // would target a stale id. updateMany returns count=0 if the row was
      // changed under us, so we know to skip the Outlook delete.
      const flipped = await prisma.assignment.updateMany({
        where: {
          id: a.id,
          status: "confirmed",
          externalEventId: a.externalEventId,
        },
        data: {
          status: "proposed",
          externalEventId: null,
          syncedToOutlookAt: null,
        },
      });
      if (flipped.count === 0) {
        results.push({
          assignmentId: a.id,
          status: "failed",
          error:
            "Assignment was changed by another request (already unsynced or declined). Refresh and try again.",
        });
        continue;
      }
      if (a.externalEventId) {
        try {
          await deleteCalendarEvent(a.person.email, a.externalEventId);
        } catch (err) {
          results.push({
            assignmentId: a.id,
            status: "failed",
            error: `Row reverted to proposed but Outlook event couldn't be deleted: ${err instanceof Error ? err.message : String(err)}. Delete it manually.`,
          });
          continue;
        }
      }
      results.push({ assignmentId: a.id, status: "unconfirmed" });
    }

    const updatedAssignments = await prisma.assignment.findMany({
      where: { id: { in: assignmentIds } },
      include: assignmentIncludeForResponse,
      orderBy: { event: { startDateTime: "asc" } },
    });

    res.json({
      unconfirmed: results.filter((r) => r.status === "unconfirmed").length,
      failed: results.filter((r) => r.status === "failed").length,
      results,
      updatedAssignments,
    });
  }),
);

scheduleRouter.delete(
  "/assignments/:id",
  asyncHandler(async (req, res) => {
    const assignment = await prisma.assignment.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { person: { select: { email: true } } },
    });

    // If this assignment had been pushed to Outlook, remove the calendar event
    // first. If that fails we don't delete the DB row — admin needs to retry
    // or clean up manually.
    if (assignment.status === "confirmed" && assignment.externalEventId) {
      try {
        await deleteCalendarEvent(
          assignment.person.email,
          assignment.externalEventId,
        );
      } catch (err) {
        throw new HttpError(
          502,
          `Failed to remove Outlook event: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    await prisma.assignment.delete({ where: { id: assignment.id } });
    res.status(204).end();
  }),
);

const declineSchema = z.object({
  replacementPersonId: z.string().optional(),
});

scheduleRouter.post(
  "/assignments/:id/decline",
  asyncHandler(async (req, res) => {
    const { replacementPersonId } = declineSchema.parse(req.body);

    // Capture externalEventId atomically with the status flip — without this,
    // a concurrent Confirm could set a fresh externalEventId between our read
    // and write, and the cleanup below would silently miss it. (audit #3)
    const {
      alreadyDeclined,
      externalEventIdToCleanup,
      personEmail,
      eventId,
      personId,
    } = await prisma.$transaction(async (tx) => {
      const current = await tx.assignment.findUniqueOrThrow({
        where: { id: req.params.id },
        include: {
          event: { select: { id: true } },
          person: { select: { id: true, email: true } },
        },
      });
      const wasDeclined = current.status === "declined";
      const ext = current.externalEventId;
      if (!wasDeclined) {
        await tx.assignment.update({
          where: { id: current.id },
          data: {
            status: "declined",
            externalEventId: null,
            syncedToOutlookAt: null,
          },
        });
        await tx.archiveEntry.create({
          data: {
            kind: "declined_assignment",
            eventId: current.event.id,
            personId: current.person.id,
          },
        });
      }
      return {
        alreadyDeclined: wasDeclined,
        // Always honor an externalEventId — it may have been set by a
        // concurrent Confirm even if status was still "proposed" when we read.
        externalEventIdToCleanup: ext,
        personEmail: current.person.email,
        eventId: current.event.id,
        personId: current.person.id,
      };
    });
    void alreadyDeclined;
    void personId;

    // Outlook cleanup happens AFTER the DB transaction. If it fails, the row
    // is already declined in Orbit — surface the orphan to the admin so they
    // can clean up manually rather than silently leaving Outlook out of sync.
    if (externalEventIdToCleanup) {
      try {
        await deleteCalendarEvent(personEmail, externalEventIdToCleanup);
      } catch (err) {
        throw new HttpError(
          502,
          `Decline succeeded in Orbit but the Outlook event couldn't be removed: ${err instanceof Error ? err.message : err}. Delete it from the user's calendar manually.`,
        );
      }
    }

    // If admin picked a replacement, create a new proposed assignment now.
    // Stays as proposed even when the original was confirmed — admin reviews
    // and re-syncs. When the replacement was previously declined for this
    // event, the admin's manual pick overrides that — we un-decline rather
    // than reject. Solver's hard "declined_pairs" constraint still respects
    // *current* declined rows on the next auto-generate.
    if (replacementPersonId) {
      const existingRow = await prisma.assignment.findUnique({
        where: {
          eventId_personId: {
            eventId,
            personId: replacementPersonId,
          },
        },
      });
      if (existingRow && existingRow.status === "declined") {
        await prisma.assignment.update({
          where: { id: existingRow.id },
          data: {
            status: "proposed",
            externalEventId: null,
            syncedToOutlookAt: null,
          },
        });
      } else if (existingRow) {
        throw new HttpError(
          409,
          "That person is already assigned to this event.",
        );
      } else {
        await prisma.assignment.create({
          data: {
            eventId,
            personId: replacementPersonId,
            status: "proposed",
          },
        });
      }
    }

    const updated = await prisma.assignment.findMany({
      where: { eventId, status: { not: "declined" } },
      include: assignmentIncludeForResponse,
      orderBy: { event: { startDateTime: "asc" } },
    });

    res.json({ updatedAssignments: updated });
  }),
);

scheduleRouter.get(
  "/events/:eventId/candidates",
  asyncHandler(async (req, res) => {
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: req.params.eventId },
      include: { requiredLabels: { select: { id: true } } },
    });
    const requiredLabelIds = event.requiredLabels.map((l) => l.id);
    const eventStart = event.startDateTime;
    const eventEnd = event.endDateTime;

    // People already (non-declined) assigned to THIS event. They aren't
    // "other qualified people" — they're already on the roster.
    const alreadyAssignedHere = await prisma.assignment.findMany({
      where: { eventId: event.id, status: { not: "declined" } },
      select: { personId: true },
    });
    const assignedHereSet = new Set(alreadyAssignedHere.map((a) => a.personId));

    // All active people, then narrow to those with every required label AND
    // not already on this event.
    const people = await prisma.person.findMany({
      where: { active: true },
      include: { labels: { select: { id: true } } },
    });
    const qualified = people.filter((p) => {
      if (assignedHereSet.has(p.id)) return false;
      const owned = new Set(p.labels.map((l) => l.id));
      return requiredLabelIds.every((rid) => owned.has(rid));
    });
    if (qualified.length === 0) {
      // Still emit the full response shape — the dialog reads `event` and
      // `currentAssignments` for header/footer rendering and crashes if they
      // are missing. Surfaces "no qualified people" as an empty candidate list
      // rather than a broken page.
      const currentAssignmentsHere = await prisma.assignment.findMany({
        where: { eventId: event.id, status: { not: "declined" } },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startDateTime: true,
              endDateTime: true,
              priorityTier: true,
              requiredLabels: { select: { id: true, name: true } },
            },
          },
          person: { select: { id: true, name: true, email: true } },
        },
        orderBy: { event: { startDateTime: "asc" } },
      });
      res.json({
        event: {
          id: event.id,
          title: event.title,
          startDateTime: event.startDateTime,
          endDateTime: event.endDateTime,
          requiredStaffCount: event.requiredStaffCount,
        },
        currentAssignments: currentAssignmentsHere,
        candidates: [],
      });
      return;
    }

    const qualifiedIds = qualified.map((p) => p.id);

    // Availability conflicts (PTO / blocked / etc.) overlapping THIS event.
    const availability = await prisma.availability.findMany({
      where: {
        personId: { in: qualifiedIds },
        startDateTime: { lt: eventEnd },
        endDateTime: { gt: eventStart },
      },
    });
    const availByPerson = new Map<string, typeof availability>();
    for (const av of availability) {
      const arr = availByPerson.get(av.personId) ?? [];
      arr.push(av);
      availByPerson.set(av.personId, arr);
    }

    // Other (non-declined) assignments on events that overlap THIS event.
    const overlappingAssignments = await prisma.assignment.findMany({
      where: {
        personId: { in: qualifiedIds },
        status: { in: ["proposed", "confirmed"] },
        eventId: { not: event.id },
        event: {
          startDateTime: { lt: eventEnd },
          endDateTime: { gt: eventStart },
        },
      },
      include: {
        event: {
          select: { title: true, startDateTime: true, endDateTime: true },
        },
      },
    });
    const overlapByPerson = new Map<string, typeof overlappingAssignments>();
    for (const oa of overlappingAssignments) {
      const arr = overlapByPerson.get(oa.personId) ?? [];
      arr.push(oa);
      overlapByPerson.set(oa.personId, arr);
    }

    // Already declined for THIS event — surface so admin doesn't try them again.
    const declinedHere = await prisma.assignment.findMany({
      where: { eventId: event.id, status: "declined" },
      select: { personId: true },
    });
    const declinedSet = new Set(declinedHere.map((d) => d.personId));

    // Pending override requests for this event — admin shouldn't re-send.
    const pendingOverrides = await prisma.overrideRequest.findMany({
      where: {
        eventId: event.id,
        personId: { in: qualifiedIds },
        status: "pending",
        expiresAt: { gt: new Date() },
      },
      select: { id: true, personId: true, createdAt: true },
    });
    const pendingByPerson = new Map(
      pendingOverrides.map((r) => [r.personId, r]),
    );

    // Workload signal: total scheduled hours in a 14-day window centered on
    // this event. Less-loaded candidates rank higher.
    const windowStart = new Date(eventStart);
    windowStart.setDate(windowStart.getDate() - 7);
    const windowEnd = new Date(eventEnd);
    windowEnd.setDate(windowEnd.getDate() + 7);
    const windowAssignments = await prisma.assignment.findMany({
      where: {
        personId: { in: qualifiedIds },
        status: { in: ["proposed", "confirmed"] },
        event: {
          startDateTime: { lt: windowEnd },
          endDateTime: { gt: windowStart },
        },
      },
      include: { event: { select: { startDateTime: true, endDateTime: true } } },
    });
    const hoursByPerson = new Map<string, number>();
    for (const wa of windowAssignments) {
      const hours =
        (wa.event.endDateTime.getTime() - wa.event.startDateTime.getTime()) /
        3600000;
      hoursByPerson.set(
        wa.personId,
        (hoursByPerson.get(wa.personId) ?? 0) + hours,
      );
    }

    const candidates = qualified.map((p) => {
      const conflicts = availByPerson.get(p.id) ?? [];
      const overlaps = overlapByPerson.get(p.id) ?? [];
      const pending = pendingByPerson.get(p.id);
      return {
        person: {
          id: p.id,
          name: p.name,
          email: p.email,
          department: p.department,
        },
        maxHoursPerWeek: p.maxHoursPerWeek,
        currentHoursIn14DayWindow: hoursByPerson.get(p.id) ?? 0,
        availabilityConflicts: conflicts.map((av) => ({
          type: av.type,
          start: av.startDateTime,
          end: av.endDateTime,
        })),
        overlappingAssignments: overlaps.map((oa) => ({
          fromAssignmentId: oa.id,
          eventTitle: oa.event.title,
          start: oa.event.startDateTime,
          end: oa.event.endDateTime,
        })),
        previouslyDeclined: declinedSet.has(p.id),
        pendingOverrideRequest: pending
          ? { id: pending.id, sentAt: pending.createdAt }
          : null,
      };
    });

    // Unblocked + non-declined first, then by current load asc.
    candidates.sort((a, b) => {
      const aBlocked =
        a.availabilityConflicts.length > 0 ||
        a.overlappingAssignments.length > 0 ||
        a.previouslyDeclined;
      const bBlocked =
        b.availabilityConflicts.length > 0 ||
        b.overlappingAssignments.length > 0 ||
        b.previouslyDeclined;
      if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
      return a.currentHoursIn14DayWindow - b.currentHoursIn14DayWindow;
    });

    // Include the event's current active assignments so the polling dialog
    // can show "Currently assigned" without a separate query.
    const currentAssignments = await prisma.assignment.findMany({
      where: { eventId: event.id, status: { not: "declined" } },
      include: assignmentIncludeForResponse,
      orderBy: { event: { startDateTime: "asc" } },
    });

    res.json({
      event: {
        id: event.id,
        title: event.title,
        startDateTime: event.startDateTime,
        endDateTime: event.endDateTime,
        requiredStaffCount: event.requiredStaffCount,
      },
      currentAssignments,
      candidates,
    });
  }),
);

const conflictRefSchema = z.object({
  eventId: z.string().min(1),
  conflictReason: z.string().min(1),
  conflictShortBy: z.number().int().min(0),
});

scheduleRouter.post(
  "/conflicts/accept",
  asyncHandler(async (req, res) => {
    const { eventId, conflictReason, conflictShortBy } = conflictRefSchema.parse(req.body);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });

    // "Accept as partial" commits to the currently-staffed headcount as the
    // event's new normal: drop the requirement to match. Future Generates
    // won't flag this event as understaffed anymore. Audit-only acknowledge
    // (without changing the requirement) is no longer offered — admins who
    // want the higher staffing target should use Resolve to fill the gap.
    const currentAssignedCount = await prisma.assignment.count({
      where: { eventId, status: { not: "declined" } },
    });
    if (currentAssignedCount < 1) {
      throw new HttpError(
        409,
        "Cannot accept partial coverage with zero assignments — assign at least one person first, or Cancel the event.",
      );
    }
    if (currentAssignedCount >= event.requiredStaffCount) {
      throw new HttpError(
        409,
        "Event is already fully staffed; nothing to accept.",
      );
    }

    const previousRequiredStaffCount = event.requiredStaffCount;
    const newRequiredStaffCount = currentAssignedCount;

    const [, entry] = await prisma.$transaction([
      prisma.event.update({
        where: { id: eventId },
        data: { requiredStaffCount: newRequiredStaffCount },
      }),
      prisma.archiveEntry.create({
        data: {
          kind: "accepted_conflict",
          eventId,
          conflictReason,
          conflictShortBy,
          previousRequiredStaffCount,
          newRequiredStaffCount,
        },
      }),
    ]);

    res.status(201).json({
      archiveEntryId: entry.id,
      previousRequiredStaffCount,
      newRequiredStaffCount,
    });
  }),
);

const cancelSchema = conflictRefSchema.extend({
  reason: z.string().trim().min(1, "Reason is required").max(1000),
});

scheduleRouter.post(
  "/conflicts/cancel",
  asyncHandler(async (req, res) => {
    const { eventId, conflictReason, conflictShortBy, reason } =
      cancelSchema.parse(req.body);

    const event = await prisma.event.findUniqueOrThrow({
      where: { id: eventId },
    });
    if (event.cancelledAt) {
      throw new HttpError(409, "Event is already cancelled");
    }

    const activeAssignments = await prisma.assignment.findMany({
      where: { eventId, status: { not: "declined" } },
      include: { person: { select: { email: true } } },
    });
    const assignedCount = activeAssignments.length;

    // Partial coverage path: at least one person is on the event but not
    // enough. Reduce the requirement to match actual coverage — the event
    // stays, assignments stay, no Outlook cleanup needed.
    if (assignedCount > 0) {
      const previousRequired = event.requiredStaffCount;
      await prisma.$transaction([
        prisma.event.update({
          where: { id: eventId },
          data: { requiredStaffCount: assignedCount },
        }),
        prisma.archiveEntry.create({
          data: {
            kind: "reduced_requirement",
            eventId,
            reason,
            conflictReason,
            conflictShortBy,
            previousRequiredStaffCount: previousRequired,
            newRequiredStaffCount: assignedCount,
          },
        }),
      ]);

      res.json({
        action: "reduced",
        previousRequiredStaffCount: previousRequired,
        newRequiredStaffCount: assignedCount,
      });
      return;
    }

    // Full cancel path: nobody assigned at all. Mark event cancelled. (No
    // assignments to clean up, no Outlook events to delete in this branch.)
    await prisma.$transaction([
      prisma.event.update({
        where: { id: eventId },
        data: { cancelledAt: new Date(), cancellationReason: reason },
      }),
      prisma.archiveEntry.create({
        data: {
          kind: "cancelled_event",
          eventId,
          reason,
          conflictReason,
          conflictShortBy,
        },
      }),
    ]);

    res.json({
      action: "cancelled",
      cancelledEventId: eventId,
    });
  }),
);

const assignSchema = z.object({
  personId: z.string().min(1),
  /** Optional — when set, atomically removes this person's existing
   *  (non-declined) assignment for the event before assigning `personId`.
   *  Used by the "Event is fully staffed → replace someone?" confirm flow. */
  replacePersonId: z.string().min(1).optional(),
});

scheduleRouter.post(
  "/events/:eventId/assign",
  asyncHandler(async (req, res) => {
    const { personId, replacePersonId } = assignSchema.parse(req.body);
    const eventId = req.params.eventId;

    const [event, person, existing] = await Promise.all([
      prisma.event.findUniqueOrThrow({
        where: { id: eventId },
        include: { requiredLabels: { select: { id: true } } },
      }),
      prisma.person.findUniqueOrThrow({
        where: { id: personId },
        include: { labels: { select: { id: true } } },
      }),
      prisma.assignment.findUnique({
        where: { eventId_personId: { eventId, personId } },
      }),
    ]);

    if (event.cancelledAt) {
      throw new HttpError(409, "Event is cancelled");
    }
    const personLabels = new Set(person.labels.map((l) => l.id));
    const missing = event.requiredLabels.filter(
      (l) => !personLabels.has(l.id),
    );
    if (missing.length > 0) {
      throw new HttpError(
        409,
        `${person.name} is missing required label(s) for this event.`,
      );
    }

    if (existing && existing.status !== "declined") {
      throw new HttpError(
        409,
        `${person.name} is already assigned to this event.`,
      );
    }

    // Capacity guard — without it, "Add" / "Reassign" silently over-staffs an
    // already-full event. The frontend recognizes `code: EVENT_FULLY_STAFFED`
    // and prompts the admin to pick someone to replace, then retries with
    // `replacePersonId` set.
    const currentRoster = await prisma.assignment.findMany({
      where: { eventId, status: { not: "declined" } },
      include: { person: { select: { id: true, name: true } } },
    });
    // The new assignment would add 1 to the roster (unless replacePersonId
    // removes one first).
    const rosterAfterReplace = replacePersonId
      ? currentRoster.filter((a) => a.personId !== replacePersonId)
      : currentRoster;
    if (rosterAfterReplace.length >= event.requiredStaffCount) {
      res.status(409).json({
        error: "EventFullyStaffed",
        code: "EVENT_FULLY_STAFFED",
        message: `Event already has ${currentRoster.length} of ${event.requiredStaffCount} assigned. Pick someone to replace, or use Cancel & archive to reduce the requirement.`,
        currentAssignments: currentRoster.map((a) => ({
          assignmentId: a.id,
          personId: a.personId,
          personName: a.person.name,
          status: a.status,
        })),
      });
      return;
    }

    // Validate the replace target — must currently hold a non-declined
    // assignment on this event.
    if (replacePersonId) {
      const target = currentRoster.find((a) => a.personId === replacePersonId);
      if (!target) {
        throw new HttpError(
          409,
          "The person being replaced is not currently assigned to this event.",
        );
      }
    }

    // Atomic: remove the displaced person (if any) AND propose the new one.
    // Delete (rather than decline) so the solver can suggest them again later;
    // admin's intent here is "swap them out", not "they refused".
    await prisma.$transaction(async (tx) => {
      if (replacePersonId) {
        await tx.assignment.delete({
          where: {
            eventId_personId: { eventId, personId: replacePersonId },
          },
        });
      }
      if (existing && existing.status === "declined") {
        await tx.assignment.update({
          where: { id: existing.id },
          data: {
            status: "proposed",
            externalEventId: null,
            syncedToOutlookAt: null,
          },
        });
      } else if (!existing) {
        await tx.assignment.create({
          data: { eventId, personId, status: "proposed" },
        });
      }
    });

    const updated = await prisma.assignment.findMany({
      where: { eventId, status: { not: "declined" } },
      include: assignmentIncludeForResponse,
      orderBy: { event: { startDateTime: "asc" } },
    });
    res.json({ updatedAssignments: updated });
  }),
);

const moveSchema = z.object({ toEventId: z.string().min(1) });

scheduleRouter.post(
  "/assignments/:id/move",
  asyncHandler(async (req, res) => {
    const { toEventId } = moveSchema.parse(req.body);
    const fromAssignmentId = req.params.id;

    const fromAssignment = await prisma.assignment.findUniqueOrThrow({
      where: { id: fromAssignmentId },
      include: { person: { select: { id: true, email: true, name: true } } },
    });
    if (fromAssignment.status === "declined") {
      throw new HttpError(409, "Source assignment is already declined");
    }
    if (fromAssignment.eventId === toEventId) {
      throw new HttpError(400, "Source and target events are the same");
    }

    const [toEvent, existingOnTarget] = await Promise.all([
      prisma.event.findUniqueOrThrow({
        where: { id: toEventId },
        include: { requiredLabels: { select: { id: true } } },
      }),
      prisma.assignment.findUnique({
        where: {
          eventId_personId: {
            eventId: toEventId,
            personId: fromAssignment.person.id,
          },
        },
      }),
    ]);

    if (toEvent.cancelledAt) {
      throw new HttpError(409, "Target event is cancelled");
    }

    // Verify the person qualifies for the target.
    const person = await prisma.person.findUniqueOrThrow({
      where: { id: fromAssignment.person.id },
      include: { labels: { select: { id: true } } },
    });
    const personLabels = new Set(person.labels.map((l) => l.id));
    const missing = toEvent.requiredLabels.filter(
      (l) => !personLabels.has(l.id),
    );
    if (missing.length > 0) {
      throw new HttpError(
        409,
        `${person.name} is missing required label(s) for the target event.`,
      );
    }

    if (
      existingOnTarget &&
      existingOnTarget.status !== "declined"
    ) {
      throw new HttpError(
        409,
        `${person.name} is already assigned to the target event.`,
      );
    }

    const fromEventId = fromAssignment.eventId;

    // Re-fetch the source's externalEventId atomically with the status flip
    // (audit #3) — a concurrent /confirm could have set a fresh
    // externalEventId between our initial read and now, and the cleanup
    // below must target the current value, not the stale one.
    const { externalEventIdToCleanup } = await prisma.$transaction(
      async (tx) => {
        const fresh = await tx.assignment.findUniqueOrThrow({
          where: { id: fromAssignment.id },
        });
        // Conditional flip — only proceed if still not declined.
        const flipped = await tx.assignment.updateMany({
          where: { id: fresh.id, status: { not: "declined" } },
          data: {
            status: "declined",
            externalEventId: null,
            syncedToOutlookAt: null,
          },
        });
        if (flipped.count === 0) {
          throw new HttpError(
            409,
            "Source assignment was changed by another request mid-flight. Refresh and retry.",
          );
        }
        await tx.archiveEntry.create({
          data: {
            kind: "declined_assignment",
            eventId: fromEventId,
            personId: fromAssignment.person.id,
            // Capture the target event's title at write-time so the archive
            // stays readable even if the target is later renamed or cancelled.
            reason: `Moved to "${toEvent.title}"`,
          },
        });
        // Create or un-decline on the target.
        if (existingOnTarget && existingOnTarget.status === "declined") {
          await tx.assignment.update({
            where: { id: existingOnTarget.id },
            data: {
              status: "proposed",
              externalEventId: null,
              syncedToOutlookAt: null,
            },
          });
        } else {
          await tx.assignment.create({
            data: {
              eventId: toEventId,
              personId: fromAssignment.person.id,
              status: "proposed",
            },
          });
        }
        return { externalEventIdToCleanup: fresh.externalEventId };
      },
    );

    // Outlook cleanup after the transaction. Orbit state is already correct;
    // an Outlook failure leaves an orphan event but doesn't roll back the
    // move (the user wanted the move and we honored it).
    if (externalEventIdToCleanup) {
      try {
        await deleteCalendarEvent(
          fromAssignment.person.email,
          externalEventIdToCleanup,
        );
      } catch (err) {
        throw new HttpError(
          502,
          `Move succeeded in Orbit but the source Outlook event couldn't be removed: ${err instanceof Error ? err.message : err}. Delete it from the user's calendar manually.`,
        );
      }
    }

    const updated = await prisma.assignment.findMany({
      where: {
        eventId: { in: [fromEventId, toEventId] },
        status: { not: "declined" },
      },
      include: assignmentIncludeForResponse,
      orderBy: { event: { startDateTime: "asc" } },
    });
    res.json({ updatedAssignments: updated, fromEventId, toEventId });
  }),
);

const requestOverrideSchema = z.object({
  personId: z.string().min(1),
  message: z.string().trim().max(2000).optional(),
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(d: Date): string {
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderOverrideEmail(args: {
  recipientName: string;
  eventTitle: string;
  eventStart: Date;
  eventEnd: Date;
  eventLocation: string | null;
  blockingType: string;
  blockingStart: Date;
  blockingEnd: Date;
  customMessage: string | null;
  acceptUrl: string;
  declineUrl: string;
}): string {
  const {
    recipientName,
    eventTitle,
    eventStart,
    eventEnd,
    eventLocation,
    blockingType,
    blockingStart,
    blockingEnd,
    customMessage,
    acceptUrl,
    declineUrl,
  } = args;
  return `<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1f2937;">
  <h2 style="margin: 0 0 16px;">Coverage request</h2>
  <p>Hi ${escapeHtml(recipientName)},</p>
  <p>You're the only qualified person for the following event, but you're currently blocked. Can you cover it?</p>
  <div style="border: 1px solid #e5e7eb; padding: 16px; border-radius: 8px; margin: 16px 0; background: #f9fafb;">
    <div style="font-weight: 600; font-size: 16px;">${escapeHtml(eventTitle)}</div>
    <div style="color: #4b5563; margin-top: 4px;">${escapeHtml(formatDateTime(eventStart))} – ${escapeHtml(formatDateTime(eventEnd))}</div>
    ${eventLocation ? `<div style="color: #4b5563; margin-top: 4px;">📍 ${escapeHtml(eventLocation)}</div>` : ""}
  </div>
  <p>Your conflict: <strong>${escapeHtml(blockingType)}</strong> from ${escapeHtml(formatDateTime(blockingStart))} to ${escapeHtml(formatDateTime(blockingEnd))}.</p>
  ${customMessage ? `<blockquote style="border-left: 3px solid #d1d5db; padding-left: 12px; margin: 16px 0; color: #4b5563;">${escapeHtml(customMessage)}</blockquote>` : ""}
  <p style="margin: 24px 0;">
    <a href="${acceptUrl}" style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-right: 8px; font-weight: 500;">Yes, I'll cover it</a>
    <a href="${declineUrl}" style="background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 500;">No, decline</a>
  </p>
  <p style="font-size: 12px; color: #6b7280;">If you accept, your conflicting ${escapeHtml(blockingType)} window will be adjusted to skip this event so the rest of your time off is preserved. This link expires in 7 days.</p>
  <p style="font-size: 12px; color: #9ca3af; margin-top: 32px;">— Orbit Scheduler</p>
</body></html>`;
}

scheduleRouter.post(
  "/events/:eventId/request-override",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new HttpError(401, "Unauthenticated");
    const { personId, message } = requestOverrideSchema.parse(req.body);
    const eventId = req.params.eventId;

    const [event, person] = await Promise.all([
      prisma.event.findUniqueOrThrow({
        where: { id: eventId },
        include: { requiredLabels: { select: { id: true, name: true } } },
      }),
      prisma.person.findUniqueOrThrow({
        where: { id: personId },
        include: { labels: { select: { id: true } } },
      }),
    ]);
    if (event.cancelledAt) {
      throw new HttpError(409, "Event is cancelled.");
    }

    // Verify qualified.
    const personLabels = new Set(person.labels.map((l) => l.id));
    const missing = event.requiredLabels.filter(
      (l) => !personLabels.has(l.id),
    );
    if (missing.length > 0) {
      throw new HttpError(
        409,
        `${person.name} doesn't have all required labels for this event.`,
      );
    }

    // Find the blocking availability (must exist — if there's no block, admin
    // should just add the person directly).
    const blocking = await prisma.availability.findFirst({
      where: {
        personId,
        startDateTime: { lt: event.endDateTime },
        endDateTime: { gt: event.startDateTime },
      },
      orderBy: { startDateTime: "asc" },
    });
    if (!blocking) {
      throw new HttpError(
        400,
        `${person.name} isn't blocked by availability for this event — just add them directly.`,
      );
    }

    // One pending request per (event, person) at a time.
    const existing = await prisma.overrideRequest.findFirst({
      where: { eventId, personId, status: "pending" },
    });
    if (existing) {
      throw new HttpError(
        409,
        `An override request is already pending for ${person.name}.`,
      );
    }

    // Create the request row, then attempt to send the email. If sending fails,
    // delete the row so the UI doesn't show a phantom pending request.
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const created = await prisma.overrideRequest.create({
      data: {
        token,
        eventId,
        personId,
        blockingType: blocking.type,
        blockingStart: blocking.startDateTime,
        blockingEnd: blocking.endDateTime,
        message: message ?? null,
        expiresAt,
      },
    });

    const publicUrl =
      process.env.BACKEND_PUBLIC_URL ?? "http://localhost:4000";
    const acceptUrl = `${publicUrl}/api/override/${token}/accept`;
    const declineUrl = `${publicUrl}/api/override/${token}/decline`;

    const html = renderOverrideEmail({
      recipientName: person.name,
      eventTitle: event.title,
      eventStart: event.startDateTime,
      eventEnd: event.endDateTime,
      eventLocation: event.location,
      blockingType: blocking.type,
      blockingStart: blocking.startDateTime,
      blockingEnd: blocking.endDateTime,
      customMessage: message ?? null,
      acceptUrl,
      declineUrl,
    });

    try {
      await sendMail(
        req.user.email,
        [person.email],
        `[Orbit] Cover ${event.title}?`,
        html,
      );
    } catch (err) {
      await prisma.overrideRequest.delete({ where: { id: created.id } });
      throw new HttpError(
        502,
        `Email failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    res.status(201).json({
      id: created.id,
      sentTo: person.email,
      sentAt: created.createdAt,
      expiresAt: created.expiresAt,
    });
  }),
);

scheduleRouter.get(
  "/archive",
  asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const entries = await prisma.archiveEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDateTime: true,
            endDateTime: true,
            cancelledAt: true,
          },
        },
        person: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(entries);
  }),
);

const workloadSchema = z
  .object({
    from: z.string().datetime({ offset: true }).or(z.string().datetime()),
    to: z.string().datetime({ offset: true }).or(z.string().datetime()),
  })
  .refine((v) => new Date(v.to).getTime() > new Date(v.from).getTime(), {
    message: "to must be after from",
    path: ["to"],
  });

// Returns "YYYY-MM-DD" of the Monday of the ISO week containing d (UTC).
// Used to bucket per-week hours for peak-utilization calc.
function isoMondayKey(d: Date): string {
  const utcDay = d.getUTCDay();
  const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay;
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + mondayOffset);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

scheduleRouter.get(
  "/workload",
  asyncHandler(async (req, res) => {
    const { from, to } = workloadSchema.parse(req.query);
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
    const weeksInRange = rangeMs / (7 * 24 * 60 * 60 * 1000);

    // All active people — including ones with zero assignments so admin can
    // see who's under-utilized too.
    const people = await prisma.person.findMany({
      where: { active: true },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        maxHoursPerWeek: true,
      },
      orderBy: { name: "asc" },
    });

    // Proposed + confirmed assignments overlapping the range (declined excluded).
    const assignments = await prisma.assignment.findMany({
      where: {
        status: { in: ["proposed", "confirmed"] },
        event: {
          startDateTime: { lt: rangeEnd },
          endDateTime: { gt: rangeStart },
        },
      },
      include: {
        event: {
          select: { startDateTime: true, endDateTime: true },
        },
      },
    });

    // For each person, sum hours per calendar week so we can compute the PEAK
    // week's utilization (the right thing to compare against a "max h/week"
    // cap — taking total/range_weeks projects the rate and explodes for
    // short ranges).
    const totalsByPerson = new Map<string, number>();
    const countByPerson = new Map<string, number>();
    const weeklyByPerson = new Map<string, Map<string, number>>();
    for (const a of assignments) {
      const hours =
        (a.event.endDateTime.getTime() - a.event.startDateTime.getTime()) /
        3600000;
      totalsByPerson.set(
        a.personId,
        (totalsByPerson.get(a.personId) ?? 0) + hours,
      );
      countByPerson.set(
        a.personId,
        (countByPerson.get(a.personId) ?? 0) + 1,
      );
      // Bucket by the ISO Monday of the event's START. Shifts that cross
      // a week boundary count entirely in the week they started — good
      // enough for the typical single-day shift; revisit if cross-week
      // shifts become common.
      const weekKey = isoMondayKey(a.event.startDateTime);
      let personWeeks = weeklyByPerson.get(a.personId);
      if (!personWeeks) {
        personWeeks = new Map();
        weeklyByPerson.set(a.personId, personWeeks);
      }
      personWeeks.set(weekKey, (personWeeks.get(weekKey) ?? 0) + hours);
    }

    const rows = people.map((p) => {
      const hoursAssigned = totalsByPerson.get(p.id) ?? 0;
      const personWeeks = weeklyByPerson.get(p.id);
      const peakWeeklyHours = personWeeks
        ? Math.max(...personWeeks.values())
        : 0;
      const avgPerWeek = weeksInRange > 0 ? hoursAssigned / weeksInRange : 0;
      // Util is now PEAK week / cap — "in your worst single calendar week,
      // what fraction of your cap did you use?"
      const utilization =
        p.maxHoursPerWeek && p.maxHoursPerWeek > 0
          ? Math.round((peakWeeklyHours / p.maxHoursPerWeek) * 100)
          : null;
      return {
        person: {
          id: p.id,
          name: p.name,
          email: p.email,
          department: p.department,
        },
        maxHoursPerWeek: p.maxHoursPerWeek,
        hoursAssigned: Math.round(hoursAssigned * 10) / 10,
        avgHoursPerWeek: Math.round(avgPerWeek * 10) / 10,
        peakWeeklyHours: Math.round(peakWeeklyHours * 10) / 10,
        utilization,
        assignmentCount: countByPerson.get(p.id) ?? 0,
      };
    });

    const allHours = rows.map((r) => r.hoursAssigned);
    const peopleWithAnyHours = allHours.filter((h) => h > 0).length;
    const totalHours = allHours.reduce((s, h) => s + h, 0);
    const max = allHours.length ? Math.max(...allHours) : 0;
    const min = allHours.length ? Math.min(...allHours) : 0;
    const peopleAtCap = rows.filter(
      (r) => r.utilization != null && r.utilization >= 100,
    ).length;

    res.json({
      range: {
        from: rangeStart,
        to: rangeEnd,
        weeks: Math.round(weeksInRange * 100) / 100,
      },
      summary: {
        totalHours: Math.round(totalHours * 10) / 10,
        averagePerPerson:
          people.length > 0
            ? Math.round((totalHours / people.length) * 10) / 10
            : 0,
        averagePerActivePerson:
          peopleWithAnyHours > 0
            ? Math.round((totalHours / peopleWithAnyHours) * 10) / 10
            : 0,
        minHours: Math.round(min * 10) / 10,
        maxHours: Math.round(max * 10) / 10,
        spreadHours: Math.round((max - min) * 10) / 10,
        peopleTotal: people.length,
        peopleWithAnyHours,
        peopleAtCap,
      },
      rows,
    });
  }),
);
