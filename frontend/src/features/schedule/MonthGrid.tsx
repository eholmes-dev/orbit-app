import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import type { Event } from "@/lib/types";
import { colorForLabelId } from "./shiftColors";

interface Props {
  /** Any date inside the month to render. */
  date: Date;
  /** All events overlapping the visible grid (including spillover days from
   *  the previous/next month). */
  events: Event[];
  /** Current non-declined assignment count per event id — drives the
   *  "X / Y" overlay on each chip and the click tooltip wording (view
   *  details vs resolve). */
  assignedCountByEventId?: Map<string, number>;
  /** How many event chips to render before collapsing into "+N more". */
  maxChipsPerCell?: number;
  onSelectEvent?: (event: Event) => void;
  /** Click on the day cell's whitespace — switches the calendar to Day view
   *  for that date. Event chip clicks do NOT trigger this (they stopPropagation). */
  onSelectDay?: (date: Date) => void;
}

/** Sunday on or before the 1st of the given month — the grid's top-left. */
function gridStart(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const day = first.getDay();
  first.setDate(first.getDate() - day);
  first.setHours(0, 0, 0, 0);
  return first;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthGrid({
  date,
  events,
  assignedCountByEventId,
  maxChipsPerCell = 3,
  onSelectEvent,
  onSelectDay,
}: Props) {
  const monthIndex = date.getMonth();
  const start = useMemo(() => gridStart(date), [date]);

  // 6 weeks × 7 days = 42 cells. Some months only fill 5 rows but 6 keeps the
  // grid height stable as you navigate.
  const cells = useMemo(() => {
    const out: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }, [start]);

  // Bucket events by local day (event start).
  const eventsByDay = useMemo(() => {
    const m = new Map<string, Event[]>();
    for (const e of events) {
      const key = new Date(e.startDateTime).toDateString();
      const list = m.get(key) ?? [];
      list.push(e);
      m.set(key, list);
    }
    for (const list of m.values()) {
      list.sort(
        (a, b) =>
          new Date(a.startDateTime).getTime() -
          new Date(b.startDateTime).getTime(),
      );
    }
    return m;
  }, [events]);

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
      >
        {/* Weekday header */}
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="bg-card border-b p-2 text-center text-xs uppercase tracking-wide text-muted-foreground"
          >
            {w}
          </div>
        ))}

        {/* Day cells */}
        {cells.map((d) => {
          const dayEvents = eventsByDay.get(d.toDateString()) ?? [];
          const inMonth = d.getMonth() === monthIndex;
          const today = sameLocalDay(d, new Date());
          const visible = dayEvents.slice(0, maxChipsPerCell);
          const extra = dayEvents.length - visible.length;
          const dayClickable = !!onSelectDay;
          return (
            <div
              key={d.toISOString()}
              onClick={dayClickable ? () => onSelectDay!(d) : undefined}
              role={dayClickable ? "button" : undefined}
              tabIndex={dayClickable ? 0 : undefined}
              onKeyDown={
                dayClickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectDay!(d);
                      }
                    }
                  : undefined
              }
              title={dayClickable ? "Click to open Day view" : undefined}
              className={`border-b border-l first:border-l-0 min-h-28 p-1.5 flex flex-col gap-1 transition-colors ${
                inMonth ? "bg-card" : "bg-muted/30"
              } ${today ? "ring-1 ring-inset ring-primary/40" : ""} ${
                dayClickable
                  ? "cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs font-medium ${
                    inMonth ? "text-foreground" : "text-muted-foreground"
                  } ${today ? "text-primary" : ""}`}
                >
                  {d.getDate()}
                </span>
                {dayEvents.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {dayEvents.length}
                  </span>
                )}
              </div>
              {visible.map((e) => {
                const assignedCount = assignedCountByEventId?.get(e.id) ?? 0;
                return (
                  <EventChip
                    key={e.id}
                    event={e}
                    assignedCount={assignedCount}
                    onClick={
                      onSelectEvent
                        ? (ev) => {
                            ev.stopPropagation();
                            onSelectEvent(e);
                          }
                        : undefined
                    }
                  />
                );
              })}
              {extra > 0 && (
                <button
                  type="button"
                  onClick={(ev) => ev.stopPropagation()}
                  className="text-[10px] text-muted-foreground hover:text-foreground self-start"
                  title="More events on this day"
                >
                  +{extra} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventChip({
  event,
  assignedCount,
  onClick,
}: {
  event: Event;
  assignedCount: number;
  onClick?: (ev: ReactMouseEvent) => void;
}) {
  const color = colorForLabelId(event.requiredLabels[0]?.id ?? null);
  const interactive = !!onClick;
  const need = event.requiredStaffCount;
  const isFilled = assignedCount >= need;
  const start = new Date(event.startDateTime);
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: start.getMinutes() === 0 ? undefined : "2-digit",
  })
    .format(start)
    .toLowerCase()
    .replace(" ", "");
  const interactionHint = interactive
    ? isFilled
      ? " — click to view details"
      : " — click to resolve"
    : "";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={`w-full text-left rounded-sm border-l-2 px-1.5 py-0.5 text-[11px] truncate ${color.bg} ${color.border} ${
        interactive ? "cursor-pointer hover:brightness-95 transition" : "cursor-default"
      }`}
      title={`${event.title} · ${assignedCount}/${need} filled${interactionHint}`}
    >
      <span className="opacity-70 mr-1">{timeLabel}</span>
      {event.title}
      {!isFilled && need > 1 && (
        <span className="opacity-70 ml-1">
          ({assignedCount}/{need})
        </span>
      )}
    </button>
  );
}
