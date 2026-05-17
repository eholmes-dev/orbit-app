import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useCreateAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAvailabilityInput) =>
      api.post<Availability>("/api/availability", input),
    onSuccess: (record) =>
      qc.invalidateQueries({ queryKey: KEY(record.personId) }),
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
    onSuccess: (record) =>
      qc.invalidateQueries({ queryKey: KEY(record.personId) }),
  });
}

export function useDeleteAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/availability/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["availability"] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["availability"] }),
  });
}
