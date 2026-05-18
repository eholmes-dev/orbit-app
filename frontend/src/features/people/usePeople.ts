import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Person, CreatePersonInput } from "@/lib/types";

const KEY = ["people"] as const;

/** Backend attaches this side-channel summary on PATCH responses when an
 *  active→inactive transition cascaded-declined future assignments. Lets the
 *  UI report how many shifts were cleared (and any Outlook failures). */
export interface DeactivationSummary {
  declined: number;
  outlookCleanupFailures: string[];
}
export type UpdatePersonResponse = Person & {
  _deactivation?: DeactivationSummary;
};

export function usePeople() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<Person[]>("/api/people"),
  });
}

export function useCreatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePersonInput) =>
      api.post<Person>("/api/people", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}

export function useUpdatePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<CreatePersonInput> }) =>
      api.patch<UpdatePersonResponse>(`/api/people/${id}`, input),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["labels"] });
      // Deactivation cascade touched assignments — refresh the schedule too.
      if (res._deactivation) {
        qc.invalidateQueries({ queryKey: ["schedule", "assignments", "range"] });
        qc.invalidateQueries({ queryKey: ["schedule", "assignments", "all"] });
      }
    },
  });
}

export function useDeletePerson() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/people/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ["labels"] });
    },
  });
}
