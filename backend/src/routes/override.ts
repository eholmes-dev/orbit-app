import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { asyncHandler } from "../middleware/error.js";

/**
 * Public router for override-request Accept/Decline links. Mounted WITHOUT
 * requireAuth in index.ts — the recipient won't be signed in to Orbit; the
 * URL token is the bearer secret.
 */
export const overrideRouter = Router();

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderResponsePage(
  title: string,
  message: string,
  tone: "success" | "info" | "error" = "info",
): string {
  const color =
    tone === "success" ? "#10b981" : tone === "error" ? "#ef4444" : "#374151";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)} · Orbit</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 64px auto; padding: 32px; text-align: center; color: #1f2937;">
  <div style="font-size: 56px; color: ${color}; margin-bottom: 12px;">${tone === "success" ? "✓" : tone === "error" ? "✕" : "·"}</div>
  <h2 style="margin: 0 0 12px; font-weight: 600;">${escapeHtml(title)}</h2>
  <p style="margin: 0; color: #6b7280; line-height: 1.5;">${message}</p>
  <p style="margin-top: 40px; font-size: 12px; color: #9ca3af;">Orbit Scheduler</p>
</body></html>`;
}

/**
 * Carve out a hole in the person's overlapping availability rows so the event
 * window is no longer blocked. Each overlapping row is either:
 *   - entirely inside the event window     → delete
 *   - starts before & ends after the event → split into two rows
 *   - starts before, ends inside           → trim end to event start
 *   - starts inside, ends after            → trim start to event end
 */
async function trimAvailabilityForEvent(
  tx: Tx,
  personId: string,
  eventStart: Date,
  eventEnd: Date,
): Promise<void> {
  const overlapping = await tx.availability.findMany({
    where: {
      personId,
      startDateTime: { lt: eventEnd },
      endDateTime: { gt: eventStart },
    },
  });

  for (const av of overlapping) {
    const startsBefore = av.startDateTime < eventStart;
    const endsAfter = av.endDateTime > eventEnd;

    if (startsBefore && endsAfter) {
      // Shrink existing to end at eventStart, create a new row for after.
      await tx.availability.update({
        where: { id: av.id },
        data: { endDateTime: eventStart },
      });
      await tx.availability.create({
        data: {
          personId,
          type: av.type,
          source: av.source,
          startDateTime: eventEnd,
          endDateTime: av.endDateTime,
        },
      });
    } else if (startsBefore) {
      await tx.availability.update({
        where: { id: av.id },
        data: { endDateTime: eventStart },
      });
    } else if (endsAfter) {
      await tx.availability.update({
        where: { id: av.id },
        data: { startDateTime: eventEnd },
      });
    } else {
      await tx.availability.delete({ where: { id: av.id } });
    }
  }
}

overrideRouter.get(
  "/:token/accept",
  asyncHandler(async (req, res) => {
    const request = await prisma.overrideRequest.findUnique({
      where: { token: req.params.token },
      include: { event: true, person: true },
    });

    if (!request) {
      res
        .status(404)
        .type("html")
        .send(
          renderResponsePage(
            "Link not found",
            "This override request link is invalid or has been removed.",
            "error",
          ),
        );
      return;
    }
    if (request.status === "accepted") {
      res
        .type("html")
        .send(
          renderResponsePage(
            "Already accepted",
            `You already accepted this request${request.respondedAt ? ` on ${request.respondedAt.toLocaleString()}` : ""}. No further action needed.`,
          ),
        );
      return;
    }
    if (request.status === "declined") {
      res
        .type("html")
        .send(
          renderResponsePage(
            "Already declined",
            `You already declined this request${request.respondedAt ? ` on ${request.respondedAt.toLocaleString()}` : ""}. The admin will look for an alternative.`,
          ),
        );
      return;
    }
    if (request.status === "expired" || request.expiresAt < new Date()) {
      if (request.status !== "expired") {
        await prisma.overrideRequest.update({
          where: { id: request.id },
          data: { status: "expired" },
        });
      }
      res
        .type("html")
        .send(
          renderResponsePage(
            "Link expired",
            "This override request has expired. Please contact the scheduling admin if you can still cover this shift.",
            "error",
          ),
        );
      return;
    }
    if (request.event.cancelledAt) {
      res
        .type("html")
        .send(
          renderResponsePage(
            "Event cancelled",
            `"${escapeHtml(request.event.title)}" was cancelled. No action needed.`,
          ),
        );
      return;
    }

    // Re-validate state fresh (audit #8) — between the request being sent and
    // the recipient clicking accept, the admin may have: deactivated the
    // person, removed required labels, or fully staffed the event another
    // way. Blindly creating the assignment would silently violate those
    // constraints. Show a friendly page explaining what changed.
    const [personFresh, eventFresh, occupiedCount] = await Promise.all([
      prisma.person.findUniqueOrThrow({
        where: { id: request.personId },
        include: { labels: { select: { id: true } } },
      }),
      prisma.event.findUniqueOrThrow({
        where: { id: request.eventId },
        include: { requiredLabels: { select: { id: true } } },
      }),
      // Count non-declined assignments by OTHER people. Don't count self —
      // accepting may be a re-accept of a previously-declined row.
      prisma.assignment.count({
        where: {
          eventId: request.eventId,
          status: { not: "declined" },
          personId: { not: request.personId },
        },
      }),
    ]);
    if (!personFresh.active) {
      res.type("html").send(
        renderResponsePage(
          "Account inactive",
          `${escapeHtml(personFresh.name)}'s account has been deactivated in Orbit. Please contact the scheduling admin if this is an error.`,
          "error",
        ),
      );
      return;
    }
    const personLabels = new Set(personFresh.labels.map((l) => l.id));
    const missingLabels = eventFresh.requiredLabels.filter(
      (l) => !personLabels.has(l.id),
    );
    if (missingLabels.length > 0) {
      res.type("html").send(
        renderResponsePage(
          "Required qualifications changed",
          `"${escapeHtml(eventFresh.title)}" now requires qualifications you don't have. The scheduling admin will look for an alternative.`,
          "error",
        ),
      );
      return;
    }
    if (occupiedCount >= eventFresh.requiredStaffCount) {
      // Auto-mark as expired so admin sees it's no longer actionable.
      await prisma.overrideRequest.update({
        where: { id: request.id },
        data: { status: "expired" },
      });
      res.type("html").send(
        renderResponsePage(
          "Shift already filled",
          `Someone else already accepted this shift. Thanks for being willing to cover — no action needed on your end.`,
        ),
      );
      return;
    }

    // Apply: trim blocking availability + create/un-decline assignment + mark request accepted.
    await prisma.$transaction(async (tx) => {
      await trimAvailabilityForEvent(
        tx,
        request.personId,
        request.event.startDateTime,
        request.event.endDateTime,
      );

      // upsert handles both: fresh row, or existing declined row being un-declined.
      await tx.assignment.upsert({
        where: {
          eventId_personId: {
            eventId: request.eventId,
            personId: request.personId,
          },
        },
        create: {
          eventId: request.eventId,
          personId: request.personId,
          status: "proposed",
        },
        update: {
          status: "proposed",
          externalEventId: null,
          syncedToOutlookAt: null,
        },
      });

      await tx.overrideRequest.update({
        where: { id: request.id },
        data: { status: "accepted", respondedAt: new Date() },
      });
    });

    res
      .type("html")
      .send(
        renderResponsePage(
          "Thank you!",
          `You've accepted "${escapeHtml(request.event.title)}". Your availability has been adjusted around this event. The admin will confirm and add it to your Outlook calendar shortly.`,
          "success",
        ),
      );
  }),
);

