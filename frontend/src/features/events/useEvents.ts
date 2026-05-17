import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Event, CreateEventInput } from "@/lib/types";

const KEY = ["events"] as const;

export function useEvents() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<Event[]>("/api/events"),
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => api.post<Event>("/api/events", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreateEventInput> }) =>
      api.patch<Event>(`/api/events/${id}`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/events/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
