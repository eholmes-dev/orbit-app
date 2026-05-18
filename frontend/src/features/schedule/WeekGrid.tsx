import { useMemo } from "react";
import {
  CheckCircle2,
  AlertCircle,
  CalendarOff,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import type {
  ScheduleAssignment,
  Person,
  Event,
  Availability,
} from "@/lib/types";
import { colorForLabelId } from "./shiftColors";
import { assignLanes } from "./lanes";

interface Props {
  /** Anchor date — Monday of the week to render. */
  weekStart: Date;
  /** All active people (rows). Filtering / ordering is the page's job. */
  people: Person[];
  /** All assignments overlapping the visible week. */
  assignments: ScheduleAssignment[];
  /** Events overlapping the visible week — drives the top Events row. */
  events: Event[];
  /** Availability blocks (PTO, blocked, etc.) overlapping the visible week.
   *  Drives the "blocked" overlay on person rows so admins see at a glance
   *  who's unavailable. */
  availability: Availability[];
  /** Pre-computed `eventId → assignedHeadcount` (non-declined). Avoids the
   *  per-chip `assignments.filter(...)` scan in the events row, which was
   *  O(events × assignments) on every repaint. */
  assignedCountByEventId?: Map<string, number>;
  /** Click handler for an individual assignment card (decline / replace dialog). */
  onSelectAssignment: (assignment: ScheduleAssignment) => void;
  /** Click handler for an event chip in the top row — opens the Resolve
   *  dialog so the admin can pick a person for the unassigned event. */
  onSelectEvent?: (event: Event) => void;
}

const PERSON_COL_WIDTH = "200px";
const DAY_HEADER_HEIGHT = 18;
const EVENTS_LANE_HEIGHT = 22;
const SHIFT_LANE_HEIGHT = 36;
const MIN_PERSON_ROW = 60;
const MIN_EVENTS_ROW = 40;

function startOfWeekMonday(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return date;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysBetween(from: Date, to: Date): number {
  const fromMs = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
  ).getTime();
  const toMs = new Date(
    to.getFullYear(),
    to.getMonth(),
    to.getDate(),
  ).getTime();
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
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

function formatTimeRange(start: Date, end: Date): string {
  if (start.toDateString() !== end.toDateString()) {
    const endDay = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
    }).format(end);
    return `${formatCompactTime(start)} – ${endDay} ${formatCompactTime(end)}`;
  }
  return `${formatCompactTime(start)}–${formatCompactTime(end)}`;
}

/** Time coverage of a block on a single day: "all day", "until 7a",
 *  "from 10p", or "8a–5p". Used in the per-cell availability chip. */
function formatBlockTimeForDay(
  startISO: string,
  endISO: string,
  day: Date,
): string {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = addDays(dayStart, 1);
  const s = new Date(startISO);
  const e = new Date(endISO);
  const startsBefore = s.getTime() <= dayStart.getTime();
  const endsAfter = e.getTime() >= dayEnd.getTime();
  if (startsBefore && endsAfter) return "all day";
  if (startsBefore) return `until ${formatCompactTime(e)}`;
  if (endsAfter) return `from ${formatCompactTime(s)}`;
  return `${formatCompactTime(s)}–${formatCompactTime(e)}`;
}

interface WeekSpan {
  /** Column 0..6 within the week — inclusive */
  startCol: number;
  /** Column 1..7 within the week — exclusive */
  endCol: number;
  continuesLeft: boolean;
  continuesRight: boolean;
  /** Numeric aliases for the lane packer */
  start: number;
  end: number;
}

/** Clip a [start, end) interval to the week and return its column range, or
 *  null if it doesn't overlap. */
function spanInWeek(
  startISO: string,
  endISO: string,
  weekStart: Date,
): WeekSpan | null {
  const weekEnd = addDays(weekStart, 7);
  const s = new Date(startISO);
  const e = new Date(endISO);
  if (s >= weekEnd || e <= weekStart) return null;
  const startCol = Math.max(0, daysBetween(weekStart, s));
  const lastMs = Math.max(s.getTime(), e.getTime() - 1);
  const endColRaw = Math.min(7, daysBetween(weekStart, new Date(lastMs)) + 1);
  const endCol = Math.max(endColRaw, startCol + 1);
  return {
    startCol,
    endCol,
    continuesLeft: s < weekStart,
    continuesRight: e > weekEnd,
    start: startCol,
    end: endCol,
  };
}