overrideRouter.get(
  "/:token/decline",
  asyncHandler(async (req, res) => {
    const request = await prisma.overrideRequest.findUnique({
      where: { token: req.params.token },
      include: { event: true },
    });

    if (!request) {
      res
        .status(404)
        .type("html")
        .send(
          renderResponsePage(
            "Link not found",
            "This override request link is invalid or has been removed.",
            "error",
          ),
        );
      return;
    }
    if (request.status === "accepted" || request.status === "declined") {
      res
        .type("html")
        .send(
          renderResponsePage(
            `Already ${request.status}`,
            `You already ${request.status} this request${request.respondedAt ? ` on ${request.respondedAt.toLocaleString()}` : ""}.`,
          ),
        );
      return;
    }
    if (request.status === "expired" || request.expiresAt < new Date()) {
      if (request.status !== "expired") {
        await prisma.overrideRequest.update({
          where: { id: request.id },
          data: { status: "expired" },
        });
      }
      res
        .type("html")
        .send(
          renderResponsePage(
            "Link expired",
            "This override request has expired. No action needed.",
          ),
        );
      return;
    }

    await prisma.overrideRequest.update({
      where: { id: request.id },
      data: { status: "declined", respondedAt: new Date() },
    });

    res
      .type("html")
      .send(
        renderResponsePage(
          "Got it — thanks for letting us know",
          `You've declined "${escapeHtml(request.event.title)}". The admin will look for an alternative.`,
        ),
      );
  }),
);

// Suppress unused-Prisma-type warning when the Tx import isn't otherwise referenced.
export type _PrismaWhereInputCheck = Prisma.AvailabilityWhereInput;
