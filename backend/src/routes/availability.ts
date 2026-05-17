import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import {
  createAvailabilitySchema,
  updateAvailabilitySchema,
} from "../schemas/availability.js";
import {
  getSchedule,
  getValidAccessToken,
  graphDateToJsDate,
} from "../lib/graph.js";

export const availabilityRouter = Router();

const syncFromOutlookSchema = z
  .object({
    personIds: z.array(z.string()).min(1).max(20),
    from: z.string().datetime({ offset: true }).or(z.string().datetime()),
    to: z.string().datetime({ offset: true }).or(z.string().datetime()),
  })
  .refine((v) => new Date(v.to).getTime() > new Date(v.from).getTime(), {
    message: "to must be after from",
    path: ["to"],
  });

availabilityRouter.post(
  "/sync-from-outlook",
  asyncHandler(async (req, res) => {
    if (!req.user) throw new HttpError(401, "Unauthenticated");
    const { personIds, from, to } = syncFromOutlookSchema.parse(req.body);
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);

    const people = await prisma.person.findMany({
      where: { id: { in: personIds } },
      select: { id: true, email: true, name: true },
    });
    if (people.length === 0) {
      res.json({ synced: 0, perPerson: [] });
      return;
    }
    const peopleByEmail = new Map(
      people.map((p) => [p.email.toLowerCase(), p]),
    );
    const emails = people.map((p) => p.email);

    const accessToken = await getValidAccessToken(req.user.sessionId);
    const schedules = await getSchedule(accessToken, emails, rangeStart, rangeEnd);

    const perPerson: Array<{
      personId: string;
      email: string;
      status: "synced" | "error";
      count: number;
      error?: string;
    }> = [];

    for (const sched of schedules) {
      const person = peopleByEmail.get(sched.scheduleId.toLowerCase());
      if (!person) continue;

      if (sched.error) {
        perPerson.push({
          personId: person.id,
          email: person.email,
          status: "error",
          count: 0,
          error: `${sched.error.responseCode}: ${sched.error.message}`,
        });
        continue;
      }

      // Replace existing outlook_sync rows for this person that overlap the
      // window — getSchedule's response is the new source of truth for [from, to].
      await prisma.availability.deleteMany({
        where: {
          personId: person.id,
          source: "outlook_sync",
          startDateTime: { lt: rangeEnd },
          endDateTime: { gt: rangeStart },
        },
      });

      const items = (sched.scheduleItems ?? []).filter(
        (it) => it.status === "busy" || it.status === "oof",
      );

      if (items.length > 0) {
        await prisma.availability.createMany({
          data: items.map((it) => ({
            personId: person.id,
            type: it.status === "oof" ? "vacation" : "blocked",
            startDateTime: graphDateToJsDate(it.start),
            endDateTime: graphDateToJsDate(it.end),
            source: "outlook_sync",
          })),
        });
      }

      perPerson.push({
        personId: person.id,
        email: person.email,
        status: "synced",
        count: items.length,
      });
    }

    res.json({
      synced: perPerson
        .filter((p) => p.status === "synced")
        .reduce((sum, p) => sum + p.count, 0),
      perPerson,
    });
  }),
);

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
