import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { generateScheduleSchema } from "../schemas/schedule.js";

export const scheduleRouter = Router();

const SCHEDULER_URL = process.env.SCHEDULER_URL ?? "http://localhost:8000";

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
