import { AlertCircle, CheckCircle2, Wand2, Ban, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  ScheduleConflict,
  ConflictReason,
  Event,
} from "@/lib/types";

const REASON_LABEL: Record<ConflictReason, string> = {
  no_qualified_staff: "No qualified staff",
  no_availability: "No availability",
  capacity_exhausted: "Capacity exhausted",
  over_constrained: "Over-constrained",
};

interface Props {
  conflicts: ScheduleConflict[];
  eventsById: Map<string, Event>;
  /** Current assigned (non-declined) count per event id — used to decide
   *  whether the Accept-as-partial action is meaningful (only events with at
   *  least one assignment qualify; zero-filled events use Cancel instead). */
  assignedCountByEventId: Map<string, number>;
  onResolve: (conflict: ScheduleConflict) => void;
  onCancel: (conflict: ScheduleConflict) => void;
  /** Acknowledges a partial conflict as acceptable. Records an audit-only
   *  archive entry; does NOT change the event or its assignments. The
   *  conflict disappears from the panel after success. */
  onAccept: (conflict: ScheduleConflict) => void;
}

/** Strip the legacy `"<event-id>" is ...` prefix from conflict messages.
 *  Old generates (cached in localStorage) used the cuid as a prefix; new ones
 *  start with "Short by N — …" already. Capitalize the surviving sentence. */
function cleanMessage(message: string): string {
  const stripped = message.replace(/^"[^"]+"\s+is\s+/, "");
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

function formatEventTime(startISO: string, endISO: string): string {
  const s = new Date(startISO);
  const e = new Date(endISO);
  const dateFmt: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  const tFmt = (d: Date) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: d.getMinutes() === 0 ? undefined : "2-digit",
    })
      .format(d)
      .toLowerCase()
      .replace(" ", "");
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) {
    return `${s.toLocaleDateString(undefined, dateFmt)} · ${tFmt(s)}–${tFmt(e)}`;
  }
  return `${s.toLocaleDateString(undefined, dateFmt)} ${tFmt(s)} – ${e.toLocaleDateString(undefined, dateFmt)} ${tFmt(e)}`;
}

export function ConflictsPanel({
  conflicts,
  eventsById,
  assignedCountByEventId,
  onResolve,
  onCancel,
  onAccept,
}: Props) {
  return (
    <section className="border rounded-lg bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <AlertCircle className="size-4 text-destructive" />
        Conflicts
        {conflicts.length > 0 ? (
          <Badge variant="destructive" className="ml-auto">
            {conflicts.length}
          </Badge>
        ) : (
          <CheckCircle2 className="size-4 text-green-600 ml-auto" />
        )}
      </h3>
      {conflicts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No conflicts — every event is fully staffed.
        </p>
      ) : (
        <div className="space-y-2">
          {conflicts.map((c, i) => {
            const event = eventsById.get(c.event_id);
            const assignedNow = assignedCountByEventId.get(c.event_id) ?? 0;
            const isPartial = assignedNow > 0;
            return (
              <div
                key={`${c.event_id}-${i}`}
                className="border rounded-md p-2.5 bg-card text-sm space-y-1.5"
              >
                {event ? (
                  <div className="space-y-0.5">
                    <div className="font-medium truncate">{event.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatEventTime(event.startDateTime, event.endDateTime)}
                    </div>
                  </div>
                ) : (
                  <div className="font-medium italic text-muted-foreground">
                    Event no longer available
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="destructive" className="text-[10px]">
                    {REASON_LABEL[c.reason]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {event
                      ? `${assignedNow} of ${event.requiredStaffCount} filled · short ${c.short_by}`
                      : `short ${c.short_by}`}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground line-clamp-2">
                  {cleanMessage(c.message)}
                </div>
                <div className="flex gap-1.5 pt-1 flex-wrap">
                  <Button
                    size="sm"
                    onClick={() => onResolve(c)}
                    className="h-7 px-2"
                  >
                    <Wand2 className="size-3" /> Resolve
                  </Button>
                  {isPartial && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAccept(c)}
                      className="h-7 px-2"
                      title="Acknowledge this partial coverage. The event keeps its current assignments and disappears from Conflicts; nothing else changes."
                    >
                      <Check className="size-3" /> Accept partial
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCancel(c)}
                    className="h-7 px-2"
                  >
                    <Ban className="size-3" /> Cancel
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
