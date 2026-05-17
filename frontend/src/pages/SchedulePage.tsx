import { useMemo, useState } from "react";
import { Play, AlertTriangle, AlertCircle, CheckCircle2 } from "lucide-react";
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
import { useGenerateSchedule } from "@/features/schedule/useSchedule";
import { useEvents } from "@/features/events/useEvents";
import type { GenerateScheduleResult, ScheduleAssignment, ConflictReason } from "@/lib/types";

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

export function SchedulePage() {
  const [startDate, setStartDate] = useState(todayLocal());
  const [endDate, setEndDate] = useState(plusDaysLocal(30));
  const { data: events } = useEvents();
  const generate = useGenerateSchedule();

  const result: GenerateScheduleResult | undefined = generate.data;

  const grouped = useMemo(
    () => (result ? groupByDay(result.assignments) : []),
    [result],
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

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          Generate a proposed schedule for a date range. Conflicts and warnings
          surface below — review before locking and syncing (Phase 3).
        </p>
      </div>

      <div className="flex items-end gap-4 border rounded-lg bg-card p-4">
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

      {result && (
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-lg font-medium">Proposed assignments</h2>
              {grouped.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No assignments were made in this range.
                </p>
              )}
              {grouped.map(([day, assignments]) => (
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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assignments.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{a.event.title}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatRange(a.event.startDateTime, a.event.endDateTime)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">T{a.event.priorityTier}</Badge>
                          </TableCell>
                          <TableCell>{a.person.name}</TableCell>
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
                {result.conflicts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-green-600" /> No conflicts.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {result.conflicts.map((c, i) => (
                      <li
                        key={i}
                        className="border rounded-md p-3 bg-card text-sm"
                      >
                        <div className="font-medium">
                          {eventTitleById.get(c.event_id) ?? c.event_id}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="destructive">{REASON_LABEL[c.reason]}</Badge>
                          <span className="text-muted-foreground">
                            short {c.short_by}
                          </span>
                        </div>
                        <div className="mt-1 text-muted-foreground text-xs">
                          {c.message}
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
