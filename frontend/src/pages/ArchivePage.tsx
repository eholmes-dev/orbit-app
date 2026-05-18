import { useMemo, useState } from "react";
import {
  UserX,
  Check,
  Ban,
  MinusCircle,
  Archive as ArchiveIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useArchive, type ArchiveKind } from "@/features/schedule/useSchedule";
import { useEvents } from "@/features/events/useEvents";

const KIND_LABEL: Record<ArchiveKind, string> = {
  declined_assignment: "Declined",
  accepted_conflict: "Accepted conflict",
  cancelled_event: "Cancelled event",
  reduced_requirement: "Reduced requirement",
};

function KindBadge({ kind }: { kind: ArchiveKind }) {
  if (kind === "declined_assignment") {
    return (
      <Badge variant="outline">
        <UserX className="size-3 mr-1" /> {KIND_LABEL[kind]}
      </Badge>
    );
  }
  if (kind === "accepted_conflict") {
    return (
      <Badge variant="secondary">
        <Check className="size-3 mr-1" /> {KIND_LABEL[kind]}
      </Badge>
    );
  }
  if (kind === "reduced_requirement") {
    return (
      <Badge variant="secondary">
        <MinusCircle className="size-3 mr-1" /> {KIND_LABEL[kind]}
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <Ban className="size-3 mr-1" /> {KIND_LABEL[kind]}
    </Badge>
  );
}

const CONFLICT_REASON_LABEL: Record<string, string> = {
  no_qualified_staff: "No qualified staff",
  no_availability: "No availability",
  capacity_exhausted: "Capacity exhausted",
  over_constrained: "Over-constrained",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Replace any cuid in an archive reason with its event title — handles
 *  legacy entries written when the backend stored raw cuids (e.g.
 *  "Moved to event cmpadte1r0000qmw9dl4h4eu3"). Modern entries already use
 *  titles and pass through unchanged. */
function humanizeReason(
  reason: string,
  eventTitleById: Map<string, string>,
): string {
  // cuid format: starts with 'c', 25 chars of [a-z0-9].
  return reason.replace(/c[a-z0-9]{24}/g, (id) => {
    const title = eventTitleById.get(id);
    return title ? `"${title}"` : "another event";
  });
}

function formatEventRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const fmt: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  return `${s.toLocaleString(undefined, fmt)} – ${e.toLocaleString(undefined, fmt)}`;
}

export function ArchivePage() {
  const { data: entries, isLoading, error } = useArchive();
  // Include cancelled events so historical "Moved to <event>" references still
  // resolve to a readable title after the target was later cancelled.
  const { data: events } = useEvents({ includeCancelled: true });
  const [filter, setFilter] = useState<ArchiveKind | "all">("all");

  const eventTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events ?? []) m.set(e.id, e.title);
    return m;
  }, [events]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    if (filter === "all") return entries;
    return entries.filter((e) => e.kind === filter);
  }, [entries, filter]);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ArchiveIcon className="size-6" /> Archive
        </h1>
        <p className="text-sm text-muted-foreground">
          Audit log of admin decisions: declined assignments, accepted
          conflicts, and cancelled events.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-muted-foreground self-center mr-1">
          Filter:
        </span>
        {(
          [
            ["all", "All"],
            ["declined_assignment", "Declines"],
            ["accepted_conflict", "Accepted"],
            ["reduced_requirement", "Reduced"],
            ["cancelled_event", "Cancelled"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? "default" : "outline"}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {isLoading && (
        <p className="text-muted-foreground">Loading archive…</p>
      )}
      {error && (
        <p className="text-destructive">
          Failed to load: {error.message}
        </p>
      )}

      {entries && (
        <div className="border rounded-lg bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">When</TableHead>
                <TableHead className="w-40">Kind</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
                    {filter === "all"
                      ? "No archive entries yet."
                      : `No ${KIND_LABEL[filter as ArchiveKind].toLowerCase()} entries.`}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-sm whitespace-nowrap">
                    {formatDateTime(e.createdAt)}
                  </TableCell>
                  <TableCell>
                    <KindBadge kind={e.kind} />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{e.event.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatEventRange(
                        e.event.startDateTime,
                        e.event.endDateTime,
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {e.person ? (
                      <span>{e.person.name}</span>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.conflictReason && (
                      <div className="text-muted-foreground text-xs">
                        {CONFLICT_REASON_LABEL[e.conflictReason] ??
                          e.conflictReason}
                        {e.conflictShortBy != null && (
                          <> · short {e.conflictShortBy}</>
                        )}
                      </div>
                    )}
                    {e.kind === "reduced_requirement" &&
                      e.previousRequiredStaffCount != null &&
                      e.newRequiredStaffCount != null && (
                        <div className="text-xs">
                          Required staff: {e.previousRequiredStaffCount} →{" "}
                          <strong>{e.newRequiredStaffCount}</strong>
                        </div>
                      )}
                    {e.reason && (
                      <div>{humanizeReason(e.reason, eventTitleById)}</div>
                    )}
                    {!e.reason && !e.conflictReason && (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
