import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler } from "../middleware/error.js";
import { createPersonSchema, updatePersonSchema } from "../schemas/person.js";

export const peopleRouter = Router();

const personInclude = {
  labels: { select: { id: true, name: true } },
} as const;

function buildLabelMutation(labelIds: string[] | undefined, mode: "set" | "create") {
  if (labelIds === undefined) return undefined;
  if (mode === "create") {
    return { connect: labelIds.map((id) => ({ id })) };
  }
  return { set: labelIds.map((id) => ({ id })) };
}

peopleRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const people = await prisma.person.findMany({
      orderBy: { name: "asc" },
      include: personInclude,
    });
    res.json(people);
  }),
);

peopleRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const person = await prisma.person.findUniqueOrThrow({
      where: { id: req.params.id },
      include: personInclude,
    });
    res.json(person);
  }),
);

peopleRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { labelIds, ...rest } = createPersonSchema.parse(req.body);
    const person = await prisma.person.create({
      data: {
        ...rest,
        labels: buildLabelMutation(labelIds, "create"),
      },
      include: personInclude,
    });
    res.status(201).json(person);
  }),
);

peopleRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { labelIds, ...rest } = updatePersonSchema.parse(req.body);
    const person = await prisma.person.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        labels: buildLabelMutation(labelIds, "set"),
      },
      include: personInclude,
    });
    res.json(person);
  }),
);

peopleRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await prisma.person.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
