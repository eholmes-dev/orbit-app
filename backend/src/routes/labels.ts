import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../middleware/error.js";
import { createLabelSchema, updateLabelSchema } from "../schemas/label.js";

export const labelsRouter = Router();

labelsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const labels = await prisma.label.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { people: true, events: true } } },
    });
    res.json(labels);
  }),
);

labelsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const label = await prisma.label.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        _count: { select: { people: true, events: true } },
        people: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(label);
  }),
);

labelsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createLabelSchema.parse(req.body);
    const label = await prisma.label.create({ data });
    res.status(201).json(label);
  }),
);

labelsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updateLabelSchema.parse(req.body);
    const label = await prisma.label.update({ where: { id: req.params.id }, data });
    res.json(label);
  }),
);

labelsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.label.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
