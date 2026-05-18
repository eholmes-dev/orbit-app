import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Availability, CreateAvailabilityInput } from "@/lib/types";

const KEY = (personId: string | null) =>
  personId ? (["availability", personId] as const) : (["availability"] as const);

export function useAvailability(personId: string | null) {
  return useQuery({
    enabled: !!personId,
    queryKey: KEY(personId),
    queryFn: () =>
      api.get<Availability[]>(`/api/availability?personId=${personId}`),
  });
}

/**
 * All people's availability windows overlapping a date range. Used by the
 * Schedule grid to render block overlays (PTO / vacation / out-of-office)
 * on person rows so admins see at a glance who's unavailable when.
 */
export function useScheduleAvailability(
  from: string | null,
  to: string | null,
) {
  return useQuery({
    enabled: !!from && !!to,
    queryKey: ["availability", "range", from, to] as const,
    queryFn: () =>
      api.get<Availability[]>(
        `/api/availability?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`,
      ),
    placeholderData: keepPreviousData,
  });
}

// Helper: every range-availability query and every per-person availability
// query share the `["availability", ...]` prefix, so invalidating the bare
// `["availability"]` key invalidates all of them.
function invalidateAllAvailability(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["availability"] });
}

export function useCreateAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAvailabilityInput) =>
      api.post<Availability>("/api/availability", input),
    onSuccess: () => invalidateAllAvailability(qc),
  });
}

export function useUpdateAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: Partial<Omit<CreateAvailabilityInput, "personId">>;
    }) => api.patch<Availability>(`/api/availability/${id}`, input),
    onSuccess: () => invalidateAllAvailability(qc),
  });
}

export function useDeleteAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/availability/${id}`),
    onSuccess: () => invalidateAllAvailability(qc),
  });
}

export interface SyncResult {
  synced: number;
  perPerson: Array<{
    personId: string;
    email: string;
    status: "synced" | "error";
    count: number;
    error?: string;
  }>;
}

export function useSyncOutlookAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { personIds: string[]; from: string; to: string }) =>
      api.post<SyncResult>("/api/availability/sync-from-outlook", input),
    onSuccess: () => invalidateAllAvailability(qc),
  });
}
