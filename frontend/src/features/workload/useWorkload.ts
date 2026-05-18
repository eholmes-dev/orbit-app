import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface WorkloadRow {
  person: {
    id: string;
    name: string;
    email: string;
    department: string | null;
  };
  maxHoursPerWeek: number | null;
  hoursAssigned: number;
  avgHoursPerWeek: number;
  /** Hours in the busiest single ISO calendar week of the range. */
  peakWeeklyHours: number;
  /** (peakWeeklyHours / maxHoursPerWeek) × 100, or null if no cap. */
  utilization: number | null;
  assignmentCount: number;
}

export interface WorkloadSummary {
  totalHours: number;
  averagePerPerson: number;
  averagePerActivePerson: number;
  minHours: number;
  maxHours: number;
  spreadHours: number;
  peopleTotal: number;
  peopleWithAnyHours: number;
  peopleAtCap: number;
}

export interface WorkloadResponse {
  range: { from: string; to: string; weeks: number };
  summary: WorkloadSummary;
  rows: WorkloadRow[];
}

export function useWorkload(from: string | null, to: string | null) {
  return useQuery({
    enabled: !!from && !!to,
    queryKey: ["workload", from, to] as const,
    queryFn: () =>
      api.get<WorkloadResponse>(
        `/api/schedule/workload?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`,
      ),
    // Keep showing the previous range's data while a new range is fetching,
    // so the table doesn't collapse to an empty "Loading…" line on every
    // date change. Use `isFetching` in the UI to indicate the refresh.
    placeholderData: keepPreviousData,
  });
}
