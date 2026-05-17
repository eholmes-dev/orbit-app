import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime());

export const generateScheduleSchema = z
  .object({
    startDate: isoDateTime,
    endDate: isoDateTime,
    timeLimitSeconds: z.number().int().min(1).max(120).optional(),
  })
  .refine(
    (v) => new Date(v.endDate).getTime() > new Date(v.startDate).getTime(),
    { message: "endDate must be after startDate", path: ["endDate"] },
  );

export type GenerateScheduleInput = z.infer<typeof generateScheduleSchema>;
