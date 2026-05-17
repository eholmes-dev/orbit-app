import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { GenerateScheduleResult } from "@/lib/types";

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
