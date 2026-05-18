import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  dateFnsLocalizer,
  type View,
  type ToolbarProps,
} from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as DatePicker } from "@/components/ui/calendar";
import type { ScheduleAssignment } from "@/lib/types";

// react-big-calendar's CSS — imported once for any consumer.
import "react-big-calendar/lib/css/react-big-calendar.css";
// Small overrides to match the app's dark/border/text tokens. Keeps the
// library's default layout but tones down the harsh blue defaults.
import "./schedule-calendar.css";

const locales = { "en-US": enUS };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resource: ScheduleAssignment;
}

interface Props {
  assignments: ScheduleAssignment[];
  defaultDate?: Date;
  onSelectAssignment: (assignment: ScheduleAssignment) => void;
}

const VIEWS: View[] = ["month", "week", "day"];

// Year-dropdown bounds for the date picker. Computed once at module load —
// fine for a session-long app; the range is intentionally generous.
const PICKER_START_MONTH = new Date(new Date().getFullYear() - 5, 0);
const PICKER_END_MONTH = new Date(new Date().getFullYear() + 10, 11);

// Custom toolbar: makes the center date label a popover trigger so admins
// can jump to any date by clicking. Otherwise the only navigation is the
// Today/Back/Next stepping, which is tedious for jumping across months.
function CalendarToolbar({
  date,
  label,
  view,
  onNavigate,
  onView,
}: ToolbarProps<CalendarEvent>) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Remember the picker's last visible month between opens. Synced from any
  // navigation that moves the main calendar date — Today/Back/Next, in-picker
  // arrow nav, and in-picker date selection — so opening the picker always
  // shows where the calendar currently is.
  const [pickerMonth, setPickerMonth] = useState<Date>(() => date);
  const dateMs = date.getTime();
  useEffect(() => {
    setPickerMonth(new Date(dateMs));
  }, [dateMs]);
  return (
    <div className="flex items-center justify-between gap-2 p-3 border-b bg-card">
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onNavigate("TODAY")}
        >
          Today
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onNavigate("PREV")}
          aria-label="Previous"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onNavigate("NEXT")}
          aria-label="Next"
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className="font-medium gap-1.5"
            title="Click to jump to a specific date"
          >
            <CalendarIcon className="size-4 text-muted-foreground" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="center">
          <DatePicker
            mode="single"
            selected={date}
            month={pickerMonth}
            onMonthChange={setPickerMonth}
            captionLayout="dropdown"
            startMonth={PICKER_START_MONTH}
            endMonth={PICKER_END_MONTH}
            onSelect={(d) => {
              if (d) {
                setPickerMonth(d);
                onNavigate("DATE", d);
                setPickerOpen(false);
              }
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
      <div className="inline-flex rounded-md border bg-card">
        {VIEWS.map((v, i) => (
          <Button
            key={v}
            size="sm"
            variant={view === v ? "default" : "ghost"}
            className={
              i === 0
                ? "rounded-r-none"
                : i === VIEWS.length - 1
                  ? "rounded-l-none"
                  : "rounded-none"
            }
            onClick={() => onView(v)}
          >
            {v[0].toUpperCase() + v.slice(1)}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ScheduleCalendar({
  assignments,
  defaultDate,
  onSelectAssignment,
}: Props) {
  // Controlled view + date. Uncontrolled mode (just defaultView/defaultDate)
  // ignored the toolbar Today/Back/Next and Month/Day buttons in our setup —
  // most likely because the parent recreated `defaultDate` on every render.
  // Controlling them ourselves makes the toolbar work and lets us sync the
  // visible date when a new schedule is generated for a different range.
  const [view, setView] = useState<View>("week");
  const [date, setDate] = useState<Date>(() => defaultDate ?? new Date());

  // If a new schedule lands with a different range, jump the calendar to it.
  // Keyed on the numeric timestamp so `new Date(...)` referential inequality
  // from the parent doesn't trigger spurious resets.
  const defaultDateMs = defaultDate?.getTime();
  useEffect(() => {
    if (defaultDateMs != null) {
      setDate(new Date(defaultDateMs));
    }
  }, [defaultDateMs]);

  const events = useMemo<CalendarEvent[]>(
    () =>
      assignments.map((a) => ({
        id: a.id,
        title: `${a.event.title} · ${a.person.name}`,
        start: new Date(a.event.startDateTime),
        end: new Date(a.event.endDateTime),
        resource: a,
      })),
    [assignments],
  );

  // Color the event blocks by status (gray=proposed, green=synced, red=conflict).
  const eventPropGetter = (event: CalendarEvent) => {
    const status = event.resource.status;
    const base = "rounded text-xs px-1.5 py-0.5 border-0";
    if (status === "confirmed") {
      return {
        className: base,
        style: {
          backgroundColor: "rgb(22, 163, 74)",
          color: "white",
        },
      };
    }
    if (status === "conflict") {
      return {
        className: base,
        style: {
          backgroundColor: "rgb(220, 38, 38)",
          color: "white",
        },
      };
    }
    // proposed (default)
    return {
      className: base,
      style: {
        backgroundColor: "rgb(148, 163, 184)",
        color: "white",
      },
    };
  };

  return (
    <div className="border rounded-lg bg-card overflow-hidden h-160">
      <Calendar<CalendarEvent>
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        date={date}
        onNavigate={setDate}
        view={view}
        onView={setView}
        views={VIEWS}
        components={{ toolbar: CalendarToolbar }}
        onSelectEvent={(e) => onSelectAssignment(e.resource)}
        eventPropGetter={eventPropGetter}
        popup
        style={{ height: "100%" }}
      />
    </div>
  );
}
