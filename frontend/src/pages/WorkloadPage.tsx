import { useMemo, useState } from "react";
import { BarChart3, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateTimeInput } from "@/components/DateTimeInput";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkload, type WorkloadRow } from "@/features/workload/useWorkload";
import { useScheduleView } from "@/features/schedule/useScheduleView";
import { SummaryCard } from "@/components/SummaryCard";

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

type SortKey =
  | "name"
  | "hours"
  | "cap"
  | "utilization"
  | "assignments";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

function sortRows(rows: WorkloadRow[], sort: SortState): WorkloadRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const cmp = (a: WorkloadRow, b: WorkloadRow): number => {
    switch (sort.key) {
      case "name":
        return a.person.name.localeCompare(b.person.name) * sign;
      case "hours":
        return (a.hoursAssigned - b.hoursAssigned) * sign;
      case "cap":
        return ((a.maxHoursPerWeek ?? -1) - (b.maxHoursPerWeek ?? -1)) * sign;
      case "utilization":
        return ((a.utilization ?? -1) - (b.utilization ?? -1)) * sign;
      case "assignments":
        return (a.assignmentCount - b.assignmentCount) * sign;
    }
  };
  return [...rows].sort(cmp);
}

function SortHeader({
  label,
  sortKey,
  current,
  onClick,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  current: SortState;
  onClick: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = current.key === sortKey;
  const Icon = active
    ? current.dir === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wide ${
        align === "right" ? "ml-auto" : ""
      } ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
    >
      {label}
      <Icon className="size-3" />
    </button>
  );
}

