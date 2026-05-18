import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { createPersonSchema, updatePersonSchema } from "../schemas/person.js";
import { deleteCalendarEvent } from "../lib/graph.js";

export const peopleRouter = Router();

const personInclude = {
  labels: { select: { id: true, name: true } },
  // Counts used by the People page to decide whether a person can be hard-
  // deleted (zero history) vs. only deactivated (some history to preserve).
  _count: {
    select: { assignments: true, availability: true },
  },
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

    // Deactivation cascade (audit #5): when an active person flips to
    // inactive, decline their future non-declined assignments and clean up
    // any Outlook events. Without this, the row disappears from the Schedule
    // grid (which only renders active people) while the actual shifts and
    // Outlook calendar entries stay behind orphaned.
    let deactivationSummary:
      | { declined: number; outlookCleanupFailures: string[] }
      | undefined;
    if (rest.active === false) {
      const current = await prisma.person.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { active: true, email: true },
      });
      if (current.active) {
        const futureAssignments = await prisma.assignment.findMany({
          where: {
            personId: req.params.id,
            status: { not: "declined" },
            event: { startDateTime: { gt: new Date() } },
          },
        });
        const outlookCleanupFailures: string[] = [];
        for (const a of futureAssignments) {
          // Atomic flip (same pattern as /assignments/:id/decline).
          const externalEventId = await prisma.$transaction(async (tx) => {
            const fresh = await tx.assignment.findUnique({
              where: { id: a.id },
            });
            if (!fresh || fresh.status === "declined") return null;
            const flipped = await tx.assignment.updateMany({
              where: { id: a.id, status: { not: "declined" } },
              data: {
                status: "declined",
                externalEventId: null,
                syncedToOutlookAt: null,
              },
            });
            if (flipped.count === 0) return null;
            await tx.archiveEntry.create({
              data: {
                kind: "declined_assignment",
                eventId: a.eventId,
                personId: req.params.id,
                reason: "Person deactivated",
              },
            });
            return fresh.externalEventId;
          });
          if (externalEventId) {
            try {
              await deleteCalendarEvent(current.email, externalEventId);
            } catch (err) {
              outlookCleanupFailures.push(
                `assignment ${a.id}: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
        }
        deactivationSummary = {
          declined: futureAssignments.length,
          outlookCleanupFailures,
        };
      }
    }

    const person = await prisma.person.update({
      where: { id: req.params.id },
      data: {
        ...rest,
        labels: buildLabelMutation(labelIds, "set"),
      },
      include: personInclude,
    });

    res.json(deactivationSummary ? { ...person, _deactivation: deactivationSummary } : person);
  }),
);

peopleRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    // Hard-delete is only safe when the person has no history — otherwise
    // the cascade wipes archive entries, assignments, availability records,
    // and override requests. Admins who want to remove someone with history
    // should Deactivate (PATCH active=false) instead.
    const [assignmentCount, availabilityCount, archiveCount, overrideCount] =
      await Promise.all([
        prisma.assignment.count({ where: { personId: req.params.id } }),
        prisma.availability.count({ where: { personId: req.params.id } }),
        prisma.archiveEntry.count({ where: { personId: req.params.id } }),
        prisma.overrideRequest.count({ where: { personId: req.params.id } }),
      ]);
    if (
      assignmentCount + availabilityCount + archiveCount + overrideCount >
      0
    ) {
      throw new HttpError(
        409,
        `This person has ${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"}, ${availabilityCount} availability entr${availabilityCount === 1 ? "y" : "ies"}, ${archiveCount} archive entr${archiveCount === 1 ? "y" : "ies"}, and ${overrideCount} override request${overrideCount === 1 ? "" : "s"} on record. Deactivate (PATCH active=false) instead of Delete to preserve history.`,
      );
    }
    await prisma.person.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);
