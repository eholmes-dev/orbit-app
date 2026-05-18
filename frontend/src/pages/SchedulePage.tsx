import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarCheck,
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Loader2,
  CloudOff,
  Table as TableIcon,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGenerateSchedule,
  useConfirmSchedule,
  useUnconfirmAssignments,
  useAcceptConflict,
  useDeleteAssignment,
  useScheduleAssignments,
  useAllAssignments,
  invalidateScheduleAssignments,
} from "@/features/schedule/useSchedule";
import { DeclineAssignmentDialog } from "@/features/schedule/DeclineAssignmentDialog";
import { CancelConflictDialog } from "@/features/schedule/CancelConflictDialog";
import { ResolveConflictDialog } from "@/features/schedule/ResolveConflictDialog";
import { WeekGrid } from "@/features/schedule/WeekGrid";
import { DayGrid } from "@/features/schedule/DayGrid";
import { MonthGrid } from "@/features/schedule/MonthGrid";
import { SchedulingAssistant } from "@/features/schedule/SchedulingAssistant";
import { ConflictsPanel } from "@/features/schedule/ConflictsPanel";
import { WarningsPanel } from "@/features/schedule/WarningsPanel";
import { ProposedAssignmentsTable } from "@/features/schedule/ProposedAssignmentsTable";
import { Badge } from "@/components/ui/badge";
import {
  useScheduleView,
  useScheduleViewActions,
} from "@/features/schedule/useScheduleView";
import { useEvents } from "@/features/events/useEvents";
import { usePeople } from "@/features/people/usePeople";
import { useScheduleAvailability } from "@/features/availability/useAvailability";
import type {
  ScheduleAssignment,
  ScheduleConflict,
  Event,
} from "@/lib/types";

function todayLocal(): string {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10) + "T00:00";
}

function plusDaysLocal(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10) + "T23:59";
}

function localStr(d: Date, time: "00:00" | "23:59"): string {
  const tz = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10) + "T" + time;
}

function startOfWeekMonday(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return date;
}

// Year-dropdown bounds for the toolbar's center date picker. Computed once
// at module load; matches DateTimeInput's range so the experience is consistent.
const PICKER_START_MONTH = new Date(new Date().getFullYear() - 5, 0);
const PICKER_END_MONTH = new Date(new Date().getFullYear() + 10, 11);

type CalendarView = "week" | "day" | "month";

// Calendar UI state that should survive tab-to-tab navigation (and refresh,
// since sessionStorage persists through reload) but reset on tab close —
// admins shouldn't come back to an arbitrary Wednesday from a previous session.
const VIEW_STATE_KEY = "orbit.scheduleViewState";
interface PersistedViewState {
  view?: CalendarView;
  dateISO?: string;
  tableOpen?: boolean;
}
function readViewState(): PersistedViewState {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(VIEW_STATE_KEY);
    return raw ? (JSON.parse(raw) as PersistedViewState) : {};
  } catch {
    return {};
  }
}
function writeViewState(state: PersistedViewState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage may be disabled / full — silently skip.
  }
}

/** The date range a given view is currently looking at. Used both to title
 *  the toolbar and to scope the live assignments / events queries.
 *  For Month view we include the full 6-week grid (which can spill into the
 *  prior / next month) so events on those spillover days still load. */
function rangeForView(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  if (view === "day") {
    const start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }
  if (view === "month") {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(gridStart.getDate() - first.getDay());
    gridStart.setHours(0, 0, 0, 0);
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 42);
    return { start: gridStart, end: gridEnd };
  }
  // week
  const start = startOfWeekMonday(anchor);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

function advanceDate(view: CalendarView, anchor: Date, delta: -1 | 1): Date {
  const d = new Date(anchor);
  if (view === "day") d.setDate(d.getDate() + delta);
  else if (view === "month") d.setMonth(d.getMonth() + delta);
  else d.setDate(d.getDate() + delta * 7);
  return d;
}

