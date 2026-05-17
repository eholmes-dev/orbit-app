import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../middleware/error.js";
import {
  createAvailabilitySchema,
  updateAvailabilitySchema,
} from "../schemas/availability.js";

export const availabilityRouter = Router();

availabilityRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { personId, from, to } = req.query;
    const records = await prisma.availability.findMany({
      where: {
        personId: personId ? String(personId) : undefined,
        ...(from || to
          ? {
              AND: [
                from ? { endDateTime: { gte: new Date(String(from)) } } : {},
                to ? { startDateTime: { lte: new Date(String(to)) } } : {},
              ],
            }
          : {}),
      },
      orderBy: { startDateTime: "asc" },
      include: { person: { select: { id: true, name: true } } },
    });
    res.json(records);
  }),
);

availabilityRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createAvailabilitySchema.parse(req.body);
    const record = await prisma.availability.create({
      data: {
        ...data,
        startDateTime: new Date(data.startDateTime),
        endDateTime: new Date(data.endDateTime),
      },
      include: { person: { select: { id: true, name: true } } },
    });
    res.status(201).json(record);
  }),
);

availabilityRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updateAvailabilitySchema.parse(req.body);
    const record = await prisma.availability.update({
      where: { id: req.params.id },
      data: {
        ...data,
        startDateTime: data.startDateTime ? new Date(data.startDateTime) : undefined,
        endDateTime: data.endDateTime ? new Date(data.endDateTime) : undefined,
      },
      include: { person: { select: { id: true, name: true } } },
    });
    res.json(record);
  }),
);

availabilityRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.availability.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
