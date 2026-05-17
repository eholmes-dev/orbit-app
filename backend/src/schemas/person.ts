import { z } from "zod";

export const createPersonSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Must be a valid email").max(320),
  department: z.string().trim().max(100).optional().nullable(),
  active: z.boolean().optional(),
  maxHoursPerWeek: z.number().int().min(0).max(168).optional().nullable(),
  preferredHours: z.number().int().min(0).max(168).optional().nullable(),
  outlookAccountId: z.string().trim().max(200).optional().nullable(),
  labelIds: z.array(z.string()).optional(),
});

export const updatePersonSchema = createPersonSchema.partial();

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