function UtilizationBar({
  utilization,
  hoursAssigned,
  maxHoursPerWeek,
  peakWeeklyHours,
}: {
  utilization: number | null;
  hoursAssigned: number;
  maxHoursPerWeek: number | null;
  peakWeeklyHours: number;
}) {
  if (utilization == null) {
    // No cap set — show a small neutral bar based on the max in the dataset.
    const bgWidth = Math.min(hoursAssigned * 1.5, 100);
    return (
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 h-2 bg-muted rounded-sm overflow-hidden min-w-15">
          <div
            className="h-full bg-muted-foreground/40"
            style={{ width: `${bgWidth}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap w-16 text-right">
          no cap
        </span>
      </div>
    );
  }
  const clipped = Math.min(utilization, 100);
  const over = utilization > 100;
  const barColor = over
    ? "bg-destructive"
    : utilization >= 80
      ? "bg-amber-500"
      : "bg-green-500";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 h-2 bg-muted rounded-sm overflow-hidden min-w-15">
        <div className={`h-full ${barColor}`} style={{ width: `${clipped}%` }} />
      </div>
      <span
        className={`text-xs whitespace-nowrap w-16 text-right ${
          over ? "text-destructive font-medium" : "text-muted-foreground"
        }`}
        title={`Peak ${peakWeeklyHours}h in a single ISO week ÷ ${maxHoursPerWeek}h/wk cap`}
      >
        {utilization}%
      </span>
    </div>
  );
}

export function WorkloadPage() {
  // Mirror the cached schedule range on mount so admins land on the same
  // window they just generated. The date pickers are independent local state
  // after that — admins can explore other ranges without disturbing the
  // schedule, and re-mounting (next visit) snaps back to the current cached
  // schedule range.
  const scheduleView = useScheduleView();
  const cachedRange = scheduleView.data?.range;
  const [from, setFrom] = useState(
    () => cachedRange?.startDate ?? monthRange(0)[0],
  );
  const [to, setTo] = useState(() => cachedRange?.endDate ?? monthRange(0)[1]);
  const [sort, setSort] = useState<SortState>({
    key: "hours",
    dir: "desc",
  });
  // Track whether the displayed range still matches the schedule's range, so
  // we can show a subtle hint and an "Out of sync" indicator once the admin
  // manually changes the dates.
  const matchesSchedule =
    !!cachedRange &&
    from === cachedRange.startDate &&
    to === cachedRange.endDate;

  const fromISO = useMemo(() => new Date(from).toISOString(), [from]);
  const toISO = useMemo(() => new Date(to).toISOString(), [to]);

  const { data, isLoading, isFetching, error } = useWorkload(fromISO, toISO);
  // `isLoading` is only true on the very first fetch (no data yet).
  // `isFetching` covers background range-change refetches — used to dim the
  // table without collapsing the layout.
  const isRefreshing = isFetching && !isLoading;

  const sortedRows = useMemo(
    () => (data ? sortRows(data.rows, sort) : []),
    [data, sort],
  );

  const setSortKey = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <BarChart3 className="size-6" /> Workload
        </h1>
        <p className="text-sm text-muted-foreground">
          Per-person hours assigned in the selected range, normalized to a
          per-week average for fair comparison against caps. Includes proposed
          and confirmed assignments; declined are excluded.
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
                setFrom(s);
                setTo(e);
              }}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium mb-1.5 block">From</label>
            <DateTimeInput value={from} onChange={setFrom} />
          </div>
          <div className="flex-1">
            <label className="text-sm font-medium mb-1.5 block">To</label>
            <DateTimeInput value={to} onChange={setTo} />
          </div>
        </div>
        {cachedRange && (
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            {matchesSchedule ? (
              <span>
                Mirroring the current Schedule range. Click Generate on
                Schedule to change.
              </span>
            ) : (
              <>
                <span>Out of sync with current Schedule range.</span>
                <button
                  type="button"
                  onClick={() => {
                    setFrom(cachedRange.startDate);
                    setTo(cachedRange.endDate);
                  }}
                  className="underline hover:text-foreground"
                >
                  Reset to Schedule range
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {isLoading && (
        <p className="text-muted-foreground text-sm">Loading…</p>
      )}
      {error && (
        <p className="text-destructive">
          Failed to load: {error.message}
        </p>
      )}

      {data && (
        <div
          className={`space-y-6 transition-opacity ${isRefreshing ? "opacity-50" : ""}`}
        >
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              label="Total hours"
              value={`${data.summary.totalHours}h`}
              hint={`${data.range.weeks}w window · ${data.summary.peopleWithAnyHours} of ${data.summary.peopleTotal} people involved`}
            />
            <SummaryCard
              label="Avg per active"
              value={`${data.summary.averagePerActivePerson}h`}
              hint={
                data.range.weeks > 0
                  ? `~${(data.summary.averagePerActivePerson / data.range.weeks).toFixed(1)}h/wk`
                  : ""
              }
            />
            <SummaryCard
              label="Spread"
              value={`${data.summary.spreadHours}h`}
              hint={`max ${data.summary.maxHours}h · min ${data.summary.minHours}h`}
              tone={data.summary.spreadHours > 20 ? "warn" : undefined}
            />
            <SummaryCard
              label="At/over cap"
              value={`${data.summary.peopleAtCap}`}
              hint={
                data.summary.peopleAtCap === 0
                  ? "everyone under their weekly cap"
                  : `${data.summary.peopleAtCap} ${data.summary.peopleAtCap === 1 ? "person" : "people"} at/over cap`
              }
              tone={data.summary.peopleAtCap > 0 ? "bad" : "good"}
            />
          </div>

          <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortHeader
                      label="Person"
                      sortKey="name"
                      current={sort}
                      onClick={setSortKey}
                    />
                  </TableHead>
                  <TableHead className="w-32 text-right">
                    <SortHeader
                      label="Hours"
                      sortKey="hours"
                      current={sort}
                      onClick={setSortKey}
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="w-24 text-right">
                    <SortHeader
                      label="Cap/wk"
                      sortKey="cap"
                      current={sort}
                      onClick={setSortKey}
                      align="right"
                    />
                  </TableHead>
                  <TableHead className="w-64">
                    <SortHeader
                      label="Utilization"
                      sortKey="utilization"
                      current={sort}
                      onClick={setSortKey}
                    />
                  </TableHead>
                  <TableHead className="w-24 text-right">
                    <SortHeader
                      label="# Asgn"
                      sortKey="assignments"
                      current={sort}
                      onClick={setSortKey}
                      align="right"
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground py-8"
                    >
                      No active people in the system.
                    </TableCell>
                  </TableRow>
                )}
                {sortedRows.map((r) => (
                  <TableRow key={r.person.id}>
                    <TableCell>
                      <div className="font-medium">{r.person.name}</div>
                      {r.person.department && (
                        <div className="text-xs text-muted-foreground">
                          {r.person.department}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium">{r.hoursAssigned}h</span>
                      {r.assignmentCount > 0 && (
                        <div className="text-xs text-muted-foreground">
                          peak {r.peakWeeklyHours}h/wk
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {r.maxHoursPerWeek ?? "—"}
                    </TableCell>
                    <TableCell>
                      <UtilizationBar
                        utilization={r.utilization}
                        hoursAssigned={r.hoursAssigned}
                        maxHoursPerWeek={r.maxHoursPerWeek}
                        peakWeeklyHours={r.peakWeeklyHours}
                      />
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {r.assignmentCount === 0 ? (
                        <Badge variant="outline" className="font-normal">
                          none
                        </Badge>
                      ) : (
                        r.assignmentCount
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
