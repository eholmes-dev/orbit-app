import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GenerateScheduleResult,
  ScheduleAssignment,
  ScheduleConflict,
} from "@/lib/types";

/**
 * The "current view" of the schedule the admin is looking at. Lives in the
 * TanStack Query cache (not SchedulePage local state) so navigating to other
 * pages and back doesn't wipe it. Only a fresh Generate replaces it; smaller
 * mutations patch in place via the patcher returned by useScheduleViewActions.
 */
export interface ScheduleView extends GenerateScheduleResult {
  /** The date range the user generated this view for; used to re-seed the
   *  date pickers on remount. */
  range: { startDate: string; endDate: string };
  generatedAt: string;
}

const KEY = ["schedule", "view"] as const;

export function useScheduleView() {
  return useQuery<ScheduleView | null>({
    queryKey: KEY,
    // We never auto-fetch — the cache is populated by setView() and patched
    // by the mutation handlers. queryFn returns the current cached value or
    // null if nothing has been generated this session.
    queryFn: () => Promise.resolve(null),
    staleTime: Infinity,
    gcTime: Infinity,
    initialData: null,
    enabled: false,
  });
}

export function useScheduleViewActions() {
  const qc = useQueryClient();
  return {
    setView: (view: ScheduleView | null) => {
      qc.setQueryData<ScheduleView | null>(KEY, view);
    },
    clear: () => {
      qc.setQueryData<ScheduleView | null>(KEY, null);
    },
    patchAssignments: (
      updater: (prev: ScheduleAssignment[]) => ScheduleAssignment[],
    ) => {
      qc.setQueryData<ScheduleView | null>(KEY, (prev) => {
        if (!prev) return prev;
        return { ...prev, assignments: updater(prev.assignments) };
      });
    },
    patchConflicts: (
      updater: (prev: ScheduleConflict[]) => ScheduleConflict[],
    ) => {
      qc.setQueryData<ScheduleView | null>(KEY, (prev) => {
        if (!prev) return prev;
        return { ...prev, conflicts: updater(prev.conflicts) };
      });
    },
  };
}
