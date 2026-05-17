import { useState } from "react";
import { Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePeople } from "@/features/people/usePeople";
import {
  useAvailability,
  useCreateAvailability,
  useUpdateAvailability,
  useDeleteAvailability,
} from "@/features/availability/useAvailability";
import {
  AvailabilityForm,
  type AvailabilityFormValues,
} from "@/features/availability/AvailabilityForm";
import type {
  Availability,
  AvailabilityType,
  CreateAvailabilityInput,
} from "@/lib/types";

const TYPE_BADGE: Record<AvailabilityType, "default" | "secondary" | "outline"> = {
  vacation: "default",
  PTO: "default",
  appointment: "secondary",
  blocked: "outline",
  recurring: "secondary",
};

function formatRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const sameDay = s.toDateString() === e.toDateString();
  const dateFmt: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  const timeFmt: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (sameDay) {
    return `${s.toLocaleDateString(undefined, dateFmt)} · ${s.toLocaleTimeString(undefined, timeFmt)} – ${e.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${s.toLocaleString(undefined, { ...dateFmt, ...timeFmt })} – ${e.toLocaleString(undefined, { ...dateFmt, ...timeFmt })}`;
}

export function AvailabilityPage() {
  const { data: people } = usePeople();
  const [personId, setPersonId] = useState<string | null>(null);
  const { data: records, isLoading } = useAvailability(personId);

  const createMutation = useCreateAvailability();
  const updateMutation = useUpdateAvailability();
  const deleteMutation = useDeleteAvailability();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Availability | null>(null);
  const [deleting, setDeleting] = useState<Availability | null>(null);

  const selectedPerson = people?.find((p) => p.id === personId) ?? null;

  const toApiCreate = (values: AvailabilityFormValues): CreateAvailabilityInput => ({
    personId: personId!,
    type: values.type,
    startDateTime: new Date(values.startDateTime).toISOString(),
    endDateTime: new Date(values.endDateTime).toISOString(),
  });

  const handleCreate = async (values: AvailabilityFormValues) => {
    if (!personId) return;
    try {
      await createMutation.mutateAsync(toApiCreate(values));
      toast.success("Added availability");
      setCreateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleUpdate = async (values: AvailabilityFormValues) => {
    if (!editing) return;
    try {
      await updateMutation.mutateAsync({
        id: editing.id,
        input: {
          type: values.type,
          startDateTime: new Date(values.startDateTime).toISOString(),
          endDateTime: new Date(values.endDateTime).toISOString(),
        },
      });
      toast.success("Updated");
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success("Removed");
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Availability</h1>
        <p className="text-sm text-muted-foreground">
          Block out PTO, vacations, and other unavailable windows so the scheduler skips them.
        </p>
      </div>

      <div className="flex items-end justify-between gap-4 mb-6">
        <div className="w-72">
          <label className="text-sm font-medium mb-1.5 block">Person</label>
          <Select
            value={personId ?? undefined}
            onValueChange={(v) => setPersonId(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a person" />
            </SelectTrigger>
            <SelectContent>
              {people?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button disabled={!personId}>
              <Plus className="size-4" /> Add availability
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                New availability {selectedPerson && `for ${selectedPerson.name}`}
              </DialogTitle>
              <DialogDescription>
                The scheduler will treat this person as unavailable during this window.
              </DialogDescription>
            </DialogHeader>
            <AvailabilityForm
              onSubmit={handleCreate}
              submitLabel="Add"
              isSubmitting={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {!personId && (
        <p className="text-muted-foreground">Select a person above to view their availability.</p>
      )}

      {personId && isLoading && <p className="text-muted-foreground">Loading…</p>}

      {personId && records && (
        <div className="border rounded-lg bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Type</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="w-32">Source</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    No availability entries yet.
                  </TableCell>
                </TableRow>
              )}
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant={TYPE_BADGE[r.type]}>{r.type}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatRange(r.startDateTime, r.endDateTime)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {r.source}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(r)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleting(r)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit availability</DialogTitle>
          </DialogHeader>
          {editing && (
            <AvailabilityForm
              defaultValues={editing}
              onSubmit={handleUpdate}
              submitLabel="Save changes"
              isSubmitting={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this availability entry?</AlertDialogTitle>
            <AlertDialogDescription>
              The scheduler will resume treating this person as available during this window.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteMutation.isPending}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
