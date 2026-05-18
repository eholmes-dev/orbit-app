import { useMemo } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Event } from "@/lib/types";
import { colorForLabelId } from "./shiftColors";
import { assignLanes } from "./lanes";

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
  /** Lanes to render before collapsing into "+N more". */
  maxLanesPerWeek?: number;
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

/** Whole-day count from one local-midnight to another. Used to translate an
 *  event's start/end into column indices within a week row. */
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

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LANE_HEIGHT = 20;
const DAY_HEADER_HEIGHT = 22;
const MORE_HEIGHT = 16;
const MIN_CELL_HEIGHT = 112;

interface WeekSegment {
  event: Event;
  /** Column 0..6 within the week — inclusive */
  startCol: number;
  /** Column 1..7 within the week — exclusive */
  endCol: number;
  continuesLeft: boolean;
  continuesRight: boolean;
  /** Numeric duplicates of start/end-col so `assignLanes` can pack them. */
  start: number;
  end: number;
}

/** Slice each event into its segment within this 7-day window. Events that
 *  span beyond the week get clipped + marked with continues-left/right so the
 *  bar visually runs off the edge. */
function buildWeekSegments(events: Event[], weekStart: Date): WeekSegment[] {
  const weekEnd = addDays(weekStart, 7);
  const segs: WeekSegment[] = [];
  for (const e of events) {
    const s = new Date(e.startDateTime);
    const eEnd = new Date(e.endDateTime);
    if (s >= weekEnd || eEnd <= weekStart) continue;
    const startCol = Math.max(0, daysBetween(weekStart, s));
    // Last *day* containing any part of the event (handles exact-midnight ends).
    const lastMs = Math.max(s.getTime(), eEnd.getTime() - 1);
    const endCol = Math.min(7, daysBetween(weekStart, new Date(lastMs)) + 1);
    const safeEndCol = Math.max(endCol, startCol + 1);
    segs.push({
      event: e,
      startCol,
      endCol: safeEndCol,
      start: startCol,
      end: safeEndCol,
      continuesLeft: s < weekStart,
      continuesRight: eEnd > weekEnd,
    });
  }
  return segs;
}

export function MonthGrid({
  date,
  events,
  assignedCountByEventId,
  maxLanesPerWeek = 3,
  onSelectEvent,
  onSelectDay,
}: Props) {
  const monthIndex = date.getMonth();
  const start = useMemo(() => gridStart(date), [date]);

  // 6 weeks × 7 days; some months only need 5 but a fixed 6 keeps height stable.
  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let w = 0; w < 6; w++) {
      const days: Date[] = [];
      for (let d = 0; d < 7; d++) days.push(addDays(start, w * 7 + d));
      out.push(days);
    }
    return out;
  }, [start]);

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div
        className="grid bg-card border-b"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
      >
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="p-2 text-center text-xs uppercase tracking-wide text-muted-foreground"
          >
            {w}
          </div>
        ))}
      </div>
      {weeks.map((week, weekIdx) => (
        <MonthWeekRow
          key={weekIdx}
          week={week}
          events={events}
          monthIndex={monthIndex}
          assignedCountByEventId={assignedCountByEventId}
          maxLanes={maxLanesPerWeek}
          onSelectEvent={onSelectEvent}
          onSelectDay={onSelectDay}
        />
      ))}
    </div>
  );
}

