import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../middleware/error.js";
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
    const { from, to } = req.query;
    const where =
      from || to
        ? {
            startDateTime: from ? { gte: new Date(String(from)) } : undefined,
            endDateTime: to ? { lte: new Date(String(to)) } : undefined,
          }
        : undefined;
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
    await prisma.event.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