function formatViewLabel(view: CalendarView, d: Date): string {
  if (view === "day") {
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }
  if (view === "month") {
    return d.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  const start = startOfWeekMonday(d);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.toLocaleDateString(undefined, fmt)} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${start.toLocaleDateString(undefined, fmt)} – ${end.toLocaleDateString(undefined, fmt)}, ${end.getFullYear()}`;
}

function thisWeekRange(from: Date = new Date()): [string, string] {
  const start = new Date(from);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return [localStr(start, "00:00"), localStr(end, "23:59")];
}

function monthRange(monthsAhead: number): [string, string] {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + monthsAhead, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + monthsAhead + 1, 0);
  return [localStr(start, "00:00"), localStr(end, "23:59")];
}

export function SchedulePage() {
  const view = useScheduleView();
  const { setView, patchConflicts } = useScheduleViewActions();
  const cached = view.data;
  // The schedule view lives in the TanStack Query cache so it survives
  // navigation. Date inputs seed from the cached range on mount, then are
  // independent local state (typing in them doesn't refetch / clobber the
  // displayed schedule).
  const [startDate, setStartDate] = useState(
    () => cached?.range.startDate ?? todayLocal(),
  );
  const [endDate, setEndDate] = useState(
    () => cached?.range.endDate ?? plusDaysLocal(30),
  );
  const { data: events } = useEvents();
  const generate = useGenerateSchedule();
  const confirmMut = useConfirmSchedule();
  const unconfirmMut = useUnconfirmAssignments();
  const acceptConflictMut = useAcceptConflict();
  const deleteAssignmentMut = useDeleteAssignment();
  const qc = useQueryClient();

  // Soft-delete a proposed assignment — no decline trail, so the solver can
  // re-suggest the same person on the next Generate. Live queries refetch so
  // the event drops from the grid and (if now under-staffed) lands in
  // Conflicts automatically.
  const onRemoveAssignment = async (a: ScheduleAssignment) => {
    try {
      await deleteAssignmentMut.mutateAsync(a.id);
      invalidateScheduleAssignments(qc);
      toast.success(`Removed ${a.person.name} from "${a.event.title}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  // Accept a partial conflict — backend drops the event's requiredStaffCount
  // to match the currently-assigned headcount AND records an archive entry.
  // The conflict disappears from the panel; future generates won't re-flag it.
  // Invalidates the events query so the new requiredStaffCount surfaces in
  // the Events row + Events page.
  const onAcceptConflict = async (c: ScheduleConflict) => {
    try {
      const result = await acceptConflictMut.mutateAsync({
        eventId: c.event_id,
        conflictReason: c.reason,
        conflictShortBy: c.short_by,
      });
      patchConflicts((prev) => prev.filter((x) => x.event_id !== c.event_id));
      qc.invalidateQueries({ queryKey: ["events"] });
      toast.success(
        `Accepted as partial — staffing requirement reduced from ${result.previousRequiredStaffCount} to ${result.newRequiredStaffCount}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to accept");
    }
  };

  // Clicking an unassigned event chip opens the existing Resolve dialog so
  // the admin can pick a person. The dialog needs a ScheduleConflict shape;
  // we synthesize one from the event's current fill state. Reason is set to
  // "capacity_exhausted" as a neutral placeholder — the dialog doesn't
  // branch on reason, it just fetches candidates.
  const onSelectEvent = (event: Event) => {
    const assignedCount = assignments.filter(
      (a) => a.event.id === event.id,
    ).length;
    const shortBy = Math.max(0, event.requiredStaffCount - assignedCount);
    setResolvingConflict({
      event_id: event.id,
      reason: "capacity_exhausted",
      short_by: shortBy,
      message: `${assignedCount}/${event.requiredStaffCount} filled — pick a person to assign.`,
    });
  };

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [decliningAssignment, setDecliningAssignment] =
    useState<ScheduleAssignment | null>(null);
  const [cancellingConflict, setCancellingConflict] =
    useState<ScheduleConflict | null>(null);
  const [resolvingConflict, setResolvingConflict] =
    useState<ScheduleConflict | null>(null);
  const [unsyncingAssignment, setUnsyncingAssignment] =
    useState<ScheduleAssignment | null>(null);

  // Calendar view — each has a custom grid. Toolbar nav (Today / ‹ / ›) is
  // view-aware via advanceDate(). Persisted to sessionStorage so navigating
  // away to People/Availability/etc. and back lands you in the same view.
  const persistedView = useMemo(() => readViewState(), []);
  const [currentView, setCurrentView] = useState<CalendarView>(
    persistedView.view ?? "week",
  );
  // Below-the-grid table of all assignments grouped by day. Collapsed by
  // default so the calendar dominates; admins expand it to scan/manage
  // specific assignments (per-row unsync + decline actions).
  const [assignmentsTableOpen, setAssignmentsTableOpen] = useState(
    persistedView.tableOpen ?? false,
  );
  // Defaults to today's week; persisted across tab navigation so admins keep
  // the week they were last looking at.
  const [currentDate, setCurrentDate] = useState<Date>(() =>
    persistedView.dateISO ? new Date(persistedView.dateISO) : new Date(),
  );
  // Center date-picker popover (the toolbar label is the trigger).
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Mirror the three view-state slots to sessionStorage on every change.
  useEffect(() => {
    writeViewState({
      view: currentView,
      dateISO: currentDate.toISOString(),
      tableOpen: assignmentsTableOpen,
    });
  }, [currentView, currentDate, assignmentsTableOpen]);

  const { data: people } = usePeople();
  const activePeople = useMemo(
    () => (people ?? []).filter((p) => p.active),
    [people],
  );

  const result = cached;

  // Live assignments for the visible view range — independent of whatever
  // range was last Generated. Navigating to a different week / day / month
  // refetches that range's assignments from the DB.
  const viewRange = useMemo(
    () => rangeForView(currentView, currentDate),
    [currentView, currentDate],
  );
  const { data: liveAssignments } = useScheduleAssignments(
    viewRange.start.toISOString(),
    viewRange.end.toISOString(),
  );

  // Availability blocks for the visible view range — drives the "blocked"
  // overlays on person rows in the grid so admins see PTO / out-of-office
  // at a glance instead of only learning about it from solver conflicts.
  const { data: availabilityBlocks } = useScheduleAvailability(
    viewRange.start.toISOString(),
    viewRange.end.toISOString(),
  );
  const assignments = liveAssignments ?? [];

  // All proposed assignments across the entire DB — drives the collapsible
  // "Assignments" table below the grid. Lets admins see (and click through to)
  // proposed rows that aren't in the currently visible week.
  const { data: allAssignmentsRaw } = useAllAssignments();
  const allProposedAssignments = useMemo(
    () => (allAssignmentsRaw ?? []).filter((a) => a.status === "proposed"),
    [allAssignmentsRaw],
  );

  // Non-declined assignment count per event id — drives the "X of Y filled"
  // text and the Accept-partial affordance in ConflictsPanel. Built off the
  // across-DB view so a conflict on a future week still gets an accurate count.
  const assignedCountByEventId = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allAssignmentsRaw ?? []) {
      m.set(a.event.id, (m.get(a.event.id) ?? 0) + 1);
    }
    return m;
  }, [allAssignmentsRaw]);

  // Conflicts are derived from live state (events + current assigned counts),
  // not the cached generate snapshot. The cache used to drive this directly,
  // but it doesn't survive post-generate edits — declining or deleting an
  // assignment after Generate would leave a stale "no conflict" cache while
  // the event was actually unfilled. We still pull the `reason` from the
  // cached snapshot when present so the solver's categorization survives.
  //
  // Scope: an event is "in scope" if it's in the cached generate range
  // (existing schedule) OR in the currently visible view range (what admin is
  // looking at). Without the visible-range arm, removing someone from a
  // proposed assignment via the Proposed Assignments table — which spans
  // every week — wouldn't surface as a conflict if the event happened to be
  // outside the cached range.
  const liveConflicts = useMemo<ScheduleConflict[]>(() => {
    if (!events) return [];
    const cachedRangeStart = cached?.range
      ? new Date(cached.range.startDate).getTime()
      : null;
    const cachedRangeEnd = cached?.range
      ? new Date(cached.range.endDate).getTime()
      : null;
    const visibleRangeStart = viewRange.start.getTime();
    const visibleRangeEnd = viewRange.end.getTime();
    const cachedReasonById = new Map(
      (cached?.conflicts ?? []).map((c) => [c.event_id, c.reason]),
    );
    return events
      .filter((e) => {
        if (e.cancelledAt) return false;
        const eStart = new Date(e.startDateTime).getTime();
        const inCachedRange =
          cachedRangeStart !== null &&
          cachedRangeEnd !== null &&
          eStart >= cachedRangeStart &&
          eStart < cachedRangeEnd;
        const inVisibleRange =
          eStart >= visibleRangeStart && eStart < visibleRangeEnd;
        if (!inCachedRange && !inVisibleRange) return false;
        const assignedCount = assignedCountByEventId.get(e.id) ?? 0;
        return assignedCount < e.requiredStaffCount;
      })
      .sort(
        (a, b) =>
          new Date(a.startDateTime).getTime() -
          new Date(b.startDateTime).getTime(),
      )
      .map((e) => {
        const assignedCount = assignedCountByEventId.get(e.id) ?? 0;
        const shortBy = e.requiredStaffCount - assignedCount;
        return {
          event_id: e.id,
          reason: cachedReasonById.get(e.id) ?? "capacity_exhausted",
          short_by: shortBy,
          message: `Short by ${shortBy} — ${assignedCount} of ${e.requiredStaffCount} filled.`,
        };
      });
  }, [events, assignedCountByEventId, cached, viewRange]);

  // Conflicts panel + the assistant's conflict count read from this. Driven
  // by live state, so post-generate edits stay accurate.
  const conflicts = liveConflicts;

  // Publish acts on EVERY proposed assignment in the DB, so the button's
  // enabled state and count must reflect that — not just what's visible in
  // the current view's range. Otherwise switching to a day/week with no
  // pending shifts disables Publish even when other weeks still have some.
  const proposedCount = allProposedAssignments.length;

  const eventsById = useMemo(() => {
    const m = new Map<string, Event>();
    for (const e of events ?? []) m.set(e.id, e);
    return m;
  }, [events]);

  // Events that start in the visible view range. Cancelled events are filtered
  // out — they're not part of the solver's input and showing them in the grid
  // creates phantom "0/N" rows that can never be resolved.
  const visibleEvents = useMemo(() => {
    if (!events) return [];
    return events.filter((e) => {
      if (e.cancelledAt) return false;
      const eStart = new Date(e.startDateTime);
      return eStart >= viewRange.start && eStart < viewRange.end;
    });
  }, [events, viewRange.start, viewRange.end]);

  // Events still needing at least one more person — drives the Week and Day
  // top Events rows. Month view shows ALL visible events (per spec).
  const unassignedEvents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assignments) {
      counts.set(a.event.id, (counts.get(a.event.id) ?? 0) + 1);
    }
    return visibleEvents.filter(
      (e) => (counts.get(e.id) ?? 0) < e.requiredStaffCount,
    );
  }, [visibleEvents, assignments]);

  const navigate = useNavigate();

  const onGenerate = async () => {
    try {
      // startDate / endDate are "YYYY-MM-DDTHH:mm" local strings from the
      // date pickers. `new Date(...)` parses them as the user's local TZ;
      // `.toISOString()` then converts to UTC for the backend. The reverse
      // (backend UTC ↔ frontend local display) goes through `new Date(ISO)`
      // which is also TZ-aware. End result: the literal "Mon 00:00 → Sun
      // 23:59" the admin picks in their local timezone is what the solver
      // sees as the range, and what events get displayed against — DO NOT
      // strip the TZ offset or treat these strings as UTC.
      const startISO = new Date(startDate).toISOString();
      const endISO = new Date(endDate).toISOString();
      const res = await generate.mutateAsync({
        startDate: startISO,
        endDate: endISO,
      });
      // Replace the cached view (drives conflicts/warnings in the Assistant).
      setView({
        ...res,
        range: { startDate, endDate },
        generatedAt: new Date().toISOString(),
      });
      // Refresh the live week's assignments so the grid reflects the solver
      // output immediately.
      invalidateScheduleAssignments(qc);
      toast.success("Schedule generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate schedule");
    }
  };

  // Shared unsync: takes a list of assignment IDs, calls the unconfirm
  // endpoint, patches local state. Used by both the toast Undo affordance
  // (immediately after Confirm & sync) and the per-row CloudOff button.
  const runUnconfirm = async (
    assignmentIds: string[],
    successMessage: (n: number) => string,
  ) => {
    if (assignmentIds.length === 0) return;
    try {
      const res = await unconfirmMut.mutateAsync({ assignmentIds });
      invalidateScheduleAssignments(qc);
      if (res.failed > 0) {
        toast.warning(
          `${res.unconfirmed} unsynced, ${res.failed} failed. Outlook may be partially out of sync.`,
        );
      } else {
        toast.success(successMessage(res.unconfirmed));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unsync failed");
    }
  };

  const onConfirm = async () => {
    try {
      const res = await confirmMut.mutateAsync({});
      invalidateScheduleAssignments(qc);
      setConfirmOpen(false);
      // IDs that flipped to confirmed in this batch — what the Undo would target.
      const justConfirmedIds = res.updatedAssignments
        .filter((a) => a.status === "confirmed")
        .map((a) => a.id);
      if (res.failed > 0) {
        toast.warning(
          `${res.confirmed} synced to Outlook, ${res.failed} failed. Check details below.`,
          {
            action:
              justConfirmedIds.length > 0
                ? {
                    label: "Undo",
                    onClick: () =>
                      runUnconfirm(
                        justConfirmedIds,
                        (n) =>
                          `Rolled back ${n} Outlook event${n === 1 ? "" : "s"}`,
                      ),
                  }
                : undefined,
            duration: 15_000,
          },
        );
      } else {
        toast.success(`Synced ${res.confirmed} events to Outlook`, {
          action:
            justConfirmedIds.length > 0
              ? {
                  label: "Undo",
                  onClick: () =>
                    runUnconfirm(
                      justConfirmedIds,
                      (n) =>
                        `Rolled back ${n} Outlook event${n === 1 ? "" : "s"}`,
                    ),
                }
              : undefined,
          duration: 15_000,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Confirm failed");
    }
  };

  const onUnsyncOne = async () => {
    if (!unsyncingAssignment) return;
    await runUnconfirm(
      [unsyncingAssignment.id],
      () => `Unsynced — ${unsyncingAssignment.person.name} is back to proposed`,
    );
    setUnsyncingAssignment(null);
  };

  // After Resolve dialog closes with at least one action taken, refresh the
  // live week and clear the conflict from the Assistant panel if the event
  // is now sufficiently staffed.
  const onResolveResolved = (updatedAssignments: ScheduleAssignment[]) => {
    if (updatedAssignments.length === 0) return;
    invalidateScheduleAssignments(qc);
    // If we added enough new assignments to the resolved event to cover the
    // shortfall, clear the conflict from the panel. Other events that were
    // touched (e.g. the source of a move) might be newly under-staffed —
    // those will surface on the next Generate.
    if (resolvingConflict) {
      const evId = resolvingConflict.event_id;
      const newAssignedCount = updatedAssignments.filter(
        (a) => a.event.id === evId,
      ).length;
      const previousAssignedCount = assignments.filter(
        (a) => a.event.id === evId,
      ).length;
      if (
        newAssignedCount - previousAssignedCount >= resolvingConflict.short_by
      ) {
        patchConflicts((prev) => prev.filter((c) => c.event_id !== evId));
      }
    }
  };

  const onCancelConflictSuccess = (
    eventId: string,
    _result: import("@/features/schedule/useSchedule").CancelConflictResult,
  ) => {
    // Whether cancelled (sets event.cancelledAt) or reduced (changes
    // event.requiredStaffCount), both mutate the Event row — invalidate the
    // events query too so the Events page badge / Schedule grid filter reflect
    // the new state.
    invalidateScheduleAssignments(qc);
    qc.invalidateQueries({ queryKey: ["events"] });
    patchConflicts((prev) => prev.filter((c) => c.event_id !== eventId));
    setCancellingConflict(null);
  };

  // The decline modal owns its own mutation and returns the updated assignment
  // list (the affected event's assignments, post-decline + post-replacement-create).
  // - If admin picked a replacement: patch local state to reflect the swap.
  //   Don't re-run the solver — that would let it second-guess the admin's pick.
  // - If admin declined without replacement: re-run the solver so the now-
  //   uncovered event surfaces in conflicts (and other downstream effects
  //   recompute).
  const onDeclineResolved = (
    _updated: ScheduleAssignment[],
    replaced: boolean,
  ) => {
    // Either way the live grid needs a refresh.
    invalidateScheduleAssignments(qc);
    if (replaced) return;
    // No replacement → regenerate so the now-uncovered event surfaces as a
    // conflict in the Assistant panel.
    onGenerate();
  };

  return (
    <div className="p-8 max-w-(--breakpoint-2xl) mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <CalendarCheck className="size-6" /> Schedule
        </h1>
        <p className="text-sm text-muted-foreground">
          Plan staff coverage across events. Use the Assistant on the right to
          set a date range, generate, resolve conflicts, and publish to Outlook.
        </p>
      </div>

      <div className="flex gap-4 items-start">
        {/* Left: calendar grid */}
        <div className="flex-1 min-w-0 space-y-3">
          {/* Toolbar: view-aware navigation + view toggle. Today / ‹ / › step
              the visible range by the current view's unit (day / week / month). */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentDate(new Date())}
              >
                Today
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setCurrentDate(advanceDate(currentView, currentDate, -1))
                }
                aria-label={`Previous ${currentView}`}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() =>
                  setCurrentDate(advanceDate(currentView, currentDate, 1))
                }
                aria-label={`Next ${currentView}`}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="font-medium ml-1 gap-1.5"
                    title="Jump to a specific date"
                  >
                    <CalendarIcon className="size-4 opacity-60" />
                    {formatViewLabel(currentView, currentDate)}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={currentDate}
                    defaultMonth={currentDate}
                    onSelect={(d) => {
                      if (d) setCurrentDate(d);
                      setDatePickerOpen(false);
                    }}
                    captionLayout="dropdown"
                    startMonth={PICKER_START_MONTH}
                    endMonth={PICKER_END_MONTH}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="inline-flex rounded-md border bg-card">
              {(["week", "day", "month"] as const).map((v, i, arr) => (
                <Button
                  key={v}
                  size="sm"
                  variant={currentView === v ? "default" : "ghost"}
                  className={`capitalize ${
                    i === 0
                      ? "rounded-r-none"
                      : i === arr.length - 1
                        ? "rounded-l-none"
                        : "rounded-none"
                  }`}
                  onClick={() => setCurrentView(v)}
                >
                  {v}
                </Button>
              ))}
            </div>
          </div>

          {/* The grid is always rendered — even with no schedule generated,
              it shows people, the visible range's events (in the top row),
              and any existing assignments from the DB. */}
          {currentView === "week" && (
            <WeekGrid
              weekStart={currentDate}
              people={activePeople}
              assignments={assignments}
              events={unassignedEvents}
              availability={availabilityBlocks ?? []}
              assignedCountByEventId={assignedCountByEventId}
              onSelectAssignment={(a) => setDecliningAssignment(a)}
              onSelectEvent={onSelectEvent}
            />
          )}
          {currentView === "day" && (
            <DayGrid
              date={currentDate}
              people={activePeople}
              assignments={assignments}
              events={unassignedEvents}
              availability={availabilityBlocks ?? []}
              assignedCountByEventId={assignedCountByEventId}
              onSelectAssignment={(a) => setDecliningAssignment(a)}
              onSelectEvent={onSelectEvent}
            />
          )}
          {currentView === "month" && (
            <MonthGrid
              date={currentDate}
              events={visibleEvents}
              assignedCountByEventId={assignedCountByEventId}
              onSelectEvent={onSelectEvent}
              onSelectDay={(d) => {
                setCurrentDate(d);
                setCurrentView("day");
              }}
            />
          )}

          {/* Collapsible "Assignments" table — every proposed assignment in the
              DB, regardless of the current calendar view. Click a row to jump
              the calendar to that week. Default collapsed. */}
          {allProposedAssignments.length > 0 && (
            <div className="border rounded-lg bg-card">
              <button
                type="button"
                onClick={() => setAssignmentsTableOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-3 p-3 hover:bg-muted/40 transition rounded-lg"
                aria-expanded={assignmentsTableOpen}
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <TableIcon className="size-4 text-muted-foreground" />
                  Proposed Assignments
                  <Badge variant="secondary" className="ml-1">
                    {allProposedAssignments.length}
                  </Badge>
                </div>
                {assignmentsTableOpen ? (
                  <ChevronDown className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 text-muted-foreground" />
                )}
              </button>
              {assignmentsTableOpen && (
                <div className="p-3 border-t">
                  <ProposedAssignmentsTable
                    assignments={allProposedAssignments}
                    onUnsync={(a) => setUnsyncingAssignment(a)}
                    onDecline={(a) => setDecliningAssignment(a)}
                    onRemove={onRemoveAssignment}
                    onRowClick={(a) => {
                      // Jump the calendar to the assignment's week + force
                      // Week view (Day/Month aren't custom yet, so a row
                      // click from there is most useful as a week jump).
                      setCurrentDate(new Date(a.event.startDateTime));
                      setCurrentView("week");
                    }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column: Assistant + Conflicts/Warnings panels stacked under it */}
        <div className="w-80 shrink-0 space-y-3">
          <SchedulingAssistant
            startDate={startDate}
            endDate={endDate}
            onChangeStartDate={setStartDate}
            onChangeEndDate={setEndDate}
            onQuickRange={([s, e]) => {
              setStartDate(s);
              setEndDate(e);
            }}
            quickRanges={[
              ["This week", () => thisWeekRange()],
              ["This month", () => monthRange(0)],
              ["Next month", () => monthRange(1)],
              ["Next 30 days", () => [todayLocal(), plusDaysLocal(30)]],
            ]}
            view={result ?? null}
            viewRange={cached?.range}
            viewGeneratedAt={cached?.generatedAt}
            isGenerating={generate.isPending}
            generateError={
              generate.error instanceof Error ? generate.error.message : null
            }
            onGenerate={onGenerate}
            proposedCount={proposedCount}
            conflictsCount={conflicts.length}
            isPublishing={confirmMut.isPending}
            onPublish={() => setConfirmOpen(true)}
          />

          {/* Conflicts + Warnings — separate cards underneath. Shown whenever a
              generate result exists in the session; empty states make it
              clear when nothing's flagged. */}
          {result && (
            <>
              <ConflictsPanel
                conflicts={conflicts}
                eventsById={eventsById}
                assignedCountByEventId={assignedCountByEventId}
                onResolve={(c) => setResolvingConflict(c)}
                onCancel={(c) => setCancellingConflict(c)}
                onAccept={onAcceptConflict}
              />
              <WarningsPanel
                warnings={result.warnings}
                onOpenPerson={(id) => navigate(`/people?edit=${id}`)}
              />
            </>
          )}
        </div>
      </div>


      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Push {proposedCount} assignment{proposedCount === 1 ? "" : "s"} to Outlook?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This creates a calendar event on each assigned staff member's
                  Outlook calendar. Staff will see the event immediately.
                </p>
                <p className="text-amber-700 font-medium">
                  Scope: <strong>all proposed assignments across all dates</strong>
                  {" "}— not just the week you're currently viewing. Includes any
                  future shifts pending from earlier Generate runs.
                </p>
                <p className="text-xs text-muted-foreground">
                  Already-confirmed assignments are skipped. Per-assignment
                  failures don't block the rest of the batch.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmMut.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm} disabled={confirmMut.isPending}>
              {confirmMut.isPending ? "Syncing…" : `Publish all ${proposedCount}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!unsyncingAssignment}
        onOpenChange={(open) => !open && setUnsyncingAssignment(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CloudOff className="size-5 text-amber-500" />
              Unsync {unsyncingAssignment?.person.name} from Outlook?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The calendar event for "{unsyncingAssignment?.event.title}" will
              be removed from {unsyncingAssignment?.person.name}'s Outlook
              calendar. The assignment stays as <strong>proposed</strong> in
              Orbit — you can re-confirm later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unconfirmMut.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onUnsyncOne}
              disabled={unconfirmMut.isPending}
            >
              {unconfirmMut.isPending ? "Unsyncing…" : "Unsync"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeclineAssignmentDialog
        assignment={decliningAssignment}
        onClose={() => setDecliningAssignment(null)}
        onResolved={onDeclineResolved}
      />

      <ResolveConflictDialog
        conflict={resolvingConflict}
        eventTitle={
          resolvingConflict
            ? eventsById.get(resolvingConflict.event_id)?.title
            : undefined
        }
        onClose={() => setResolvingConflict(null)}
        onResolved={onResolveResolved}
        inputSnapshot={cached?.inputSnapshot}
        snapshotGeneratedAt={cached?.generatedAt}
        onAccept={onAcceptConflict}
        onRemoveAssignment={onRemoveAssignment}
      />

      <CancelConflictDialog
        open={!!cancellingConflict}
        input={
          cancellingConflict
            ? {
                eventId: cancellingConflict.event_id,
                conflictReason: cancellingConflict.reason,
                conflictShortBy: cancellingConflict.short_by,
              }
            : null
        }
        eventTitle={
          cancellingConflict
            ? eventsById.get(cancellingConflict.event_id)?.title
            : undefined
        }
        currentAssignedCount={
          cancellingConflict
            ? assignments.filter(
                (a) => a.event.id === cancellingConflict.event_id,
              ).length
            : 0
        }
        originalRequiredStaffCount={
          cancellingConflict
            ? assignments.filter(
                (a) => a.event.id === cancellingConflict.event_id,
              ).length + cancellingConflict.short_by
            : 0
        }
        onClose={() => setCancellingConflict(null)}
        onSuccess={onCancelConflictSuccess}
      />
    </div>
  );
}

