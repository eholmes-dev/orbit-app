import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Event, CreateEventInput } from "@/lib/types";

const KEY = ["events"] as const;
/** Variant that includes cancelled events — used by the Events admin page so
 *  admins can find / restore them. Keyed separately from the default query
 *  so the cache for each is independent. */
const KEY_INCLUDING_CANCELLED = ["events", "includeCancelled"] as const;

interface UseEventsOptions {
  /** Default false. When true, cancelled events are included in the result. */
  includeCancelled?: boolean;
}

export function useEvents({ includeCancelled = false }: UseEventsOptions = {}) {
  return useQuery({
    queryKey: includeCancelled ? KEY_INCLUDING_CANCELLED : KEY,
    queryFn: () =>
      api.get<Event[]>(
        includeCancelled
          ? "/api/events?includeCancelled=true"
          : "/api/events",
      ),
  });
}

/** Invalidate every cache that embeds event data. Assignments include
 *  event.title / start / end / requiredLabels (see backend's
 *  `assignmentIncludeForResponse`), and the Resolve dialog's candidate query
 *  also reads event details — both must refetch when events change or the
 *  Schedule grid will keep rendering stale titles/times. */
function invalidateAllEvents(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["events"] });
  qc.invalidateQueries({ queryKey: ["schedule", "assignments"] });
  qc.invalidateQueries({ queryKey: ["schedule", "candidates"] });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => api.post<Event>("/api/events", input),
    onSuccess: () => invalidateAllEvents(qc),
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreateEventInput> }) =>
      api.patch<Event>(`/api/events/${id}`, input),
    onSuccess: () => invalidateAllEvents(qc),
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/events/${id}`),
    onSuccess: () => invalidateAllEvents(qc),
  });
}

export function useRestoreEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Event>(`/api/events/${id}/restore`, {}),
    onSuccess: () => invalidateAllEvents(qc),
  });
}
