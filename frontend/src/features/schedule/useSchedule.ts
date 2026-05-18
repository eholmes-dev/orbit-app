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
    fromAssignmentId: string;
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

export function useAssignToEvent() {
  return useMutation({
    mutationFn: ({ eventId, personId }: { eventId: string; personId: string }) =>
      api.post<{ updatedAssignments: ScheduleAssignment[] }>(
        `/api/schedule/events/${eventId}/assign`,
        { personId },
      ),
  });
}

export function useMoveAssignment() {
  return useMutation({
    mutationFn: ({
      fromAssignmentId,
      toEventId,
    }: {
      fromAssignmentId: string;
      toEventId: string;
    }) =>
      api.post<{
        updatedAssignments: ScheduleAssignment[];
        fromEventId: string;
        toEventId: string;
      }>(`/api/schedule/assignments/${fromAssignmentId}/move`, { toEventId }),
  });
}

export interface AcceptConflictInput {
  eventId: string;
  conflictReason: string;
  conflictShortBy: number;
}

export function useAcceptConflict() {
  return useMutation({
    mutationFn: (input: AcceptConflictInput) =>
      api.post<{ archiveEntryId: string }>("/api/schedule/conflicts/accept", input),
  });
}

export interface CancelConflictInput extends AcceptConflictInput {
  reason: string;
}

export type CancelConflictResult =
  | {
      action: "reduced";
      previousRequiredStaffCount: number;
      newRequiredStaffCount: number;
    }
  | { action: "cancelled"; cancelledEventId: string };

export function useCancelConflict() {
  return useMutation({
    mutationFn: (input: CancelConflictInput) =>
      api.post<CancelConflictResult>("/api/schedule/conflicts/cancel", input),
  });
}

export type ArchiveKind =
  | "declined_assignment"
  | "accepted_conflict"
  | "cancelled_event"
  | "reduced_requirement";

export interface ArchiveEntry {
  id: string;
  kind: ArchiveKind;
  eventId: string;
  event: {
    id: string;
    title: string;
    startDateTime: string;
    endDateTime: string;
    cancelledAt: string | null;
  };
  personId: string | null;
  person: { id: string; name: string; email: string } | null;
  reason: string | null;
  conflictReason: string | null;
  conflictShortBy: number | null;
  previousRequiredStaffCount: number | null;
  newRequiredStaffCount: number | null;
  createdAt: string;
}

export function useArchive() {
  return useQuery({
    queryKey: ["archive"] as const,
    queryFn: () => api.get<ArchiveEntry[]>("/api/schedule/archive"),
  });
}