export function WeekGrid({
  weekStart,
  people,
  assignments,
  events,
  availability,
  assignedCountByEventId,
  onSelectAssignment,
  onSelectEvent,
}: Props) {
  const monday = useMemo(() => startOfWeekMonday(weekStart), [weekStart]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(monday, i)),
    [monday],
  );

  // Lane assignment for the top Events row — events span their full day range.
  const eventSpans = useMemo(() => {
    return events
      .map((e) => {
        const span = spanInWeek(e.startDateTime, e.endDateTime, monday);
        return span ? { event: e, ...span } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [events, monday]);
  const eventLanes = useMemo(() => assignLanes(eventSpans), [eventSpans]);

  // Per-person availability + shift indexing in (week-relative) column terms.
  const availabilityByPerson = useMemo(() => {
    const m = new Map<
      string,
      Array<{ block: Availability } & WeekSpan>
    >();
    for (const av of availability) {
      const span = spanInWeek(av.startDateTime, av.endDateTime, monday);
      if (!span) continue;
      const list = m.get(av.personId) ?? [];
      list.push({ block: av, ...span });
      m.set(av.personId, list);
    }
    return m;
  }, [availability, monday]);

  const shiftsByPerson = useMemo(() => {
    const m = new Map<
      string,
      Array<{ assignment: ScheduleAssignment } & WeekSpan>
    >();
    for (const a of assignments) {
      const span = spanInWeek(
        a.event.startDateTime,
        a.event.endDateTime,
        monday,
      );
      if (!span) continue;
      const list = m.get(a.person.id) ?? [];
      list.push({ assignment: a, ...span });
      m.set(a.person.id, list);
    }
    return m;
  }, [assignments, monday]);

  const eventsRowHeight = Math.max(
    MIN_EVENTS_ROW,
    DAY_HEADER_HEIGHT * 0 +
      eventLanes.laneCount * EVENTS_LANE_HEIGHT +
      8,
  );

  const gridTemplate = `${PERSON_COL_WIDTH} repeat(7, minmax(120px, 1fr))`;

  return (
    <div className="border rounded-lg bg-card overflow-auto max-h-[70vh]">
      <div
        className="grid text-sm"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {/* Day header row */}
        <div className="sticky top-0 left-0 z-30 bg-card border-b border-r p-2 text-xs uppercase tracking-wide text-muted-foreground">
          Team
        </div>
        {days.map((d) => (
          <div
            key={d.toISOString()}
            className="sticky top-0 z-20 bg-card border-b p-2 text-center"
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {d.toLocaleDateString(undefined, { weekday: "short" })}
            </div>
            <div className="text-sm font-medium">{d.getDate()}</div>
          </div>
        ))}

        {/* Events row — spans the full 7-day range, overlay bars on top of
            the 7 day cells. */}
        <div className="sticky left-0 z-10 bg-muted/30 border-r border-b p-2 text-xs uppercase tracking-wide text-muted-foreground">
          Events
        </div>
        <div
          className="relative col-span-7 border-b"
          style={{ gridColumn: "2 / span 7", height: eventsRowHeight }}
        >
          {/* Day-column backgrounds (gridlines). */}
          <div
            className="absolute inset-0 grid"
            style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
          >
            {days.map((d, i) => (
              <div
                key={d.toISOString()}
                className={`border-l first:border-l-0 ${
                  sameLocalDay(d, new Date()) ? "bg-accent/20" : "bg-muted/30"
                } ${i === 0 ? "" : ""}`}
              />
            ))}
          </div>
          {/* Event bars overlaid. */}
          <div className="absolute inset-0 p-1 pointer-events-none">
            {eventSpans.map((seg) => {
              const lane = eventLanes.lanes.get(seg) ?? 0;
              const assignedCount =
                assignedCountByEventId?.get(seg.event.id) ?? 0;
              return (
                <EventSpanBar
                  key={`${seg.event.id}-${seg.startCol}`}
                  seg={seg}
                  lane={lane}
                  assignedCount={assignedCount}
                  onClick={onSelectEvent}
                />
              );
            })}
          </div>
        </div>

        {/* Body rows */}
        {people.length === 0 && (
          <div
            className="col-span-8 p-6 text-center text-sm text-muted-foreground"
            style={{ gridColumn: "1 / -1" }}
          >
            No active people to schedule. Add some on the People page.
          </div>
        )}
        {people.map((person) => (
          <PersonWeekRow
            key={person.id}
            person={person}
            days={days}
            shifts={shiftsByPerson.get(person.id) ?? []}
            blocks={availabilityByPerson.get(person.id) ?? []}
            onSelectAssignment={onSelectAssignment}
          />
        ))}
      </div>
    </div>
  );
}

function EventSpanBar({
  seg,
  lane,
  assignedCount,
  onClick,
}: {
  seg: { event: Event } & WeekSpan;
  lane: number;
  assignedCount: number;
  onClick?: (event: Event) => void;
}) {
  const color = colorForLabelId(seg.event.requiredLabels[0]?.id ?? null);
  const need = seg.event.requiredStaffCount;
  const interactive = !!onClick;
  const start = new Date(seg.event.startDateTime);
  const end = new Date(seg.event.endDateTime);
  const isMultiDay = start.toDateString() !== end.toDateString();
  const timeLabel = formatCompactTime(start);
  const fullRange = isMultiDay
    ? `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} → ${end.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`
    : `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${formatTimeRange(start, end)}`;
  return (
    <button
      type="button"
      onClick={() => onClick?.(seg.event)}
      disabled={!interactive}
      className={`absolute pointer-events-auto text-[11px] px-1.5 border-l-2 flex items-center gap-1 ${color.bg} ${color.border} ${
        seg.continuesLeft ? "rounded-l-none border-l-0" : "rounded-l-sm"
      } ${seg.continuesRight ? "rounded-r-none" : "rounded-r-sm"} ${
        interactive ? "cursor-pointer hover:brightness-95 transition" : "cursor-default"
      }`}
      style={{
        left: `calc(${(seg.startCol / 7) * 100}% + 4px)`,
        width: `calc(${((seg.endCol - seg.startCol) / 7) * 100}% - 8px)`,
        top: `${lane * EVENTS_LANE_HEIGHT + 2}px`,
        height: `${EVENTS_LANE_HEIGHT - 4}px`,
      }}
      title={`${seg.event.title} · ${assignedCount}/${need} filled · ${fullRange}${
        interactive ? " — click to resolve" : ""
      }`}
    >
      {seg.continuesLeft && (
        <ArrowLeft className="size-3 shrink-0 opacity-70" />
      )}
      {!seg.continuesLeft && !isMultiDay && (
        <span className="opacity-70 shrink-0">{timeLabel}</span>
      )}
      <span className="truncate flex-1 text-left">{seg.event.title}</span>
      {need > 1 && (
        <span className="opacity-70 shrink-0">
          {assignedCount}/{need}
        </span>
      )}
      {seg.continuesRight && (
        <ArrowRight className="size-3 shrink-0 opacity-70" />
      )}
    </button>
  );
}

function PersonWeekRow({
  person,
  days,
  shifts,
  blocks,
  onSelectAssignment,
}: {
  person: Person;
  days: Date[];
  shifts: Array<{ assignment: ScheduleAssignment } & WeekSpan>;
  blocks: Array<{ block: Availability } & WeekSpan>;
  onSelectAssignment: (a: ScheduleAssignment) => void;
}) {
  // Lane-pack shifts so multiple per-day assignments stack vertically instead
  // of crowding the same horizontal band.
  const { lanes, laneCount } = useMemo(() => assignLanes(shifts), [shifts]);
  const rowHeight = Math.max(
    MIN_PERSON_ROW,
    laneCount * SHIFT_LANE_HEIGHT + 8,
  );

  // Weekly total hours (visible-range only) for the name cell subtext.
  const weekHours = shifts.reduce((acc, s) => {
    const start = new Date(s.assignment.event.startDateTime).getTime();
    const end = new Date(s.assignment.event.endDateTime).getTime();
    return acc + (end - start) / 3_600_000;
  }, 0);

  return (
    <>
      <div
        className="sticky left-0 z-10 bg-card border-r border-b p-2 min-w-0"
        style={{ height: rowHeight }}
      >
        <div className="font-medium truncate">{person.name}</div>
        <div className="text-xs text-muted-foreground">
          {weekHours.toFixed(1)}h
          {person.maxHoursPerWeek ? ` / ${person.maxHoursPerWeek}h cap` : ""}
        </div>
      </div>
      <div
        className="relative border-b"
        style={{ gridColumn: "2 / span 7", height: rowHeight }}
      >
        {/* Day-column backgrounds + availability stripes per day. */}
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
        >
          {days.map((d) => (
            <div
              key={d.toISOString()}
              className={`border-l first:border-l-0 ${
                sameLocalDay(d, new Date()) ? "bg-accent/15" : ""
              }`}
            />
          ))}
        </div>
        {/* Availability bars span their column range — under the shifts. */}
        {blocks.map(({ block, ...span }) => (
          <BlockBar
            key={block.id}
            block={block}
            span={span}
            anchorDay={days[Math.max(0, span.startCol)]}
          />
        ))}
        {/* Shift bars on top. */}
        {shifts.map((s) => {
          const lane = lanes.get(s) ?? 0;
          return (
            <ShiftSpanBar
              key={s.assignment.id}
              s={s}
              lane={lane}
              onClick={() => onSelectAssignment(s.assignment)}
            />
          );
        })}
      </div>
    </>
  );
}

function BlockBar({
  block,
  span,
  anchorDay,
}: {
  block: Availability;
  span: WeekSpan;
  anchorDay: Date;
}) {
  // Show time only when there's enough width for a chip; otherwise just stripes.
  const widthPct = ((span.endCol - span.startCol) / 7) * 100;
  const label = formatBlockTimeForDay(
    block.startDateTime,
    block.endDateTime,
    anchorDay,
  );
  return (
    <div
      className="block-stripes absolute pointer-events-none overflow-hidden flex items-center justify-center"
      style={{
        left: `calc(${(span.startCol / 7) * 100}% + 1px)`,
        width: `calc(${((span.endCol - span.startCol) / 7) * 100}% - 2px)`,
        top: 0,
        bottom: 0,
      }}
      title={`${block.type} · ${label}${block.source === "outlook_sync" ? " (Outlook)" : ""}`}
    >
      {widthPct > 8 && (
        <div className="flex items-center gap-1 text-[10px] italic px-1 truncate text-amber-900/80 dark:text-amber-200/95">
          <CalendarOff className="size-3 shrink-0" />
          <span className="truncate">
            {block.type} · {label}
          </span>
        </div>
      )}
    </div>
  );
}

function ShiftSpanBar({
  s,
  lane,
  onClick,
}: {
  s: { assignment: ScheduleAssignment } & WeekSpan;
  lane: number;
  onClick: () => void;
}) {
  const a = s.assignment;
  const color = colorForLabelId(a.event.requiredLabels[0]?.id ?? null);
  const isConflict = a.status === "conflict";
  const isConfirmed = a.status === "confirmed";
  const start = new Date(a.event.startDateTime);
  const end = new Date(a.event.endDateTime);
  const isMultiDay = start.toDateString() !== end.toDateString();
  const tooltip = `${a.event.title}${
    isMultiDay
      ? ` · ${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} → ${end.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`
      : ` · ${formatTimeRange(start, end)}`
  } — click to decline / replace`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`absolute text-left text-[11px] border-l-2 px-1.5 py-1 overflow-hidden hover:brightness-95 transition ${color.bg} ${
        isConflict ? "border-l-destructive" : color.border
      } ${s.continuesLeft ? "rounded-l-none border-l-0" : "rounded-l-sm"} ${
        s.continuesRight ? "rounded-r-none" : "rounded-r-sm"
      }`}
      style={{
        left: `calc(${(s.startCol / 7) * 100}% + 2px)`,
        width: `calc(${((s.endCol - s.startCol) / 7) * 100}% - 4px)`,
        top: `${lane * SHIFT_LANE_HEIGHT + 2}px`,
        height: `${SHIFT_LANE_HEIGHT - 4}px`,
      }}
      title={tooltip}
    >
      <div className="flex items-center gap-1 font-medium leading-tight">
        {isConfirmed && (
          <CheckCircle2 className="size-3 shrink-0 opacity-70" />
        )}
        {isConflict && <AlertCircle className="size-3 shrink-0" />}
        {s.continuesLeft && (
          <ArrowLeft className="size-3 shrink-0 opacity-70" />
        )}
        <span className="truncate flex-1">{formatTimeRange(start, end)}</span>
        {s.continuesRight && (
          <ArrowRight className="size-3 shrink-0 opacity-70" />
        )}
      </div>
      <div className="truncate text-[11px] opacity-80 leading-tight mt-0.5">
        {a.event.title}
      </div>
    </button>
  );
}
