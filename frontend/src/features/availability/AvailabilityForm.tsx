import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateTimeInput } from "@/components/DateTimeInput";
import type { Availability, AvailabilityType } from "@/lib/types";

const schema = z
  .object({
    type: z.enum(["vacation", "PTO", "appointment", "blocked", "recurring"]),
    startDateTime: z.string().min(1, "Start is required"),
    endDateTime: z.string().min(1, "End is required"),
  })
  .refine(
    (v) => new Date(v.endDateTime).getTime() > new Date(v.startDateTime).getTime(),
    { message: "End must be after start", path: ["endDateTime"] },
  );

export type AvailabilityFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<Availability>;
  onSubmit: (values: AvailabilityFormValues) => Promise<void> | void;
  submitLabel: string;
  isSubmitting?: boolean;
}

function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const tzOffset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

const TYPE_LABELS: Record<AvailabilityType, string> = {
  vacation: "Vacation",
  PTO: "PTO",
  appointment: "Appointment",
  blocked: "Blocked / unavailable",
  recurring: "Recurring block",
};

export function AvailabilityForm({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
}: Props) {
  const form = useForm<AvailabilityFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: defaultValues?.type ?? "PTO",
      startDateTime: toLocalInput(defaultValues?.startDateTime),
      endDateTime: toLocalInput(defaultValues?.endDateTime),
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="type"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as AvailabilityType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {TYPE_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="startDateTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Start</FormLabel>
                <FormControl>
                  <DateTimeInput
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="endDateTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>End</FormLabel>
                <FormControl>
                  <DateTimeInput
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
