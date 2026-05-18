import { useMemo } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import type { ScheduleAssignment, Person, Event } from "@/lib/types";
import { colorForLabelId } from "./shiftColors";

interface Props {
  /** Day to render. */
  date: Date;
  /** Active people (rows). */
  people: Person[];
  /** Assignments overlapping this day. */
  assignments: ScheduleAssignment[];
  /** Unassigned events overlapping this day — drives the top Events row. */
  events: Event[];
  onSelectAssignment: (assignment: ScheduleAssignment) => void;
  onSelectEvent?: (event: Event) => void;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function formatHour(h: number): string {
  // "12a", "1a", ... "12p", "1p", ... — compact for tight columns.
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
 *  24-hour timeline. Clips to the day boundary so a shift that started the
 *  previous day or ends the next day still renders the visible portion. */
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

function formatTimeRange(startISO: string, endISO: string): string {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: d.getMinutes() === 0 ? undefined : "2-digit",
    })
      .format(d)
      .toLowerCase()
      .replace(" ", "");
  return `${fmt(new Date(startISO))}–${fmt(new Date(endISO))}`;
}

export function DayGrid({
  date,
  people,
  assignments,
  events,
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

  // Hourly tick gridlines drawn as a subtle background — repeating linear
  // gradient with one stop per hour. Keeps the rows readable without
  // rendering 24 explicit divs per row.
  const hourGridlineBg: React.CSSProperties = {
    backgroundImage:
      "repeating-linear-gradient(to right, oklch(var(--border)/0.5) 0, oklch(var(--border)/0.5) 1px, transparent 1px, transparent calc(100%/24))",
  };

  const today = sameLocalDay(date, new Date());

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

        {/* Events row — same column structure as Week (label + content) */}
        <div className="sticky left-0 z-10 bg-muted/30 border-r border-b p-2 text-xs uppercase tracking-wide text-muted-foreground">
          Events
        </div>
        <div
          className={`relative bg-muted/30 border-b min-h-10 ${
            today ? "bg-accent/30" : ""
          }`}
          style={hourGridlineBg}
        >
          {events.map((e) => {
            const { leftPct, widthPct } = placeOnDay(
              e.startDateTime,
              e.endDateTime,
              date,
            );
            const color = colorForLabelId(e.requiredLabels[0]?.id ?? null);
            const need = e.requiredStaffCount;
            const interactive = !!onSelectEvent;
            const assignedCount = assignments.filter(
              (a) => a.event.id === e.id,
            ).length;
            return (
              <button
                key={e.id}
                type="button"
                onClick={interactive ? () => onSelectEvent!(e) : undefined}
                disabled={!interactive}
                className={`absolute top-1 bottom-1 rounded-sm border-l-2 px-1.5 py-0.5 text-[11px] truncate flex items-center gap-1 ${color.bg} ${color.border} ${
                  interactive
                    ? "cursor-pointer hover:brightness-95 transition"
                    : "cursor-default"
                }`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                title={`${e.title} · ${assignedCount}/${need} filled${
                  interactive ? " — click to resolve" : ""
                }`}
              >
                <span className="truncate flex-1 text-left">{e.title}</span>
                {need > 1 && (
                  <span className="opacity-70 shrink-0">
                    {assignedCount}/{need}
                  </span>
                )}
              </button>
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
            hourGridlineBg={hourGridlineBg}
            isToday={today}
            onSelectAssignment={onSelectAssignment}
          />
        ))}
      </div>
    </div>
  );
}

function PersonDayRow({
  person,
  date,
  shifts,
  hourGridlineBg,
  isToday,
  onSelectAssignment,
}: {
  person: Person;
  date: Date;
  shifts: ScheduleAssignment[];
  hourGridlineBg: React.CSSProperties;
  isToday: boolean;
  onSelectAssignment: (a: ScheduleAssignment) => void;
}) {
  const dayHours = shifts.reduce((acc, a) => {
    const s = new Date(a.event.startDateTime).getTime();
    const e = new Date(a.event.endDateTime).getTime();
    return acc + (e - s) / 3_600_000;
  }, 0);

  return (
    <>
      <div className="sticky left-0 z-10 bg-card border-r border-b p-2 min-w-0">
        <div className="font-medium truncate">{person.name}</div>
        <div className="text-xs text-muted-foreground">
          {dayHours.toFixed(1)}h today
          {person.maxHoursPerWeek
            ? ` / ${person.maxHoursPerWeek}h/wk cap`
            : ""}
        </div>
      </div>
      <div
        className={`relative border-b min-h-15 ${
          isToday ? "bg-accent/10" : ""
        }`}
        style={hourGridlineBg}
      >
        {shifts.map((a) => {
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
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAssignment(a)}
              className={`absolute top-1 bottom-1 rounded-sm border-l-2 px-1.5 py-0.5 text-[11px] text-left overflow-hidden hover:brightness-95 transition ${color.bg} ${
                isConflict ? "border-l-destructive" : color.border
              }`}
              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              title={`${a.event.title} — click to decline / replace`}
            >
              <div className="flex items-center gap-1 font-medium leading-tight">
                {isConfirmed && (
                  <CheckCircle2 className="size-3 shrink-0 opacity-70" />
                )}
                {isConflict && <AlertCircle className="size-3 shrink-0" />}
                <span className="truncate">
                  {formatTimeRange(a.event.startDateTime, a.event.endDateTime)}
                </span>
              </div>
              <div className="truncate text-[11px] opacity-80 leading-tight mt-0.5">
                {a.event.title}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
