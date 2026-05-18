import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Play,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Send,
  UserX,
  Loader2,
  Wand2,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  useGenerateSchedule,
  useConfirmSchedule,
} from "@/features/schedule/useSchedule";
import { DeclineAssignmentDialog } from "@/features/schedule/DeclineAssignmentDialog";
import { CancelConflictDialog } from "@/features/schedule/CancelConflictDialog";
import { ResolveConflictDialog } from "@/features/schedule/ResolveConflictDialog";
import { useEvents } from "@/features/events/useEvents";
import type {
  GenerateScheduleResult,
  ScheduleAssignment,
  ScheduleConflict,
  ConflictReason,
  AssignmentStatus,
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

function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const dateFmt: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) {
    return `${s.toLocaleDateString(undefined, dateFmt)} · ${s.toLocaleTimeString(undefined, timeFmt)} – ${e.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${s.toLocaleString(undefined, { ...dateFmt, ...timeFmt })} – ${e.toLocaleString(undefined, { ...dateFmt, ...timeFmt })}`;
}

const REASON_LABEL: Record<ConflictReason, string> = {
  no_qualified_staff: "No qualified staff",
  no_availability: "No availability",
  capacity_exhausted: "Capacity exhausted",
  over_constrained: "Over-constrained",
};

function groupByDay(assignments: ScheduleAssignment[]) {
  const groups = new Map<string, ScheduleAssignment[]>();
  for (const a of assignments) {
    const day = new Date(a.event.startDateTime).toDateString();
    const list = groups.get(day) ?? [];
    list.push(a);
    groups.set(day, list);
  }
  return Array.from(groups.entries()).sort(
    ([a], [b]) => new Date(a).getTime() - new Date(b).getTime(),
  );
}

function statusBadge(status: AssignmentStatus) {
  if (status === "confirmed") {
    return (
      <Badge className="bg-green-600 hover:bg-green-600">
        <CheckCircle2 className="size-3 mr-1" /> Synced
      </Badge>
    );
  }
  if (status === "conflict") {
    return <Badge variant="destructive">Conflict</Badge>;
  }
  return <Badge variant="secondary">Proposed</Badge>;
}

