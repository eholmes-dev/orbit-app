import { useMemo } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { ScheduleAssignment, Person, Event } from "@/lib/types";
import { colorForLabelId } from "./shiftColors";

interface Props {
  /** Anchor date — Monday of the week to render. */
  weekStart: Date;
  /** All active people (rows). Filtering / ordering is the page's job. */
  people: Person[];
  /** All assignments overlapping the visible week. */
  assignments: ScheduleAssignment[];
  /** Events overlapping the visible week — drives the top Events row. */
  events: Event[];
  /** Click handler for an individual assignment card (decline / replace dialog). */
  onSelectAssignment: (assignment: ScheduleAssignment) => void;
  /** Click handler for an event chip in the top row — opens the Resolve
   *  dialog so the admin can pick a person for the unassigned event. */
  onSelectEvent?: (event: Event) => void;
}

function startOfWeekMonday(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return date;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTimeRange(start: Date, end: Date): string {
  const fmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: start.getMinutes() === 0 ? undefined : "2-digit",
  });
  const endFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: end.getMinutes() === 0 ? undefined : "2-digit",
  });
  return `${fmt.format(start).toLowerCase().replace(" ", "")}–${endFmt
    .format(end)
    .toLowerCase()
    .replace(" ", "")}`;
}

export function WeekGrid({
  weekStart,
  people,
  assignments,
  events,
  onSelectAssignment,
  onSelectEvent,
}: Props) {
  const monday = useMemo(() => startOfWeekMonday(weekStart), [weekStart]);
  const days = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, [monday]);

  // Index events by local day for the top Events row. Bucketed on event start.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, Event[]>();
    for (const e of events) {
      const start = new Date(e.startDateTime);
      const key = start.toDateString();
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.startDateTime).getTime() -
          new Date(b.startDateTime).getTime(),
      );
    }
    return map;
  }, [events]);

  // Index assignments by (personId, localDay) so each cell is an O(1) lookup.
  const byPersonDay = useMemo(() => {
    const map = new Map<string, ScheduleAssignment[]>();
    for (const a of assignments) {
      const start = new Date(a.event.startDateTime);
      const key = `${a.person.id}::${start.toDateString()}`;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    // Sort each cell by start time so stacked shifts read top-to-bottom.
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.event.startDateTime).getTime() -
          new Date(b.event.startDateTime).getTime(),
      );
    }
    return map;
  }, [assignments]);

  // Person column width is fixed; day columns share remaining space evenly.
  const gridTemplate = "200px repeat(7, minmax(120px, 1fr))";

  return (
    <div className="border rounded-lg bg-card overflow-auto max-h-[70vh]">
      <div
        className="grid text-sm"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        {/* Header row */}
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

        {/* Events row — one cell per day, lists all events that day as pills. */}
        <div className="sticky left-0 z-10 bg-muted/30 border-r border-b p-2 text-xs uppercase tracking-wide text-muted-foreground">
          Events
        </div>
        {days.map((d) => {
          const dayEvents = eventsByDay.get(d.toDateString()) ?? [];
          return (
            <div
              key={`events-${d.toISOString()}`}
              className="bg-muted/30 border-b border-l p-1 space-y-1 min-h-10"
            >
              {dayEvents.map((e) => (
                <EventChip
                  key={e.id}
                  event={e}
                  assignedCount={
                    assignments.filter((a) => a.event.id === e.id).length
                  }
                  onClick={
                    onSelectEvent ? () => onSelectEvent(e) : undefined
                  }
                />
              ))}
            </div>
          );
        })}

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
          <PersonRow
            key={person.id}
            person={person}
            days={days}
            byPersonDay={byPersonDay}
            onSelectAssignment={onSelectAssignment}
          />
        ))}
      </div>
    </div>
  );
}

function PersonRow({
  person,
  days,
  byPersonDay,
  onSelectAssignment,
}: {
  person: Person;
  days: Date[];
  byPersonDay: Map<string, ScheduleAssignment[]>;
  onSelectAssignment: (a: ScheduleAssignment) => void;
}) {
  // Weekly total hours (visible-range only) — small subtext under the name.
  const weekShifts = days.flatMap(
    (d) => byPersonDay.get(`${person.id}::${d.toDateString()}`) ?? [],
  );
  const weekHours = weekShifts.reduce((acc, a) => {
    const start = new Date(a.event.startDateTime).getTime();
    const end = new Date(a.event.endDateTime).getTime();
    return acc + (end - start) / 3_600_000;
  }, 0);

  return (
    <>
      <div className="sticky left-0 z-10 bg-card border-r border-b p-2 min-w-0">
        <div className="font-medium truncate">{person.name}</div>
        <div className="text-xs text-muted-foreground">
          {weekHours.toFixed(1)}h
          {person.maxHoursPerWeek
            ? ` / ${person.maxHoursPerWeek}h cap`
            : ""}
        </div>
      </div>
      {days.map((d) => {
        const cellShifts = byPersonDay.get(`${person.id}::${d.toDateString()}`) ?? [];
        const isToday = sameLocalDay(d, new Date());
        return (
          <div
            key={d.toISOString()}
            className={`border-b border-l p-1 space-y-1 min-h-15 ${
              isToday ? "bg-accent/30" : ""
            }`}
          >
            {cellShifts.map((a) => (
              <ShiftCard
                key={a.id}
                assignment={a}
                onClick={() => onSelectAssignment(a)}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}

function EventChip({
  event,
  assignedCount,
  onClick,
}: {
  event: Event;
  assignedCount: number;
  onClick?: () => void;
}) {
  const color = colorForLabelId(event.requiredLabels[0]?.id ?? null);
  const need = event.requiredStaffCount;
  const interactive = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`w-full flex items-center gap-1 rounded-sm border-l-2 px-1.5 py-0.5 text-[11px] ${color.bg} ${color.border} ${
        interactive ? "cursor-pointer hover:brightness-95 transition" : "cursor-default"
      }`}
      title={`${event.title} · ${assignedCount}/${need} filled${
        interactive ? " — click to resolve" : ""
      }`}
    >
      <span className="truncate flex-1 text-left">{event.title}</span>
      {need > 1 && (
        <span className="opacity-70 shrink-0">
          {assignedCount}/{need}
        </span>
      )}
    </button>
  );
}

function ShiftCard({
  assignment,
  onClick,
}: {
  assignment: ScheduleAssignment;
  onClick: () => void;
}) {
  const start = new Date(assignment.event.startDateTime);
  const end = new Date(assignment.event.endDateTime);
  const firstLabelId = assignment.event.requiredLabels[0]?.id ?? null;
  const color = colorForLabelId(firstLabelId);
  const isConflict = assignment.status === "conflict";
  const isConfirmed = assignment.status === "confirmed";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-sm border-l-2 px-1.5 py-1 text-xs ${color.bg} ${
        isConflict ? "border-l-destructive" : color.border
      } hover:brightness-95 transition`}
      title={`${assignment.event.title} — click to decline / replace`}
    >
      <div className="flex items-center gap-1 font-medium leading-tight">
        {isConfirmed && <CheckCircle2 className="size-3 shrink-0 opacity-70" />}
        {isConflict && <AlertCircle className="size-3 shrink-0" />}
        <span className="truncate">{formatTimeRange(start, end)}</span>
      </div>
      <div className="truncate text-[11px] opacity-80 leading-tight mt-0.5">
        {assignment.event.title}
      </div>
    </button>
  );
}
