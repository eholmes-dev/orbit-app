import { z } from "zod";

export const availabilityType = z.enum([
  "vacation",
  "PTO",
  "appointment",
  "blocked",
  "recurring",
]);

const isoDateTime = z.string().datetime({ offset: true }).or(z.string().datetime());

export const createAvailabilitySchema = z
  .object({
    personId: z.string().min(1),
    type: availabilityType,
    startDateTime: isoDateTime,
    endDateTime: isoDateTime,
  })
  .refine(
    (v) => new Date(v.endDateTime).getTime() > new Date(v.startDateTime).getTime(),
    { message: "End must be after start", path: ["endDateTime"] },
  );

export const updateAvailabilitySchema = z
  .object({
    type: availabilityType.optional(),
    startDateTime: isoDateTime.optional(),
    endDateTime: isoDateTime.optional(),
  })
  .refine(
    (v) =>
      v.startDateTime === undefined ||
      v.endDateTime === undefined ||
      new Date(v.endDateTime).getTime() > new Date(v.startDateTime).getTime(),
    { message: "End must be after start", path: ["endDateTime"] },
  );

export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;
