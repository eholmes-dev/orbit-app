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
import { Switch } from "@/components/ui/switch";
import { useLabels } from "@/features/labels/useLabels";
import type { Person } from "@/lib/types";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Must be a valid email").max(320),
  department: z.string().trim().max(100).optional(),
  active: z.boolean(),
  maxHoursPerWeek: z
    .union([z.coerce.number().int().min(0).max(168), z.literal("")])
    .optional(),
  preferredHours: z
    .union([z.coerce.number().int().min(0).max(168), z.literal("")])
    .optional(),
  labelIds: z.array(z.string()),
});

export type PersonFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<Person>;
  onSubmit: (values: PersonFormValues) => Promise<void> | void;
  submitLabel: string;
  isSubmitting?: boolean;
}

export function PersonForm({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
}: Props) {
  const { data: labels } = useLabels();

  const form = useForm<PersonFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      email: defaultValues?.email ?? "",
      department: defaultValues?.department ?? "",
      active: defaultValues?.active ?? true,
      maxHoursPerWeek: defaultValues?.maxHoursPerWeek ?? "",
      preferredHours: defaultValues?.preferredHours ?? "",
      labelIds: defaultValues?.labels?.map((l) => l.id) ?? [],
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Dr. Jane Smith" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="jane@hospital.org" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="department"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Department (optional)</FormLabel>
              <FormControl>
                <Input placeholder="Cardiology" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="maxHoursPerWeek"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Max hours / week</FormLabel>
                <FormControl>
                  <Input type="number" min={0} max={168} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="preferredHours"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Preferred hours</FormLabel>
                <FormControl>
                  <Input type="number" min={0} max={168} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="active"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <FormLabel>Active</FormLabel>
                <FormDescription>
                  Inactive staff are excluded from scheduling.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="labelIds"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Labels</FormLabel>
              <FormDescription>
                Qualifications and roles this person can fill.
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
                          if (c)
                            field.onChange([...field.value, label.id]);
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
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
