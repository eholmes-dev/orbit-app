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

export interface UnconfirmResult {
  unconfirmed: number;
  failed: number;
  results: Array<{
    assignmentId: string;
    status: "unconfirmed" | "failed";
    error?: string;
  }>;
  updatedAssignments: ScheduleAssignment[];
}

export function useUnconfirmAssignments() {
  return useMutation({
    mutationFn: (input: { assignmentIds: string[] }) =>
      api.post<UnconfirmResult>("/api/schedule/unconfirm", input),
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
  pendingOverrideRequest: { id: string; sentAt: string } | null;
}

export interface CandidatesResponse {
  event: {
    id: string;
    title: string;
    startDateTime: string;
    endDateTime: string;
    requiredStaffCount: number;
  };
  currentAssignments: ScheduleAssignment[];
  candidates: Candidate[];
}

export function useEventCandidates(eventId: string | null) {
  return useQuery({
    enabled: !!eventId,
    queryKey: ["schedule", "candidates", eventId] as const,
    queryFn: () =>
      api.get<CandidatesResponse>(
        `/api/schedule/events/${eventId}/candidates`,
      ),
    // Auto-poll every 5s while there's at least one pending override request,
    // so the dialog reflects the recipient's accept/decline without an admin
    // refresh. Once nothing is pending, polling stops on the next tick.
    refetchInterval: (query) => {
      const data = query.state.data as CandidatesResponse | undefined;
      const hasPending = data?.candidates.some(
        (c) => c.pendingOverrideRequest !== null,
      );
      return hasPending ? 5000 : false;
    },
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

export interface OverrideRequestResult {
  id: string;
  sentTo: string;
  sentAt: string;
  expiresAt: string;
}

export function useRequestOverride() {
  return useMutation({
    mutationFn: ({
      eventId,
      personId,
      message,
    }: {
      eventId: string;
      personId: string;
      message?: string;
    }) =>
      api.post<OverrideRequestResult>(
        `/api/schedule/events/${eventId}/request-override`,
        { personId, message },
      ),
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
