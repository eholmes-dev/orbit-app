import { useState } from "react";
import { Ban, MinusCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  useCancelConflict,
  type CancelConflictInput,
  type CancelConflictResult,
} from "@/features/schedule/useSchedule";

interface Props {
  open: boolean;
  input: Omit<CancelConflictInput, "reason"> | null;
  eventTitle: string | undefined;
  /** Number of currently-assigned people (non-declined) for the event. */
  currentAssignedCount: number;
  /** Original requiredStaffCount, used to show "reduce from X to Y" preview. */
  originalRequiredStaffCount: number;
  onClose: () => void;
  onSuccess: (eventId: string, result: CancelConflictResult) => void;
}

export function CancelConflictDialog({
  open,
  input,
  eventTitle,
  currentAssignedCount,
  originalRequiredStaffCount,
  onClose,
  onSuccess,
}: Props) {
  const [reason, setReason] = useState("");
  const cancel = useCancelConflict();

  const isPartial = currentAssignedCount > 0;

  const reset = () => {
    setReason("");
    onClose();
  };

  const submit = async () => {
    if (!input) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Reason is required");
      return;
    }
    try {
      const res = await cancel.mutateAsync({ ...input, reason: trimmed });
      if (res.action === "reduced") {
        toast.success(
          `Requirement reduced from ${res.previousRequiredStaffCount} to ${res.newRequiredStaffCount} — partial coverage accepted`,
        );
      } else {
        toast.success("Event cancelled and archived");
      }
      setReason("");
      onSuccess(input.eventId, res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && reset()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isPartial ? (
              <>
                <MinusCircle className="size-5 text-amber-500" />
                Accept partial coverage for "{eventTitle ?? "event"}"?
              </>
            ) : (
              <>
                <Ban className="size-5 text-destructive" />
                Cancel "{eventTitle ?? "event"}"?
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isPartial ? (
              <>
                Currently <strong>{currentAssignedCount} of{" "}
                {originalRequiredStaffCount}</strong> staff assigned. This will
                reduce the requirement to {currentAssignedCount} — the event
                stays active, existing assignments stay in place, and the
                conflict goes away. Recorded in the archive.
              </>
            ) : (
              <>
                Nobody is assigned to this event. The event will be marked
                cancelled and excluded from future generates. Recorded in the
                archive.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">
            Reason <span className="text-destructive">*</span>
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isPartial
                ? "e.g. Coverage gap acceptable — we'll cross-cover from adjacent shift"
                : "e.g. Replaced with an external locum / Surgery moved to next week"
            }
            rows={3}
            disabled={cancel.isPending}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={reset} disabled={cancel.isPending}>
            Keep as-is
          </Button>
          <Button
            variant={isPartial ? "default" : "destructive"}
            onClick={submit}
            disabled={cancel.isPending || !reason.trim()}
          >
            {cancel.isPending
              ? isPartial
                ? "Reducing…"
                : "Cancelling…"
              : isPartial
                ? `Reduce to ${currentAssignedCount}`
                : "Cancel & archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
