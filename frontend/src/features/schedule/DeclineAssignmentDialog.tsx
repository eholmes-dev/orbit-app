import { UserX, Ban, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
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
  useDeclineAssignment,
  useEventCandidates,
  type Candidate,
} from "@/features/schedule/useSchedule";
import type { ScheduleAssignment } from "@/lib/types";
import { toast } from "sonner";

interface Props {
  assignment: ScheduleAssignment | null;
  onClose: () => void;
  /**
   * Called when the decline (and optional replacement) succeeds.
   * `replaced` tells the parent whether the admin picked a replacement —
   * the parent can use that to decide whether to re-run the solver.
   */
  onResolved: (
    updatedAssignments: ScheduleAssignment[],
    replaced: boolean,
  ) => void;
}

function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const f: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  return `${s.toLocaleString(undefined, f)} – ${e.toLocaleString(undefined, f)}`;
}

function CandidateRow({
  candidate,
  onPick,
  disabled,
}: {
  candidate: Candidate;
  onPick: (personId: string) => void;
  disabled: boolean;
}) {
  const blocked =
    candidate.availabilityConflicts.length > 0 ||
    candidate.overlappingAssignments.length > 0 ||
    candidate.previouslyDeclined;

  return (
    <li
      className={`border rounded-md p-3 ${blocked ? "bg-muted/30 opacity-80" : "bg-card"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{candidate.person.name}</span>
            {candidate.person.department && (
              <span className="text-xs text-muted-foreground">
                {candidate.person.department}
              </span>
            )}
            {candidate.previouslyDeclined && (
              <Badge variant="outline" className="font-normal">
                <Ban className="size-3 mr-1" /> previously declined
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {candidate.currentHoursIn14DayWindow.toFixed(1)}h scheduled in ±7d
            {candidate.maxHoursPerWeek != null && (
              <> · cap {candidate.maxHoursPerWeek}h/wk</>
            )}
          </div>
          {candidate.availabilityConflicts.map((c, i) => (
            <div
              key={`av-${i}`}
              className="text-xs text-amber-600 mt-1 flex items-center gap-1"
            >
              <AlertTriangle className="size-3" />
              {c.type} blocks {formatRange(c.start, c.end)}
            </div>
          ))}
          {candidate.overlappingAssignments.map((o, i) => (
            <div
              key={`ov-${i}`}
              className="text-xs text-amber-600 mt-1 flex items-center gap-1"
            >
              <AlertTriangle className="size-3" />
              also on "{o.eventTitle}" {formatRange(o.start, o.end)}
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant={blocked ? "outline" : "default"}
          disabled={disabled}
          onClick={() => onPick(candidate.person.id)}
          title={
            blocked
              ? "This person has a conflict — assigning anyway will likely create a problem"
              : "Replace with this person"
          }
        >
          Pick
        </Button>
      </div>
    </li>
  );
}

export function DeclineAssignmentDialog({ assignment, onClose, onResolved }: Props) {
  const open = !!assignment;
  const eventId = assignment?.event.id ?? null;
  const { data, isLoading, error } = useEventCandidates(eventId);
  const decline = useDeclineAssignment();

  const performDecline = async (replacementPersonId?: string) => {
    if (!assignment) return;
    try {
      const res = await decline.mutateAsync({
        id: assignment.id,
        replacementPersonId,
      });
      onResolved(res.updatedAssignments, !!replacementPersonId);
      toast.success(
        replacementPersonId
          ? `Declined ${assignment.person.name} and assigned replacement`
          : `Declined ${assignment.person.name} — re-solving to surface the gap`,
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Decline failed");
    }
  };

  // Exclude the current assignment's person from the candidate list — they're
  // the one being declined.
  const candidates = (data?.candidates ?? []).filter(
    (c) => c.person.id !== assignment?.person.id,
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="size-5 text-destructive" />
            Decline {assignment?.person.name}
          </DialogTitle>
          <DialogDescription>
            From "{assignment?.event.title}"{" "}
            {assignment && formatRange(assignment.event.startDateTime, assignment.event.endDateTime)}.
            {assignment?.status === "confirmed" && (
              <>
                {" "}
                <span className="text-amber-600">
                  This assignment is synced to Outlook — declining removes the
                  calendar event.
                </span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <h3 className="text-sm font-medium">
            Pick a replacement{" "}
            <span className="text-muted-foreground font-normal">
              (qualified, ranked by current load)
            </span>
          </h3>
          {isLoading && (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading candidates…
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive">
              Couldn't load candidates: {error.message}
            </p>
          )}
          {data && candidates.length === 0 && (
            <div className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30 flex items-center gap-2">
              <CheckCircle2 className="size-4" />
              No other qualified people exist for this event.
            </div>
          )}
          {candidates.length > 0 && (
            <ul className="space-y-2 max-h-72 overflow-y-auto">
              {candidates.map((c) => (
                <CandidateRow
                  key={c.person.id}
                  candidate={c}
                  onPick={performDecline}
                  disabled={decline.isPending}
                />
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="flex-row justify-between items-center gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => performDecline()}
            disabled={decline.isPending}
            title="Decline without picking a replacement; re-generate the schedule to repick"
          >
            Decline without replacement
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={decline.isPending}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
