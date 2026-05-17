import { prisma } from "../db.js";
import { decrypt, encrypt } from "./crypto.js";
import { refreshAccessToken } from "./oauth.js";

const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * Returns a valid Microsoft Graph access token for the given session, refreshing
 * silently if it's within 5 minutes of expiry. Persists the refreshed tokens.
 */
export async function getValidAccessToken(sessionId: string): Promise<string> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (session.tokenExpiresAt.getTime() - Date.now() > REFRESH_WINDOW_MS) {
    return decrypt(session.accessToken);
  }

  const refreshToken = decrypt(session.refreshToken);
  const fresh = await refreshAccessToken(refreshToken);

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      accessToken: encrypt(fresh.access_token),
      refreshToken: encrypt(fresh.refresh_token ?? refreshToken),
      tokenExpiresAt: new Date(Date.now() + fresh.expires_in * 1000),
    },
  });

  return fresh.access_token;
}

export type ScheduleItemStatus =
  | "free"
  | "tentative"
  | "busy"
  | "oof"
  | "workingElsewhere"
  | "unknown";

export interface ScheduleItem {
  status: ScheduleItemStatus;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  subject?: string;
  location?: string;
  isPrivate?: boolean;
}

export interface ScheduleResult {
  scheduleId: string;
  scheduleItems?: ScheduleItem[];
  availabilityView?: string;
  error?: { responseCode: string; message: string };
}

/**
 * Calls Microsoft Graph's getSchedule endpoint to fetch busy/oof windows for
 * one or more users over a date range. Max 20 emails per call.
 */
export async function getSchedule(
  accessToken: string,
  emails: string[],
  start: Date,
  end: Date,
  availabilityViewInterval = 60,
): Promise<ScheduleResult[]> {
  const body = {
    schedules: emails,
    startTime: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" },
    endTime: { dateTime: end.toISOString().replace("Z", ""), timeZone: "UTC" },
    availabilityViewInterval,
  };
  const res = await fetch(`${GRAPH_BASE}/me/calendar/getSchedule`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`getSchedule failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { value: ScheduleResult[] };
  return data.value ?? [];
}

/**
 * Convert a Graph ScheduleItem date ("2026-06-03T00:00:00.0000000" + timeZone)
 * to a JS Date. We only ever request UTC, so the timeZone field should be UTC.
 */
export function graphDateToJsDate(d: { dateTime: string; timeZone: string }): Date {
  // Strip microseconds beyond ms (JS Date can't parse 7-digit fractional seconds).
  const trimmed = d.dateTime.replace(/(\.\d{3})\d+$/, "$1");
  const isoLike = d.timeZone === "UTC" ? `${trimmed}Z` : trimmed;
  return new Date(isoLike);
}
