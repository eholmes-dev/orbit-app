import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GenerateScheduleResult, ScheduleAssignment } from "@/lib/types";

interface GenerateInput {
  startDate: string;
  endDate: string;
  timeLimitSeconds?: number;
}

export function useGenerateSchedule() {
  return useMutation({
    mutationFn: (input: GenerateInput) =>
      api.post<GenerateScheduleResult>("/api/schedule/generate", input),
  });
}

export interface ConfirmResult {
  confirmed: number;
  failed: number;
  results: Array<{
    assignmentId: string;
    status: "confirmed" | "failed";
    error?: string;
  }>;
  updatedAssignments: ScheduleAssignment[];
}

export function useConfirmSchedule() {
  return useMutation({
    mutationFn: (input: { assignmentIds?: string[] }) =>
      api.post<ConfirmResult>("/api/schedule/confirm", input),
  });
}

export function useDeleteAssignment() {
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/schedule/assignments/${id}`),
  });
}

export interface DeclineResult {
  updatedAssignments: ScheduleAssignment[];
}

export function useDeclineAssignment() {
  return useMutation({
    mutationFn: ({
      id,
      replacementPersonId,
    }: {
      id: string;
      replacementPersonId?: string;
    }) =>
      api.post<DeclineResult>(`/api/schedule/assignments/${id}/decline`, {
        replacementPersonId,
      }),
  });
}

export interface Candidate {
  person: {
    id: string;
    name: string;
    email: string;
    department: string | null;
  };
  maxHoursPerWeek: number | null;
  currentHoursIn14DayWindow: number;
  availabilityConflicts: Array<{ type: string; start: string; end: string }>;
  overlappingAssignments: Array<{
    eventTitle: string;
    start: string;
    end: string;
  }>;
  previouslyDeclined: boolean;
}

export function useEventCandidates(eventId: string | null) {
  return useQuery({
    enabled: !!eventId,
    queryKey: ["schedule", "candidates", eventId] as const,
    queryFn: () =>
      api.get<{ candidates: Candidate[] }>(
        `/api/schedule/events/${eventId}/candidates`,
      ),
  });
}
