import { useEffect, useMemo, useRef, useState } from "react";
import {
  Wand2,
  Ban,
  AlertTriangle,
  CheckCircle2,
  ArrowRightLeft,
  Plus,
  RotateCcw,
  Loader2,
  Mail,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAssignToEvent,
  useEventCandidates,
  useMoveAssignment,
  useRequestOverride,
  type Candidate,
} from "@/features/schedule/useSchedule";
import type {
  ScheduleAssignment,
  ScheduleConflict,
  ConflictReason,
} from "@/lib/types";

const REASON_LABEL: Record<ConflictReason, string> = {
  no_qualified_staff: "Not enough qualified staff",
  no_availability: "Qualified people are on PTO / blocked",
  capacity_exhausted: "Qualified people are tied up on other events",
  over_constrained: "Over-constrained",
};

interface Props {
  conflict: ScheduleConflict | null;
  /** Event title for header (we resolve via eventTitleById on the parent). */
  eventTitle: string | undefined;
  onClose: () => void;
  /**
   * Fires immediately whenever assignments for the event change (admin Add /
   * Move, OR an external response to an override request detected via polling).
   * Parent uses this to patch its own assignments + conflicts state in real
   * time without re-running the solver.
   */
  onResolved: (updatedAssignments: ScheduleAssignment[]) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function CandidateRow({
  candidate,
  onAdd,
  onMove,
  onRequestOverride,
  busy,
}: {
  candidate: Candidate;
  onAdd: () => void;
  onMove: (fromAssignmentId: string) => void;
  onRequestOverride: () => void;
  busy: boolean;
}) {
  const blockedByAvailability = candidate.availabilityConflicts.length > 0;
  const onAnotherEvent = candidate.overlappingAssignments.length > 0;
  const declined = candidate.previouslyDeclined;
  const pending = candidate.pendingOverrideRequest;
  const isAvailable = !blockedByAvailability && !onAnotherEvent && !declined;

  return (
    <li className="border rounded-md p-3 bg-card">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{candidate.person.name}</span>
            {candidate.person.department && (
              <span className="text-xs text-muted-foreground">
                {candidate.person.department}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {candidate.currentHoursIn14DayWindow.toFixed(1)}h scheduled in ±7d
            {candidate.maxHoursPerWeek != null && (
              <> · cap {candidate.maxHoursPerWeek}h/wk</>
            )}
          </div>
          {isAvailable && (
            <div className="text-xs text-green-700 mt-1 flex items-center gap-1">
              <CheckCircle2 className="size-3" /> Available
            </div>
          )}
          {blockedByAvailability &&
            candidate.availabilityConflicts.map((c, i) => (
              <div
                key={`av-${i}`}
                className="text-xs text-amber-600 mt-1 flex items-center gap-1"
              >
                <AlertTriangle className="size-3" />
                {c.type} blocks {formatTime(c.start)} – {formatTime(c.end)}
              </div>
            ))}
          {onAnotherEvent &&
            candidate.overlappingAssignments.map((o, i) => (
              <div
                key={`ov-${i}`}
                className="text-xs text-muted-foreground mt-1 flex items-center gap-1"
              >
                <ArrowRightLeft className="size-3" />
                On "{o.eventTitle}" ({formatTime(o.start)} – {formatTime(o.end)})
              </div>
            ))}
          {declined && (
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Ban className="size-3" /> Previously declined for this event
            </div>
          )}
        </div>
        <div className="shrink-0">
          {isAvailable && (
            <Button size="sm" onClick={onAdd} disabled={busy}>
              <Plus className="size-4" /> Add
            </Button>
          )}
          {onAnotherEvent && !blockedByAvailability && (
            <MoveFromButton
              candidate={candidate}
              onMove={onMove}
              busy={busy}
            />
          )}
          {blockedByAvailability && !pending && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRequestOverride}
              disabled={busy}
              title="Email the person asking if they'll cover this shift despite their PTO/availability conflict"
            >
              <Mail className="size-4" /> Request override
            </Button>
          )}
          {blockedByAvailability && pending && (
            <Button
              size="sm"
              variant="outline"
              disabled
              title={`Request sent ${relativeTime(pending.sentAt)} — waiting for response`}
            >
              <Clock className="size-4" /> Pending · {relativeTime(pending.sentAt)}
            </Button>
          )}
          {declined && !onAnotherEvent && !blockedByAvailability && (
            <Button
              size="sm"
              onClick={onAdd}
              disabled={busy}
              title="Reverse the previous decline and assign this person"
            >
              <RotateCcw className="size-4" /> Reassign
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function MoveFromButton({
  candidate,
  onMove,
  busy,
}: {
  candidate: Candidate;
  onMove: (fromAssignmentId: string) => void;
  busy: boolean;
}) {
  // We need the assignment ID of the FIRST overlapping assignment. The
  // candidates endpoint doesn't currently return assignment IDs — only titles
  // + times. For the move action, the user clicks and we look up the
  // assignment ID from the conflict event's overlapping assignments. The
  // backend's move route does the right thing given a from-assignment-id.
  // We pass undefined for now and disable if no ID is known.
  const fromId = candidate.overlappingAssignments[0]?.fromAssignmentId;
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => fromId && onMove(fromId)}
      disabled={busy || !fromId}
      title={
        fromId
          ? `Move from "${candidate.overlappingAssignments[0]?.eventTitle}"`
          : "Cannot move — source assignment ID unavailable"
      }
    >
      <ArrowRightLeft className="size-4" /> Move here
    </Button>
  );
}

export function ResolveConflictDialog({
  conflict,
  eventTitle,
  onClose,
  onResolved,
}: Props) {
  const open = !!conflict;
  const eventId = conflict?.event_id ?? null;
  const { data, isLoading, error, refetch } = useEventCandidates(eventId);
  const assign = useAssignToEvent();
  const move = useMoveAssignment();
  const requestOverride = useRequestOverride();

  const busy = assign.isPending || move.isPending || requestOverride.isPending;
  const currentAssignments = useMemo(
    () => data?.currentAssignments ?? [],
    [data],
  );
  const required =
    data?.event.requiredStaffCount ??
    (conflict ? conflict.short_by : 0);

  // State for the Close-vs-Done button label. Actual change-tracking happens
  // in the polling effect below (single source of truth for parent updates).
  const [mutated, setMutated] = useState(false);

  // Snapshot pending-request state across polls so we can fire a toast when a
  // recipient responds to an override request without admin action.
  const previousPendingRef = useRef<Set<string>>(new Set());
  const pendingNamesRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!data) return;
    const currentPending = new Set<string>();
    for (const c of data.candidates) {
      if (c.pendingOverrideRequest) {
        currentPending.add(c.person.id);
        pendingNamesRef.current.set(c.person.id, c.person.name);
      }
    }
    for (const personId of previousPendingRef.current) {
      if (!currentPending.has(personId)) {
        const name = pendingNamesRef.current.get(personId) ?? "Someone";
        const stillListed = data.candidates.find(
          (c) => c.person.id === personId,
        );
        if (stillListed) {
          toast.info(`${name} declined the override request`);
        } else {
          toast.success(`${name} accepted! They've been added to the event.`);
        }
        pendingNamesRef.current.delete(personId);
      }
    }
    previousPendingRef.current = currentPending;
  }, [data]);

