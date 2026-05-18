import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GenerateScheduleResult, ScheduleAssignment } from "@/lib/types";

/**
 * Fetches the current set of (non-declined) assignments overlapping a date
 * range. This is the live source of truth for the Schedule grid — it
 * re-fetches on Generate / Confirm / Decline / Unsync / Assign so any
 * mutation reflects immediately. The cached generate result still drives
 * conflicts/warnings in the Assistant.
 *
 * Use `invalidateScheduleAssignments(queryClient)` after any mutation that
 * touches assignments to refresh.
 */
export function useScheduleAssignments(
  from: string | null,
  to: string | null,
) {
  return useQuery({
    enabled: !!from && !!to,
    queryKey: ["schedule", "assignments", from, to] as const,
    queryFn: () =>
      api.get<ScheduleAssignment[]>(
        `/api/schedule/assignments?from=${encodeURIComponent(from!)}&to=${encodeURIComponent(to!)}`,
      ),
    // Keep prior week's data visible while a new week's fetch is in flight,
    // so navigating week-to-week doesn't blank the grid.
    placeholderData: keepPreviousData,
  });
}

/** Invalidate every cached per-range assignment query at once. Call this
 *  inside mutation `onSuccess` to force the visible Schedule grid to refresh. */
export function invalidateScheduleAssignments(
  qc: ReturnType<typeof useQueryClient>,
) {
  qc.invalidateQueries({ queryKey: ["schedule", "assignments"] });
}

/**
 * Fetches every non-declined assignment in the DB (no date range filter).
 * Used by the Schedule page's "Assignments" panel so admins can see every
 * proposed/confirmed row regardless of which week the calendar is showing.
 */
export function useAllAssignments() {
  return useQuery({
    queryKey: ["schedule", "assignments", "all"] as const,
    queryFn: () =>
      api.get<ScheduleAssignment[]>("/api/schedule/assignments"),
  });
}

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

/** Error body returned by /events/:id/assign when the event is already at
 *  capacity. The frontend recognizes this and prompts admin to pick someone
 *  to replace, then retries with `replacePersonId` set. */
export interface EventFullyStaffedBody {
  code: "EVENT_FULLY_STAFFED";
  message: string;
  currentAssignments: Array<{
    assignmentId: string;
    personId: string;
    personName: string;
    status: "proposed" | "confirmed" | "conflict";
  }>;
}

export function useAssignToEvent() {
  return useMutation({
    mutationFn: ({
      eventId,
      personId,
      replacePersonId,
    }: {
      eventId: string;
      personId: string;
      /** When set, atomically removes this person's existing assignment for
       *  the event before assigning `personId`. */
      replacePersonId?: string;
    }) =>
      api.post<{ updatedAssignments: ScheduleAssignment[] }>(
        `/api/schedule/events/${eventId}/assign`,
        replacePersonId ? { personId, replacePersonId } : { personId },
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

export interface AcceptConflictResult {
  archiveEntryId: string;
  /** Backend also drops the event's `requiredStaffCount` to match the
   *  currently-assigned headcount, so future generates don't re-flag it.
   *  Returned for toast / UI feedback. */
  previousRequiredStaffCount: number;
  newRequiredStaffCount: number;
}

export function useAcceptConflict() {
  return useMutation({
    mutationFn: (input: AcceptConflictInput) =>
      api.post<AcceptConflictResult>("/api/schedule/conflicts/accept", input),
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