function MonthWeekRow({
  week,
  events,
  monthIndex,
  assignedCountByEventId,
  maxLanes,
  onSelectEvent,
  onSelectDay,
}: {
  week: Date[];
  events: Event[];
  monthIndex: number;
  assignedCountByEventId?: Map<string, number>;
  maxLanes: number;
  onSelectEvent?: (event: Event) => void;
  onSelectDay?: (date: Date) => void;
}) {
  const segments = useMemo(() => buildWeekSegments(events, week[0]), [
    events,
    week,
  ]);
  const { lanes, laneCount } = useMemo(
    () => assignLanes(segments),
    [segments],
  );

  // Visible segments fit within `maxLanes`. Overflow gets summarized per day
  // as a "+N more" pill on the lane immediately below the last visible lane.
  const visible = segments.filter((s) => (lanes.get(s) ?? 0) < maxLanes);
  const hidden = segments.filter((s) => (lanes.get(s) ?? 0) >= maxLanes);
  const moreByCol: number[] = Array(7).fill(0);
  for (const seg of hidden) {
    for (let c = seg.startCol; c < seg.endCol; c++) moreByCol[c]++;
  }
  const visibleLanes = Math.min(laneCount, maxLanes);
  const cellHeight = Math.max(
    MIN_CELL_HEIGHT,
    DAY_HEADER_HEIGHT +
      visibleLanes * LANE_HEIGHT +
      (moreByCol.some((c) => c > 0) ? MORE_HEIGHT + 4 : 4),
  );

  const clickable = !!onSelectDay;

  return (
    <div className="relative">
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
      >
        {week.map((d) => {
          const inMonth = d.getMonth() === monthIndex;
          const today = sameLocalDay(d, new Date());
          return (
            <div
              key={d.toISOString()}
              onClick={clickable ? () => onSelectDay!(d) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectDay!(d);
                      }
                    }
                  : undefined
              }
              title={clickable ? "Click to open Day view" : undefined}
              className={`border-b border-l first:border-l-0 p-1.5 transition-colors ${
                inMonth ? "bg-card" : "bg-muted/30"
              } ${today ? "ring-1 ring-inset ring-primary/40" : ""} ${
                clickable
                  ? "cursor-pointer hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  : ""
              }`}
              style={{ height: cellHeight }}
            >
              <span
                className={`text-xs font-medium ${
                  inMonth ? "text-foreground" : "text-muted-foreground"
                } ${today ? "text-primary" : ""}`}
              >
                {d.getDate()}
              </span>
            </div>
          );
        })}
      </div>
      {/* Event-bar overlay. pointer-events-none so the underlying day cells
          still catch whitespace clicks; each bar re-enables events on itself. */}
      <div
        className="absolute inset-0 px-1 pointer-events-none"
        style={{ paddingTop: DAY_HEADER_HEIGHT }}
      >
        {visible.map((seg) => {
          const lane = lanes.get(seg) ?? 0;
          return (
            <SpanBar
              key={`${seg.event.id}-${seg.startCol}`}
              seg={seg}
              lane={lane}
              assignedCount={
                assignedCountByEventId?.get(seg.event.id) ?? 0
              }
              onClick={onSelectEvent}
            />
          );
        })}
        {moreByCol.map((count, col) =>
          count > 0 ? (
            <button
              key={`more-${col}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectDay?.(week[col]);
              }}
              className="absolute pointer-events-auto text-[10px] text-muted-foreground hover:text-foreground px-1"
              style={{
                left: `calc(${(col / 7) * 100}% + 4px)`,
                top: `${visibleLanes * LANE_HEIGHT + 2}px`,
              }}
              title={`${count} more event${count === 1 ? "" : "s"} on this day — click to open Day view`}
            >
              +{count} more
            </button>
          ) : null,
        )}
      </div>
    </div>
  );
}

function SpanBar({
  seg,
  lane,
  assignedCount,
  onClick,
}: {
  seg: WeekSegment;
  lane: number;
  assignedCount: number;
  onClick?: (event: Event) => void;
}) {
  const color = colorForLabelId(seg.event.requiredLabels[0]?.id ?? null);
  const interactive = !!onClick;
  const need = seg.event.requiredStaffCount;
  const isFilled = assignedCount >= need;
  const start = new Date(seg.event.startDateTime);
  const end = new Date(seg.event.endDateTime);
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: start.getMinutes() === 0 ? undefined : "2-digit",
  })
    .format(start)
    .toLowerCase()
    .replace(" ", "");
  const isMultiDay = start.toDateString() !== end.toDateString();
  const fullRange = isMultiDay
    ? `${start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} → ${end.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}`
    : start.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
  const interactionHint = interactive
    ? isFilled
      ? " — click to view details"
      : " — click to resolve"
    : "";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick(seg.event);
      }}
      disabled={!interactive}
      // Square the side the bar continues past, rounded on the side it ends —
      // gives that Outlook/Google "bar runs off the week" look.
      className={`absolute pointer-events-auto text-[11px] px-1.5 border-l-2 flex items-center gap-1 ${color.bg} ${color.border} ${
        seg.continuesLeft ? "rounded-l-none border-l-0" : "rounded-l-sm"
      } ${seg.continuesRight ? "rounded-r-none" : "rounded-r-sm"} ${
        interactive ? "cursor-pointer hover:brightness-95 transition" : "cursor-default"
      }`}
      style={{
        left: `calc(${(seg.startCol / 7) * 100}% + 4px)`,
        width: `calc(${((seg.endCol - seg.startCol) / 7) * 100}% - 8px)`,
        top: `${lane * LANE_HEIGHT + 2}px`,
        height: `${LANE_HEIGHT - 4}px`,
      }}
      title={`${seg.event.title} · ${assignedCount}/${need} filled · ${fullRange}${interactionHint}`}
    >
      {seg.continuesLeft && (
        <ArrowLeft className="size-3 shrink-0 opacity-70" />
      )}
      {!seg.continuesLeft && (
        <span className="opacity-70 shrink-0">{timeLabel}</span>
      )}
      <span className="truncate flex-1 text-left">{seg.event.title}</span>
      {!isFilled && need > 1 && (
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

