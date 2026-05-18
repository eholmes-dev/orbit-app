import { useMemo } from "react";
import { CheckCircle2, AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";
import type {
  ScheduleAssignment,
  Person,
  Event,
  Availability,
} from "@/lib/types";
import { colorForLabelId } from "./shiftColors";
import { clusterLanes, type Interval } from "./lanes";

interface Props {
  /** Day to render. */
  date: Date;
  /** Active people (rows). */
  people: Person[];
  /** Assignments overlapping this day. */
  assignments: ScheduleAssignment[];
  /** Unassigned events overlapping this day — drives the top Events row. */
  events: Event[];
  /** Availability blocks overlapping this day — rendered as striped bars
   *  in each person's row so admins see when they're unavailable. */
  availability: Availability[];
  /** Pre-computed `eventId → assignedHeadcount` (non-declined). Avoids the
   *  per-chip `assignments.filter(...)` scan in the events row. */
  assignedCountByEventId?: Map<string, number>;
  onSelectAssignment: (assignment: ScheduleAssignment) => void;
  onSelectEvent?: (event: Event) => void;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MIN_LANE_HEIGHT = 22;
const MIN_ROW_HEIGHT = 60;
const MIN_EVENTS_ROW_HEIGHT = 40;

function formatHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dayStart(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function dayEnd(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/** Returns `{ leftPct, widthPct }` for placing a shift/event card across the
 *  24-hour timeline, clipped to the day boundary. */
function placeOnDay(
  startISO: string,
  endISO: string,
  day: Date,
): { leftPct: number; widthPct: number } {
  const dayMs = 24 * 60 * 60 * 1000;
  const start0 = dayStart(day).getTime();
  const s = Math.max(start0, new Date(startISO).getTime());
  const e = Math.min(start0 + dayMs, new Date(endISO).getTime());
  const leftPct = ((s - start0) / dayMs) * 100;
  const widthPct = Math.max(0.5, ((e - s) / dayMs) * 100);
  return { leftPct, widthPct };
}

function formatCompactTime(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: d.getMinutes() === 0 ? undefined : "2-digit",
  })
    .format(d)
    .toLowerCase()
    .replace(" ", "");
}

function formatTimeRange(startISO: string, endISO: string): string {
  return `${formatCompactTime(new Date(startISO))}–${formatCompactTime(new Date(endISO))}`;
}

/** Time label clipped to one day: "all day" / "until 6a" / "from 10p" / "8a–5p".
 *  Mirrors the availability-block label pattern so chip text is consistent
 *  whether the user is reading a shift or a PTO block. */
function formatVisibleRangeForDay(
  startISO: string,
  endISO: string,
  day: Date,
): string {
  const ds = dayStart(day).getTime();
  const de = ds + 24 * 60 * 60 * 1000;
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  const startsBefore = s < ds;
  const endsAfter = e > de;
  if (startsBefore && endsAfter) return "all day";
  if (startsBefore) return `until ${formatCompactTime(new Date(e))}`;
  if (endsAfter) return `from ${formatCompactTime(new Date(s))}`;
  return `${formatCompactTime(new Date(s))}–${formatCompactTime(new Date(e))}`;
}

function shortDayLabel(d: Date, anchor: Date): string {
  const diffDays = Math.abs(
    (d.getTime() - anchor.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (diffDays < 7) {
    return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

interface ClippedInterval extends Interval {
  /** Original ISO start (uncipped) — needed to detect continues-left. */
  rawStart: number;
  rawEnd: number;
}

/** Build the clipped time interval ([dayStart, dayEnd) intersection) used by
 *  the lane packer. Also records the raw original interval so the rendering
 *  layer can decide whether the chip continues past the day boundary. */
function clipToDay(startISO: string, endISO: string, day: Date): ClippedInterval {
  const ds = dayStart(day).getTime();
  const de = ds + 24 * 60 * 60 * 1000;
  const s = new Date(startISO).getTime();
  const e = new Date(endISO).getTime();
  return {
    start: Math.max(ds, s),
    end: Math.min(de, e),
    rawStart: s,
    rawEnd: e,
  };
}

export function DayGrid({
  date,
  people,
  assignments,
  events,
  availability,
  assignedCountByEventId,
  onSelectAssignment,
  onSelectEvent,
}: Props) {
  // Index assignments by personId for cheap per-row filter. Only keep those
  // overlapping the visible day.
  const shiftsByPerson = useMemo(() => {
    const m = new Map<string, ScheduleAssignment[]>();
    const ds = dayStart(date).getTime();
    const de = dayEnd(date).getTime();
    for (const a of assignments) {
      const s = new Date(a.event.startDateTime).getTime();
      const e = new Date(a.event.endDateTime).getTime();
      if (e <= ds || s >= de) continue;
      const list = m.get(a.person.id) ?? [];
      list.push(a);
      m.set(a.person.id, list);
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) =>
          new Date(a.event.startDateTime).getTime() -
          new Date(b.event.startDateTime).getTime(),
      );
    }
    return m;
  }, [assignments, date]);

  // Same indexing for availability: per-person blocks overlapping this day.
  const blocksByPerson = useMemo(() => {
    const m = new Map<string, Availability[]>();
    const ds = dayStart(date).getTime();
    const de = dayEnd(date).getTime();
    for (const av of availability) {
      const s = new Date(av.startDateTime).getTime();
      const e = new Date(av.endDateTime).getTime();
      if (e <= ds || s >= de) continue;
      const list = m.get(av.personId) ?? [];
      list.push(av);
      m.set(av.personId, list);
    }
    return m;
  }, [availability, date]);

  const hourGridlineBg: React.CSSProperties = {
    backgroundImage:
      "repeating-linear-gradient(to right, oklch(var(--border)/0.5) 0, oklch(var(--border)/0.5) 1px, transparent 1px, transparent calc(100%/24))",
  };

  const today = sameLocalDay(date, new Date());

  // Pre-compute the events row's lane layout so we can size the events row.
  const eventIntervals = useMemo(() => {
    return events.map((e) => ({
      event: e,
      ...clipToDay(e.startDateTime, e.endDateTime, date),
    }));
  }, [events, date]);
  const eventLanes = useMemo(
    () => clusterLanes(eventIntervals),
    [eventIntervals],
  );
  const eventsRowHeight = (() => {
    let maxDenom = 0;
    for (const it of eventIntervals) {
      maxDenom = Math.max(maxDenom, eventLanes.denominators.get(it) ?? 0);
    }
    return Math.max(MIN_EVENTS_ROW_HEIGHT, maxDenom * MIN_LANE_HEIGHT + 8);
  })();

  return (
    <div className="border rounded-lg bg-card overflow-auto max-h-[70vh]">
      <div
        className="grid text-sm"
        style={{ gridTemplateColumns: "200px 1fr", minWidth: "900px" }}
      >
        {/* Header */}
        <div className="sticky top-0 left-0 z-30 bg-card border-b border-r p-2 text-xs uppercase tracking-wide text-muted-foreground">
          Team
        </div>
        <div className="sticky top-0 z-20 bg-card border-b flex">
          {HOURS.map((h) => (
            <div
              key={h}
              className="flex-1 text-center text-[10px] uppercase tracking-wide text-muted-foreground border-l py-2 first:border-l-0"
            >
              {formatHour(h)}
            </div>
          ))}
        </div>

        {/* Events row — chips clustered into lanes so overlapping events
            render side-by-side rather than stacking on top of each other. */}
        <div
          className="sticky left-0 z-10 bg-muted/30 border-r border-b p-2 text-xs uppercase tracking-wide text-muted-foreground"
          style={{ height: eventsRowHeight }}
        >
          Events
        </div>
        <div
          className={`relative bg-muted/30 border-b ${
            today ? "bg-accent/30" : ""
          }`}
          style={{ ...hourGridlineBg, height: eventsRowHeight }}
        >
          {eventIntervals.map((it) => {
            const lane = eventLanes.lanes.get(it) ?? 0;
            const denom = eventLanes.denominators.get(it) ?? 1;
            const assignedCount =
              assignedCountByEventId?.get(it.event.id) ?? 0;
            return (
              <EventChip
                key={it.event.id}
                event={it.event}
                day={date}
                rawStart={it.rawStart}
                rawEnd={it.rawEnd}
                lane={lane}
                denom={denom}
                rowHeight={eventsRowHeight}
                assignedCount={assignedCount}
                onClick={onSelectEvent}
              />
            );
          })}
        </div>

        {/* Body rows */}
        {people.length === 0 && (
          <div
            className="col-span-2 p-6 text-center text-sm text-muted-foreground"
            style={{ gridColumn: "1 / -1" }}
          >
            No active people to schedule.
          </div>
        )}
        {people.map((person) => (
          <PersonDayRow
            key={person.id}
            person={person}
            date={date}
            shifts={shiftsByPerson.get(person.id) ?? []}
            blocks={blocksByPerson.get(person.id) ?? []}
            hourGridlineBg={hourGridlineBg}
            isToday={today}
            onSelectAssignment={onSelectAssignment}
          />
        ))}
      </div>
    </div>
  );
}

function EventChip({
  event,
  day,
  rawStart,
  rawEnd,
  lane,
  denom,
  rowHeight,
  assignedCount,
  onClick,
}: {
  event: Event;
  day: Date;
  rawStart: number;
  rawEnd: number;
  lane: number;
  denom: number;
  rowHeight: number;
  assignedCount: number;
  onClick?: (event: Event) => void;
}) {
  const { leftPct, widthPct } = placeOnDay(
    event.startDateTime,
    event.endDateTime,
    day,
  );
  const color = colorForLabelId(event.requiredLabels[0]?.id ?? null);
  const need = event.requiredStaffCount;
  const interactive = !!onClick;
  const ds = dayStart(day).getTime();
  const de = ds + 24 * 60 * 60 * 1000;
  const continuesLeft = rawStart < ds;
  const continuesRight = rawEnd > de;
  const laneHeight = (rowHeight - 8) / denom;
  const top = 4 + lane * laneHeight;
  return (
    <button
      type="button"
      onClick={interactive ? () => onClick!(event) : undefined}
      disabled={!interactive}
      className={`absolute border-l-2 px-1.5 text-[11px] truncate flex items-center gap-1 ${color.bg} ${color.border} ${
        continuesLeft ? "rounded-l-none border-l-0" : "rounded-l-sm"
      } ${continuesRight ? "rounded-r-none" : "rounded-r-sm"} ${
        interactive ? "cursor-pointer hover:brightness-95 transition" : "cursor-default"
      }`}
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        top,
        height: laneHeight - 2,
      }}
      title={`${event.title} · ${assignedCount}/${need} filled${
        interactive ? " — click to resolve" : ""
      }`}
    >
      {continuesLeft && <ArrowLeft className="size-3 shrink-0 opacity-70" />}
      <span className="truncate flex-1 text-left">{event.title}</span>
      {need > 1 && (
        <span className="opacity-70 shrink-0">
          {assignedCount}/{need}
        </span>
      )}
      {continuesRight && <ArrowRight className="size-3 shrink-0 opacity-70" />}
    </button>
  );
}

function PersonDayRow({
  person,
  date,
  shifts,
  blocks,
  hourGridlineBg,
  isToday,
  onSelectAssignment,
}: {
  person: Person;
  date: Date;
  shifts: ScheduleAssignment[];
  blocks: Availability[];
  hourGridlineBg: React.CSSProperties;
  isToday: boolean;
  onSelectAssignment: (a: ScheduleAssignment) => void;
}) {
  const dayHours = shifts.reduce((acc, a) => {
    const s = new Date(a.event.startDateTime).getTime();
    const e = new Date(a.event.endDateTime).getTime();
    return acc + (e - s) / 3_600_000;
  }, 0);

  // Cluster overlapping shifts so 2 events at 9-10am render side-by-side
  // (each half-height), while an isolated 2pm event still takes full height.
  const shiftIntervals = useMemo(
    () =>
      shifts.map((a) => ({
        assignment: a,
        ...clipToDay(a.event.startDateTime, a.event.endDateTime, date),
      })),
    [shifts, date],
  );
  const shiftLanes = useMemo(
    () => clusterLanes(shiftIntervals),
    [shiftIntervals],
  );
  let maxDenom = 1;
  for (const it of shiftIntervals) {
    maxDenom = Math.max(maxDenom, shiftLanes.denominators.get(it) ?? 1);
  }
  const rowHeight = Math.max(MIN_ROW_HEIGHT, maxDenom * MIN_LANE_HEIGHT + 12);

  return (
    <>
      <div
        className="sticky left-0 z-10 bg-card border-r border-b p-2 min-w-0"
        style={{ height: rowHeight }}
      >
        <div className="font-medium truncate">{person.name}</div>
        <div className="text-xs text-muted-foreground">
          {dayHours.toFixed(1)}h today
          {person.maxHoursPerWeek
            ? ` / ${person.maxHoursPerWeek}h/wk cap`
            : ""}
        </div>
      </div>
      <div
        className={`relative border-b ${isToday ? "bg-accent/10" : ""}`}
        style={{ ...hourGridlineBg, height: rowHeight }}
      >
        {/* Availability bars sit underneath shift cards — render first so
            shifts (with z-index from DOM order) sit on top and remain clickable. */}
        {blocks.map((b) => {
          const { leftPct, widthPct } = placeOnDay(
            b.startDateTime,
            b.endDateTime,
            date,
          );
          const blockTimeLabel = formatVisibleRangeForDay(
            b.startDateTime,
            b.endDateTime,
            date,
          );
          return (
            <div
              key={b.id}
              className="block-stripes absolute top-0 bottom-0 pointer-events-none flex items-center justify-center overflow-hidden"
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
              }}
              title={`${b.type} · ${blockTimeLabel}${b.source === "outlook_sync" ? " · from Outlook" : ""}`}
            >
              {widthPct > 8 && (
                <span className="text-[10px] font-medium px-1 truncate text-amber-900/80 dark:text-amber-200/95">
                  {b.type} · {blockTimeLabel}
                </span>
              )}
            </div>
          );
        })}
        {shiftIntervals.map((it) => {
          const a = it.assignment;
          const lane = shiftLanes.lanes.get(it) ?? 0;
          const denom = shiftLanes.denominators.get(it) ?? 1;
          const { leftPct, widthPct } = placeOnDay(
            a.event.startDateTime,
            a.event.endDateTime,
            date,
          );
          const color = colorForLabelId(
            a.event.requiredLabels[0]?.id ?? null,
          );
          const isConflict = a.status === "conflict";
          const isConfirmed = a.status === "confirmed";
          const ds = dayStart(date).getTime();
          const de = ds + 24 * 60 * 60 * 1000;
          const continuesLeft = it.rawStart < ds;
          const continuesRight = it.rawEnd > de;
          const isMultiDay = continuesLeft || continuesRight;
          const sStart = new Date(a.event.startDateTime);
          const sEnd = new Date(a.event.endDateTime);
          const visibleTime = isMultiDay
            ? formatVisibleRangeForDay(
                a.event.startDateTime,
                a.event.endDateTime,
                date,
              )
            : formatTimeRange(a.event.startDateTime, a.event.endDateTime);
          const spanHint = isMultiDay
            ? ` · ${shortDayLabel(sStart, date)} ${formatCompactTime(sStart)} → ${shortDayLabel(sEnd, date)} ${formatCompactTime(sEnd)}`
            : "";
          const laneHeight = (rowHeight - 8) / denom;
          const top = 4 + lane * laneHeight;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAssignment(a)}
              className={`absolute border-l-2 px-1.5 py-0.5 text-[11px] text-left overflow-hidden hover:brightness-95 transition ${color.bg} ${
                isConflict ? "border-l-destructive" : color.border
              } ${continuesLeft ? "rounded-l-none border-l-0" : "rounded-l-sm"} ${
                continuesRight ? "rounded-r-none" : "rounded-r-sm"
              }`}
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
                top,
                height: laneHeight - 2,
              }}
              title={`${a.event.title}${spanHint} — click to decline / replace`}
            >
              <div className="flex items-center gap-1 font-medium leading-tight">
                {isConfirmed && (
                  <CheckCircle2 className="size-3 shrink-0 opacity-70" />
                )}
                {isConflict && <AlertCircle className="size-3 shrink-0" />}
                {continuesLeft && (
                  <ArrowLeft className="size-3 shrink-0 opacity-70" />
                )}
                <span className="truncate flex-1">{visibleTime}</span>
                {continuesRight && (
                  <ArrowRight className="size-3 shrink-0 opacity-70" />
                )}
              </div>
              {laneHeight > 28 && (
                <div className="truncate text-[11px] opacity-80 leading-tight mt-0.5">
                  {a.event.title}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}
