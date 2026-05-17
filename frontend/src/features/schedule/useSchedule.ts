import { useMutation } from "@tanstack/react-query";
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
