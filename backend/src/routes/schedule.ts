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

    // 1. Gather events that overlap the requested range.
    const events = await prisma.event.findMany({
      where: {
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

    // 6. Persist: drop existing proposed assignments for these events,
    //    then insert the new ones.
    const eventIds = events.map((e) => e.id);
    if (eventIds.length > 0) {
      await prisma.assignment.deleteMany({
        where: { eventId: { in: eventIds }, status: "proposed" },
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

    // 7. Return assignments hydrated with event + person info.
    const hydrated = await prisma.assignment.findMany({
      where: { eventId: { in: eventIds } },
      include: {
        event: { select: { id: true, title: true, startDateTime: true, endDateTime: true, priorityTier: true } },
        person: { select: { id: true, name: true, email: true } },
      },
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
