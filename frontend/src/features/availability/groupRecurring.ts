import type {
  Availability,
  AvailabilityType,
  AvailabilitySource,
} from "@/lib/types";

const MIN_GROUP_SIZE = 3;

export type GroupedAvailability =
  | { kind: "single"; record: Availability; sortKey: number }
  | {
      kind: "recurring";
      records: Availability[];
      type: AvailabilityType;
      source: AvailabilitySource;
      startTimeOfDay: string; // "HH:mm" (24h)
      endTimeOfDay: string;
      weekdays: number[]; // 0=Sun..6=Sat
      firstStart: string; // ISO
      lastStart: string; // ISO
      sortKey: number;
    };

function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Heuristically collapses Availability rows that share the same type, source,
 * and time-of-day window into a single "recurring" group. Threshold: 3+ rows
 * to avoid collapsing coincidental same-time one-offs.
 *
 * Returns rows sorted ascending by first-occurrence start.
 */
export function groupRecurring(records: Availability[]): GroupedAvailability[] {
  const buckets = new Map<string, Availability[]>();
  for (const r of records) {
    const key = `${r.type}|${r.source}|${timeOfDay(r.startDateTime)}|${timeOfDay(r.endDateTime)}`;
    const list = buckets.get(key) ?? [];
    list.push(r);
    buckets.set(key, list);
  }

  const result: GroupedAvailability[] = [];
  for (const [key, group] of buckets) {
    if (group.length >= MIN_GROUP_SIZE) {
      const [type, source, startTime, endTime] = key.split("|") as [
        AvailabilityType,
        AvailabilitySource,
        string,
        string,
      ];
      const sorted = [...group].sort(
        (a, b) =>
          new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime(),
      );
      const weekdays = Array.from(
        new Set(sorted.map((r) => new Date(r.startDateTime).getDay())),
      ).sort((a, b) => a - b);
      result.push({
        kind: "recurring",
        records: sorted,
        type,
        source,
        startTimeOfDay: startTime,
        endTimeOfDay: endTime,
        weekdays,
        firstStart: sorted[0].startDateTime,
        lastStart: sorted[sorted.length - 1].startDateTime,
        sortKey: new Date(sorted[0].startDateTime).getTime(),
      });
    } else {
      for (const r of group) {
        result.push({
          kind: "single",
          record: r,
          sortKey: new Date(r.startDateTime).getTime(),
        });
      }
    }
  }

  result.sort((a, b) => a.sortKey - b.sortKey);
  return result;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatWeekdays(weekdays: number[]): string {
  if (weekdays.length === 7) return "Every day";
  if (weekdays.length === 1) return `${DAY_SHORT[weekdays[0]]}s`;
  return weekdays.map((d) => DAY_SHORT[d]).join(", ");
}

export function formatTimeOfDayRange(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const sd = new Date();
  sd.setHours(sh, sm, 0, 0);
  const ed = new Date();
  ed.setHours(eh, em, 0, 0);
  return `${fmt.format(sd)} – ${fmt.format(ed)}`;
}

export function formatDateSpan(firstIso: string, lastIso: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(new Date(firstIso))} – ${fmt.format(new Date(lastIso))}`;
}