  // Push real-time assignment changes to the parent whenever the polled
  // currentAssignments set changes — covers both admin-triggered actions and
  // external override-accept events. First load is just a snapshot (no push).
  const previousAssignmentIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const currentIds = new Set(data.currentAssignments.map((a) => a.id));
    const prev = previousAssignmentIdsRef.current;
    if (prev === null) {
      previousAssignmentIdsRef.current = currentIds;
      return;
    }
    let changed = currentIds.size !== prev.size;
    if (!changed) {
      for (const id of currentIds) {
        if (!prev.has(id)) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      onResolved(data.currentAssignments);
      setMutated(true);
    }
    previousAssignmentIdsRef.current = currentIds;
  }, [data, onResolved]);

  const handleAdd = async (personId: string) => {
    if (!eventId) return;
    try {
      await assign.mutateAsync({ eventId, personId });
      toast.success("Added");
      // Wait for the refresh so the change-detection effect fires before
      // we yield to the user.
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Add failed");
    }
  };

  const handleMove = async (fromAssignmentId: string) => {
    if (!eventId) return;
    try {
      const res = await move.mutateAsync({
        fromAssignmentId,
        toEventId: eventId,
      });
      // Move affects TWO events; the polled candidates response only covers
      // the current event, so the from-event assignments would stay stale in
      // the parent. Fire onResolved directly with the full set, then prime
      // the ref so the polling effect doesn't re-fire for this event.
      const expectedHere = new Set(
        res.updatedAssignments
          .filter((a) => a.event.id === eventId)
          .map((a) => a.id),
      );
      previousAssignmentIdsRef.current = expectedHere;
      onResolved(res.updatedAssignments);
      setMutated(true);
      toast.success("Moved");
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Move failed");
    }
  };

  const handleRequestOverride = async (personId: string) => {
    if (!eventId) return;
    try {
      const res = await requestOverride.mutateAsync({ eventId, personId });
      toast.success(`Override request sent to ${res.sentTo}`);
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to send request",
      );
    }
  };

  const handleClose = () => {
    setMutated(false);
    previousAssignmentIdsRef.current = null;
    previousPendingRef.current = new Set();
    pendingNamesRef.current = new Map();
    onClose();
  };

  const candidates = data?.candidates ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-5 text-primary" />
            Resolve "{eventTitle ?? "event"}"
          </DialogTitle>
          <DialogDescription>
            {conflict && (
              <>
                {currentAssignments.length} of {required} assigned · short by{" "}
                {conflict.short_by} · {REASON_LABEL[conflict.reason]}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section>
            <h3 className="text-sm font-medium mb-2">Currently assigned</h3>
            {currentAssignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody is assigned to this event.
              </p>
            ) : (
              <ul className="space-y-1">
                {currentAssignments.map((a) => (
                  <li
                    key={a.id}
                    className="text-sm flex items-center justify-between border rounded-md px-3 py-2 bg-muted/30"
                  >
                    <span>{a.person.name}</span>
                    <Badge variant={a.status === "confirmed" ? "default" : "secondary"}>
                      {a.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium mb-2">
              Other qualified people{" "}
              <span className="text-muted-foreground font-normal">
                (ranked by current load)
              </span>
            </h3>
            {isLoading && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </p>
            )}
            {error && (
              <p className="text-sm text-destructive">
                Couldn't load candidates: {error.message}
              </p>
            )}
            {data && candidates.length === 0 && (
              <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30">
                No other qualified people exist for this event. Add a Person
                with the right labels, or reduce the staffing requirement via
                Cancel & archive.
              </p>
            )}
            {candidates.length > 0 && (
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <CandidateRow
                    key={c.person.id}
                    candidate={c}
                    onAdd={() => handleAdd(c.person.id)}
                    onMove={handleMove}
                    onRequestOverride={() => handleRequestOverride(c.person.id)}
                    busy={busy}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={busy}>
            {mutated ? "Done" : "Close"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
