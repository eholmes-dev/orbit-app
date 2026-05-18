import { Link } from "react-router-dom";
import { CheckCircle2, CloudOff, UserX, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ScheduleAssignment, AssignmentStatus } from "@/lib/types";

interface Props {
  assignments: ScheduleAssignment[];
  onUnsync: (assignment: ScheduleAssignment) => void;
  onDecline: (assignment: ScheduleAssignment) => void;
  /** Soft-delete a proposed assignment with no decline trail — the solver can
   *  re-suggest the same person on the next Generate. Only offered on
   *  proposed rows; confirmed rows must Unsync first. */
  onRemove?: (assignment: ScheduleAssignment) => void;
  /** Click on the row navigates the parent calendar to the assignment's week. */
  onRowClick?: (assignment: ScheduleAssignment) => void;
}

function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const dateFmt: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  const timeFmt: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) {
    return `${s.toLocaleDateString(undefined, dateFmt)} · ${s.toLocaleTimeString(undefined, timeFmt)} – ${e.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${s.toLocaleString(undefined, { ...dateFmt, ...timeFmt })} – ${e.toLocaleString(undefined, { ...dateFmt, ...timeFmt })}`;
}

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

export function ProposedAssignmentsTable({
  assignments,
  onUnsync,
  onDecline,
  onRemove,
  onRowClick,
}: Props) {
  const grouped = groupByDay(assignments);
  if (grouped.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-4">
        No assignments to show.
      </p>
    );
  }
  return (
    <div className="space-y-3">
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
                <TableRow
                  key={a.id}
                  onClick={() => onRowClick?.(a)}
                  className={
                    onRowClick
                      ? "cursor-pointer hover:bg-muted/40 transition-colors"
                      : undefined
                  }
                  title={
                    onRowClick ? "Click to view this week in the calendar" : undefined
                  }
                >
                  <TableCell className="font-medium">{a.event.title}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRange(a.event.startDateTime, a.event.endDateTime)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">T{a.event.priorityTier}</Badge>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Link
                      to={`/people?edit=${a.person.id}`}
                      className="hover:underline"
                    >
                      {a.person.name}
                    </Link>
                  </TableCell>
                  <TableCell>{statusBadge(a.status)}</TableCell>
                  <TableCell
                    className="text-right space-x-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {a.status === "confirmed" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onUnsync(a)}
                        title="Unsync from Outlook (revert to proposed). Keeps the assignment, just removes the calendar event."
                        aria-label={`Unsync ${a.person.name} from ${a.event.title}`}
                      >
                        <CloudOff className="size-4" />
                      </Button>
                    )}
                    {a.status === "proposed" && onRemove && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onRemove(a)}
                        title="Remove this proposed assignment. No decline trail — solver can re-suggest the same person next Generate."
                        aria-label={`Remove ${a.person.name} from ${a.event.title}`}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => onDecline(a)}
                      title={
                        a.status === "confirmed"
                          ? "Decline (removes Outlook event AND assignment) and optionally pick a replacement. Solver remembers this as declined."
                          : "Decline and optionally pick a replacement. Solver will avoid re-suggesting this person for this event."
                      }
                      aria-label={`Decline ${a.person.name} from ${a.event.title}`}
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
  );
}
