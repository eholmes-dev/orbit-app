import { z } from "zod";

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime());

export const createEventSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    startDateTime: isoDateTime,
    endDateTime: isoDateTime,
    priorityTier: z.number().int().min(1).max(5),
    requiredStaffCount: z.number().int().min(1).max(50).default(1),
    isHardRequirement: z.boolean().default(false),
    recurrenceRule: z.string().trim().max(500).optional().nullable(),
    location: z.string().trim().max(200).optional().nullable(),
    requiredLabelIds: z.array(z.string()).optional(),
  })
  .refine(
    (v) => new Date(v.endDateTime).getTime() > new Date(v.startDateTime).getTime(),
    { message: "End must be after start", path: ["endDateTime"] },
  );

export const updateEventSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    startDateTime: isoDateTime.optional(),
    endDateTime: isoDateTime.optional(),
    priorityTier: z.number().int().min(1).max(5).optional(),
    requiredStaffCount: z.number().int().min(1).max(50).optional(),
    isHardRequirement: z.boolean().optional(),
    recurrenceRule: z.string().trim().max(500).optional().nullable(),
    location: z.string().trim().max(200).optional().nullable(),
    requiredLabelIds: z.array(z.string()).optional(),
  })
  .refine(
    (v) =>
      v.startDateTime === undefined ||
      v.endDateTime === undefined ||
      new Date(v.endDateTime).getTime() > new Date(v.startDateTime).getTime(),
    { message: "End must be after start", path: ["endDateTime"] },
  );

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
