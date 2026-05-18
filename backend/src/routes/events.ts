import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { createEventSchema, updateEventSchema } from "../schemas/event.js";

export const eventsRouter = Router();

const eventInclude = {
  requiredLabels: { select: { id: true, name: true } },
  _count: { select: { assignments: true } },
} as const;

function buildLabelMutation(labelIds: string[] | undefined, mode: "set" | "create") {
  if (labelIds === undefined) return undefined;
  if (mode === "create") return { connect: labelIds.map((id) => ({ id })) };
  return { set: labelIds.map((id) => ({ id })) };
}

eventsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to, includeCancelled } = req.query;
    // Default-exclude cancelled events — they aren't part of any active
    // schedule. The Events admin page opts in with ?includeCancelled=true so
    // it can surface and restore them.
    const wantCancelled = String(includeCancelled ?? "") === "true";
    const where: Record<string, unknown> = {};
    if (!wantCancelled) where.cancelledAt = null;
    if (from) where.startDateTime = { gte: new Date(String(from)) };
    if (to) where.endDateTime = { lte: new Date(String(to)) };
    const events = await prisma.event.findMany({
      where,
      orderBy: { startDateTime: "asc" },
      include: eventInclude,
    });
    res.json(events);
  }),
);

eventsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const event = await prisma.event.findUniqueOrThrow({
      where: { id: req.params.id },
      include: eventInclude,
    });
    res.json(event);
  }),
);

eventsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { requiredLabelIds, ...rest } = createEventSchema.parse(req.body);
    const event = await prisma.event.create({
      data: {
        ...rest,
        startDateTime: new Date(rest.startDateTime),
        endDateTime: new Date(rest.endDateTime),
        requiredLabels: buildLabelMutation(requiredLabelIds, "create"),
      },
      include: eventInclude,
    });
    res.status(201).json(event);
  }),
);

eventsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { requiredLabelIds, ...rest } = updateEventSchema.parse(req.body);
    const event = await prisma.event.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        startDateTime: rest.startDateTime ? new Date(rest.startDateTime) : undefined,
        endDateTime: rest.endDateTime ? new Date(rest.endDateTime) : undefined,
        requiredLabels: buildLabelMutation(requiredLabelIds, "set"),
      },
      include: eventInclude,
    });
    res.json(event);
  }),
);

eventsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    // Hard-delete is only safe when the event has no history. Otherwise the
    // Prisma cascade would wipe audit entries, assignments, and overrides —
    // including the trail that explains past staffing decisions.
    // Admins who want to remove a "live" event should use Cancel & archive
    // (sets cancelledAt, preserves history, can be restored).
    const [assignmentCount, archiveCount, overrideCount] = await Promise.all([
      prisma.assignment.count({ where: { eventId: req.params.id } }),
      prisma.archiveEntry.count({ where: { eventId: req.params.id } }),
      prisma.overrideRequest.count({ where: { eventId: req.params.id } }),
    ]);
    if (assignmentCount + archiveCount + overrideCount > 0) {
      throw new HttpError(
        409,
        `This event has ${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"}, ${archiveCount} archive entr${archiveCount === 1 ? "y" : "ies"}, and ${overrideCount} override request${overrideCount === 1 ? "" : "s"}. Use Cancel & archive instead of Delete to preserve history.`,
      );
    }
    await prisma.event.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// Restore a cancelled event — clears cancelledAt + cancellationReason so the
// solver picks it back up on the next Generate. Inverse of the Schedule's
// "Cancel & archive" action.
eventsRouter.post(
  "/:id/restore",
  asyncHandler(async (req, res) => {
    const event = await prisma.event.update({
      where: { id: req.params.id },
      data: { cancelledAt: null, cancellationReason: null },
      include: eventInclude,
    });
    res.json(event);
  }),
);