export function SchedulePage() {
  const [startDate, setStartDate] = useState(todayLocal());
  const [endDate, setEndDate] = useState(plusDaysLocal(30));
  const { data: events } = useEvents();
  const generate = useGenerateSchedule();
  const confirmMut = useConfirmSchedule();

  // Local source of truth for displayed assignments + conflicts. Seeded from
  // the generate result, then patched by confirm / decline / resolve / cancel
  // so we don't have to re-run the solver after every mutation.
  const [assignments, setAssignments] = useState<ScheduleAssignment[]>([]);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [decliningAssignment, setDecliningAssignment] =
    useState<ScheduleAssignment | null>(null);
  const [cancellingConflict, setCancellingConflict] =
    useState<ScheduleConflict | null>(null);
  const [resolvingConflict, setResolvingConflict] =
    useState<ScheduleConflict | null>(null);

  useEffect(() => {
    if (generate.data?.assignments) {
      setAssignments(generate.data.assignments);
    }
    if (generate.data?.conflicts) {
      setConflicts(generate.data.conflicts);
    }
  }, [generate.data]);

  const result: GenerateScheduleResult | undefined = generate.data;
  const grouped = useMemo(() => groupByDay(assignments), [assignments]);
  const proposedCount = useMemo(
    () => assignments.filter((a) => a.status === "proposed").length,
    [assignments],
  );

  const eventTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events ?? []) m.set(e.id, e.title);
    return m;
  }, [events]);

  const onGenerate = async () => {
    try {
      const startISO = new Date(startDate).toISOString();
      const endISO = new Date(endDate).toISOString();
      await generate.mutateAsync({ startDate: startISO, endDate: endISO });
      toast.success("Schedule generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate schedule");
    }
  };

  const onConfirm = async () => {
    try {
      const res = await confirmMut.mutateAsync({});
      // Patch local assignments with the updated rows.
      const updates = new Map(res.updatedAssignments.map((a) => [a.id, a]));
      setAssignments((prev) => prev.map((a) => updates.get(a.id) ?? a));
      setConfirmOpen(false);
      if (res.failed > 0) {
        toast.warning(
          `${res.confirmed} synced to Outlook, ${res.failed} failed. Check details below.`,
        );
      } else {
        toast.success(`Synced ${res.confirmed} events to Outlook`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Confirm failed");
    }
  };

  // After Resolve dialog closes with at least one action taken, patch local
  // assignments with the returned rows (covers source and target events for
  // moves) and remove the conflict if the event is now sufficiently staffed.
  const onResolveResolved = (updatedAssignments: ScheduleAssignment[]) => {
    if (updatedAssignments.length === 0) return;
    // Group updates by event id, replace local assignments for each.
    const touchedEventIds = new Set(updatedAssignments.map((a) => a.event.id));
    setAssignments((prev) => {
      const others = prev.filter((a) => !touchedEventIds.has(a.event.id));
      return [...others, ...updatedAssignments].sort(
        (a, b) =>
          new Date(a.event.startDateTime).getTime() -
          new Date(b.event.startDateTime).getTime(),
      );
    });
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
        setConflicts((prev) => prev.filter((c) => c.event_id !== evId));
      }
    }
  };

  const onCancelConflictSuccess = (
    eventId: string,
    result: import("@/features/schedule/useSchedule").CancelConflictResult,
  ) => {
    if (result.action === "cancelled") {
      // Full cancel: assignments are gone and event is marked cancelled.
      setAssignments((prev) => prev.filter((a) => a.event.id !== eventId));
    }
    // For 'reduced': assignments stay as-is; only the event.requiredStaffCount
    // changed in the DB. Local state doesn't need to track that, the conflict
    // just goes away.
    setConflicts((prev) => prev.filter((c) => c.event_id !== eventId));
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
    updated: ScheduleAssignment[],
    replaced: boolean,
  ) => {
    const eventId = updated[0]?.event.id ?? decliningAssignment?.event.id;
    if (replaced && eventId) {
      setAssignments((prev) => {
        const others = prev.filter((a) => a.event.id !== eventId);
        return [...others, ...updated].sort(
          (a, b) =>
            new Date(a.event.startDateTime).getTime() -
            new Date(b.event.startDateTime).getTime(),
        );
      });
      return;
    }
    // No replacement → regenerate to refresh assignments and conflicts.
    try {
      const startISO = new Date(startDate).toISOString();
      const endISO = new Date(endDate).toISOString();
      generate.mutate({ startDate: startISO, endDate: endISO });
    } catch {
      // If regen fails to even start (invalid range etc.), fall back to local
      // patch so the declined row at least disappears from the UI.
      if (eventId) {
        setAssignments((prev) => prev.filter((a) => a.event.id !== eventId));
      }
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Generate a proposed schedule for a date range, review conflicts, then
          confirm to push assignments to staff Outlook calendars.
        </p>
      </div>

      <div className="border rounded-lg bg-card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-muted-foreground self-center mr-1">
            Quick range:
          </span>
          {(
            [
              ["This week", () => thisWeekRange()],
              ["This month", () => monthRange(0)],
              ["Next month", () => monthRange(1)],
              ["Next 30 days", () => [todayLocal(), plusDaysLocal(30)] as [string, string]],
            ] as const
          ).map(([label, fn]) => (
            <Button
              key={label}
              size="sm"
              variant="outline"
              type="button"
              onClick={() => {
                const [s, e] = fn();
                setStartDate(s);
                setEndDate(e);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium mb-1.5 block">Start</label>
            <Input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium mb-1.5 block">End</label>
            <Input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <Button onClick={onGenerate} disabled={generate.isPending}>
            <Play className="size-4" />
            {generate.isPending ? "Solving…" : "Generate"}
          </Button>
        </div>
      </div>

      {generate.isPending && (
        <p className="text-muted-foreground text-sm">
          The solver runs server-side and can take up to 10 seconds…
        </p>
      )}

      {generate.error && (
        <p className="text-destructive">
          {generate.error instanceof Error ? generate.error.message : "Solver failed"}
        </p>
      )}

      {result && result.counts.events === 0 && (
        <div className="border rounded-lg bg-card p-8 text-center">
          <h2 className="text-lg font-medium">No events in this range</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
            The solver had nothing to schedule. Add events covering this date
            range, or widen the range above.
          </p>
          <Button asChild className="mt-4">
            <Link to="/events">Go to Events</Link>
          </Button>
        </div>
      )}

      {result &&
        result.counts.events > 0 &&
        (result.status === "infeasible" || result.status === "unknown") && (
          <div className="border border-destructive/40 rounded-lg bg-destructive/5 p-4 flex items-start gap-3">
            <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">
                Solver returned: {result.status}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                The current constraints can't be satisfied. Common causes: an
                event has fewer qualified+available people than its required
                staff count, or two hard-requirement events overlap for the
                only person who could cover both.
              </p>
            </div>
          </div>
        )}

      {result && result.counts.events > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <SummaryCard label="Solver" value={result.status} />
            <SummaryCard label="People" value={String(result.counts.people)} />
            <SummaryCard label="Events" value={String(result.counts.events)} />
            <SummaryCard
              label="Assigned"
              value={String(result.counts.assignments)}
              tone="good"
            />
            <SummaryCard
              label="Conflicts"
              value={String(result.counts.conflicts)}
              tone={result.counts.conflicts > 0 ? "bad" : "good"}
            />
          </div>

          {proposedCount > 0 && (
            <div className="flex items-center justify-between border rounded-lg bg-card p-4">
              <div>
                <div className="font-medium">
                  {proposedCount} proposed assignment{proposedCount === 1 ? "" : "s"} pending
                </div>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Confirm to push events onto each staff member's Outlook calendar.
                </p>
              </div>
              <Button
                onClick={() => setConfirmOpen(true)}
                disabled={confirmMut.isPending}
              >
                {confirmMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {confirmMut.isPending ? "Syncing…" : "Confirm & sync to Outlook"}
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-lg font-medium">Assignments</h2>
              {grouped.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No assignments were made in this range.
                </p>
              )}
              {grouped.map(([day, dayAssignments]) => (
                <div key={day} className="border rounded-lg bg-card">
                  <div className="px-4 py-2 border-b text-sm font-medium bg-muted/40">
                    {day}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event</TableHead>
                        <TableHead>When</TableHead>
                        <TableHead className="w-16">Tier</TableHead>
                        <TableHead>Person</TableHead>
                        <TableHead className="w-28">Status</TableHead>
                        <TableHead className="w-16" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dayAssignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{a.event.title}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatRange(a.event.startDateTime, a.event.endDateTime)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">T{a.event.priorityTier}</Badge>
                          </TableCell>
                          <TableCell>
                            <Link
                              to={`/people?edit=${a.person.id}`}
                              className="hover:underline"
                            >
                              {a.person.name}
                            </Link>
                          </TableCell>
                          <TableCell>{statusBadge(a.status)}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDecliningAssignment(a)}
                              title={
                                a.status === "confirmed"
                                  ? "Decline (removes Outlook event) and optionally pick a replacement"
                                  : "Decline and optionally pick a replacement"
                              }
                            >
                              <UserX className="size-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-medium flex items-center gap-2">
                  <AlertCircle className="size-4 text-destructive" /> Conflicts
                </h2>
                {conflicts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-600" /> No conflicts.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {conflicts.map((c, i) => (
                      <li
                        key={`${c.event_id}-${i}`}
                        className="border rounded-md p-3 bg-card text-sm"
                      >
                        <Link
                          to={`/events?focus=${c.event_id}`}
                          className="font-medium hover:underline"
                        >
                          {eventTitleById.get(c.event_id) ?? c.event_id}
                        </Link>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="destructive">{REASON_LABEL[c.reason]}</Badge>
                          <span className="text-muted-foreground">
                            short {c.short_by}
                          </span>
                        </div>
                        <div className="mt-1 text-muted-foreground text-xs">
                          {c.message}
                        </div>
                        <div className="mt-2 flex gap-1.5">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => setResolvingConflict(c)}
                            title="See why this conflict exists and rearrange people across events to fix it"
                          >
                            <Wand2 className="size-3.5" />
                            Resolve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCancellingConflict(c)}
                            title="Accept partial coverage (reduces requirement) or cancel the event if nobody is assigned"
                          >
                            <Ban className="size-3.5" />
                            Cancel & archive
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Separator />

              <div>
                <h2 className="text-lg font-medium flex items-center gap-2">
                  <AlertTriangle className="size-4 text-amber-500" /> Warnings
                </h2>
                {result.warnings.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">No warnings.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {result.warnings.map((w, i) => (
                      <li
                        key={i}
                        className="border rounded-md p-3 bg-card text-sm"
                      >
                        <div className="font-medium">{w.type.replace("_", " ")}</div>
                        <div className="text-muted-foreground text-xs mt-1">
                          {w.message}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Push {proposedCount} event{proposedCount === 1 ? "" : "s"} to Outlook?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This creates a calendar event on each assigned staff member's
              Outlook calendar. Staff will see the event immediately.
              <br />
              <br />
              Already-confirmed assignments are skipped. Per-assignment failures
              don't block the rest of the batch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmMut.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm} disabled={confirmMut.isPending}>
              {confirmMut.isPending ? "Syncing…" : "Confirm & sync"}
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
        currentAssignments={
          resolvingConflict
            ? assignments.filter(
                (a) => a.event.id === resolvingConflict.event_id,
              )
            : []
        }
        eventTitle={
          resolvingConflict
            ? eventTitleById.get(resolvingConflict.event_id)
            : undefined
        }
        onClose={() => setResolvingConflict(null)}
        onResolved={onResolveResolved}
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
            ? eventTitleById.get(cancellingConflict.event_id)
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

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-green-600"
      : tone === "bad"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="border rounded-lg bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}
