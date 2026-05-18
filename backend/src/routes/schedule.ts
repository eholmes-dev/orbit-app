import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { generateScheduleSchema } from "../schemas/schedule.js";
import {
  createCalendarEvent,
  deleteCalendarEvent,
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
      include: {
        event: { select: { id: true, title: true, startDateTime: true, endDateTime: true, priorityTier: true } },
        person: { select: { id: true, name: true, email: true } },
      },
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
      assignments: hydrated,
      conflicts: solverResult.conflicts,
      warnings: solverResult.warnings,
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
        const bodyText =
          `Tier ${a.event.priorityTier} shift.\n` +
          `Assigned to ${a.person.name} by Orbit Scheduler.`;
        const externalEventId = await createCalendarEvent(a.person.email, {
          subject: a.event.title,
          start: a.event.startDateTime,
          end: a.event.endDateTime,
          bodyText,
        });
        await prisma.assignment.update({
          where: { id: a.id },
          data: {
            status: "confirmed",
            externalEventId,
            syncedToOutlookAt: new Date(),
          },
        });
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

    const a = await prisma.assignment.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        event: { select: { id: true } },
        person: { select: { id: true, email: true } },
      },
    });

    const alreadyDeclined = a.status === "declined";

    // If this assignment had been pushed to Outlook, remove the calendar event
    // first. (Won't fire on already-declined rows since externalEventId is
    // cleared at decline time.)
    if (a.status === "confirmed" && a.externalEventId) {
      try {
        await deleteCalendarEvent(a.person.email, a.externalEventId);
      } catch (err) {
        throw new HttpError(
          502,
          `Failed to remove Outlook event: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Idempotent: flipping an already-declined row is a no-op for the status
    // but we still want the rest of the handler (replacement creation,
    // response) to run.
    if (!alreadyDeclined) {
      await prisma.assignment.update({
        where: { id: a.id },
        data: {
          status: "declined",
          externalEventId: null,
          syncedToOutlookAt: null,
        },
      });
      // Audit log entry — only on the actual flip, not on idempotent re-calls.
      await prisma.archiveEntry.create({
        data: {
          kind: "declined_assignment",
          eventId: a.event.id,
          personId: a.person.id,
        },
      });
    }

    // If admin picked a replacement, create a new proposed assignment now.
    // Stays as proposed even when the original was confirmed — admin reviews
    // and re-syncs.
    if (replacementPersonId) {
      try {
        await prisma.assignment.create({
          data: {
            eventId: a.event.id,
            personId: replacementPersonId,
            status: "proposed",
          },
        });
      } catch (err) {
        // (eventId, personId) uniqueness — replacement was already assigned
        // or declined for this event in the past.
        const code = (err as { code?: string }).code;
        if (code === "P2002") {
          throw new HttpError(
            409,
            "That person already has an assignment (or decline) for this event.",
          );
        }
        throw err;
      }
    }

    const updated = await prisma.assignment.findMany({
      where: { eventId: a.event.id, status: { not: "declined" } },
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
      res.json({ candidates: [] });
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

    res.json({ candidates });
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
    // Verify the event exists (404 if not).
    await prisma.event.findUniqueOrThrow({ where: { id: eventId } });

    const entry = await prisma.archiveEntry.create({
      data: {
        kind: "accepted_conflict",
        eventId,
        conflictReason,
        conflictShortBy,
      },
    });
    res.status(201).json({ archiveEntryId: entry.id });
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

const assignSchema = z.object({ personId: z.string().min(1) });

scheduleRouter.post(
  "/events/:eventId/assign",
  asyncHandler(async (req, res) => {
    const { personId } = assignSchema.parse(req.body);
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

    if (existing) {
      if (existing.status === "declined") {
        // Un-decline → propose. The original decline is reversed by admin intent.
        await prisma.assignment.update({
          where: { id: existing.id },
          data: {
            status: "proposed",
            externalEventId: null,
            syncedToOutlookAt: null,
          },
        });
      } else {
        throw new HttpError(
          409,
          `${person.name} is already assigned to this event.`,
        );
      }
    } else {
      await prisma.assignment.create({
        data: { eventId, personId, status: "proposed" },
      });
    }

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

    // Clean up source Outlook event if it was confirmed.
    if (
      fromAssignment.status === "confirmed" &&
      fromAssignment.externalEventId
    ) {
      try {
        await deleteCalendarEvent(
          fromAssignment.person.email,
          fromAssignment.externalEventId,
        );
      } catch (err) {
        throw new HttpError(
          502,
          `Failed to remove source Outlook event: ${err instanceof Error ? err.message : err}. Move aborted.`,
        );
      }
    }

    const fromEventId = fromAssignment.eventId;

    await prisma.$transaction(async (tx) => {
      // Decline the source assignment.
      await tx.assignment.update({
        where: { id: fromAssignment.id },
        data: {
          status: "declined",
          externalEventId: null,
          syncedToOutlookAt: null,
        },
      });
      await tx.archiveEntry.create({
        data: {
          kind: "declined_assignment",
          eventId: fromEventId,
          personId: fromAssignment.person.id,
          reason: `Moved to event ${toEventId}`,
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
    });

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
