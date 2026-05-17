import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DateTimeInput } from "@/components/DateTimeInput";
import { useLabels } from "@/features/labels/useLabels";
import type { Event } from "@/lib/types";

const schema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    startDateTime: z.string().min(1, "Start is required"),
    endDateTime: z.string().min(1, "End is required"),
    priorityTier: z.coerce.number().int().min(1).max(5),
    requiredStaffCount: z.coerce.number().int().min(1).max(50),
    isHardRequirement: z.boolean(),
    location: z.string().trim().max(200).optional(),
    recurrenceRule: z.string().trim().max(500).optional(),
    requiredLabelIds: z.array(z.string()),
  })
  .refine(
    (v) => new Date(v.endDateTime).getTime() > new Date(v.startDateTime).getTime(),
    { message: "End must be after start", path: ["endDateTime"] },
  );

export type EventFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<Event>;
  onSubmit: (values: EventFormValues) => Promise<void> | void;
  submitLabel: string;
  isSubmitting?: boolean;
}

// Convert a UTC ISO string -> "YYYY-MM-DDTHH:mm" suitable for <input type="datetime-local">.
function toLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const tzOffset = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
}

export function EventForm({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
}: Props) {
  const { data: labels } = useLabels();

  const form = useForm<EventFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: defaultValues?.title ?? "",
      startDateTime: toLocalInput(defaultValues?.startDateTime),
      endDateTime: toLocalInput(defaultValues?.endDateTime),
      priorityTier: defaultValues?.priorityTier ?? 3,
      requiredStaffCount: defaultValues?.requiredStaffCount ?? 1,
      isHardRequirement: defaultValues?.isHardRequirement ?? false,
      location: defaultValues?.location ?? "",
      recurrenceRule: defaultValues?.recurrenceRule ?? "",
      requiredLabelIds: defaultValues?.requiredLabels?.map((l) => l.id) ?? [],
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="OR-3 morning shift" {...field} />
              </FormControl>
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
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="priorityTier"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Priority tier</FormLabel>
                <Select
                  onValueChange={(v) => field.onChange(Number(v))}
                  value={String(field.value)}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="1">Tier 1 — highest</SelectItem>
                    <SelectItem value="2">Tier 2</SelectItem>
                    <SelectItem value="3">Tier 3</SelectItem>
                    <SelectItem value="4">Tier 4</SelectItem>
                    <SelectItem value="5">Tier 5 — lowest</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="requiredStaffCount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Required staff</FormLabel>
                <FormControl>
                  <Input type="number" min={1} max={50} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Location (optional)</FormLabel>
              <FormControl>
                <Input placeholder="Operating Room 3" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="isHardRequirement"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <FormLabel>Hard requirement</FormLabel>
                <FormDescription>
                  If on, this event must be fully staffed or it becomes a conflict.
                </FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="requiredLabelIds"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Required labels</FormLabel>
              <FormDescription>
                Only staff with all of these labels can be assigned.
              </FormDescription>
              <div className="border rounded-md p-3 max-h-44 overflow-auto space-y-2">
                {!labels?.length && (
                  <p className="text-sm text-muted-foreground">
                    No labels yet — create some on the Labels page first.
                  </p>
                )}
                {labels?.map((label) => {
                  const checked = field.value.includes(label.id);
                  return (
                    <label
                      key={label.id}
                      className="flex items-center gap-2 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(c) => {
                          if (c) field.onChange([...field.value, label.id]);
                          else
                            field.onChange(
                              field.value.filter((id) => id !== label.id),
                            );
                        }}
                      />
                      {label.name}
                    </label>
                  );
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="recurrenceRule"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Recurrence rule (RRULE, optional)</FormLabel>
              <FormDescription>
                Stored but not yet honored by the scheduler — recurrence support lands in Phase 4.
              </FormDescription>
              <FormControl>
                <Input placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
