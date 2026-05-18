import { prisma } from "../db.js";
import { decrypt, encrypt } from "./crypto.js";
import { refreshAccessToken } from "./oauth.js";

const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// In-memory app-only token cache. Single tenant for now; if we go multi-tenant
// later this becomes a Map keyed by tenant id.
let appOnlyTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Fetches an app-only access token via the client-credentials flow. Used for
 * tenant-wide Graph operations (creating events on staff calendars) where we
 * don't have a signed-in user. Cached in memory until 5 minutes before expiry.
 */
export async function getAppOnlyToken(): Promise<string> {
  const now = Date.now();
  if (
    appOnlyTokenCache &&
    appOnlyTokenCache.expiresAt - now > REFRESH_WINDOW_MS
  ) {
    return appOnlyTokenCache.token;
  }

  const tenant = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) {
    throw new Error("MS_TENANT_ID / MS_CLIENT_ID / MS_CLIENT_SECRET required");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );
  if (!res.ok) {
    throw new Error(
      `getAppOnlyToken failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  appOnlyTokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

export interface CreateEventInput {
  subject: string;
  start: Date;
  end: Date;
  location?: string | null;
  bodyText?: string;
}

/**
 * Creates a calendar event on a user's calendar using the app-only token.
 * Returns the Graph event ID, which the caller should persist for future
 * updates/deletes.
 */
export async function createCalendarEvent(
  email: string,
  event: CreateEventInput,
): Promise<string> {
  const token = await getAppOnlyToken();
  const payload: Record<string, unknown> = {
    subject: event.subject,
    start: {
      dateTime: event.start.toISOString().replace("Z", ""),
      timeZone: "UTC",
    },
    end: {
      dateTime: event.end.toISOString().replace("Z", ""),
      timeZone: "UTC",
    },
    categories: ["Orbit Scheduler"],
  };
  if (event.location) payload.location = { displayName: event.location };
  if (event.bodyText) {
    payload.body = { contentType: "Text", content: event.bodyText };
  }

  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(email)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(
      `createCalendarEvent failed: ${res.status} ${await res.text()}`,
    );
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

/**
 * Sends an email via Microsoft Graph using the app-only token. The `fromEmail`
 * mailbox must exist in the tenant; with Mail.Send Application permission the
 * app can send AS any user (least surprising option: send as the admin).
 */
export async function sendMail(
  fromEmail: string,
  to: string[],
  subject: string,
  htmlBody: string,
): Promise<void> {
  const token = await getAppOnlyToken();
  const payload = {
    message: {
      subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: to.map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: "true",
  };
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(fromEmail)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  // Graph returns 202 Accepted on success.
  if (!res.ok) {
    throw new Error(`sendMail failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Deletes a calendar event by its Graph event ID. 404 is treated as success
 * (the event was already gone on Outlook's side).
 */
export async function deleteCalendarEvent(
  email: string,
  externalEventId: string,
): Promise<void> {
  const token = await getAppOnlyToken();
  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(email)}/events/${externalEventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `deleteCalendarEvent failed: ${res.status} ${await res.text()}`,
    );
  }
}

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
