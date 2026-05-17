import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Pencil, Trash2, Plus, CalendarOff } from "lucide-react";
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
  usePeople,
  useCreatePerson,
  useUpdatePerson,
  useDeletePerson,
} from "@/features/people/usePeople";
import { PersonForm, type PersonFormValues } from "@/features/people/PersonForm";
import type { Person, CreatePersonInput } from "@/lib/types";

function toApiInput(values: PersonFormValues): CreatePersonInput {
  return {
    name: values.name,
    email: values.email,
    department: values.department?.trim() ? values.department : null,
    active: values.active,
    maxHoursPerWeek:
      values.maxHoursPerWeek === "" || values.maxHoursPerWeek === undefined
        ? null
        : values.maxHoursPerWeek,
    preferredHours:
      values.preferredHours === "" || values.preferredHours === undefined
        ? null
        : values.preferredHours,
    labelIds: values.labelIds,
  };
}

export function PeoplePage() {
  const { data: people, isLoading, error } = usePeople();
  const createMutation = useCreatePerson();
  const updateMutation = useUpdatePerson();
  const deleteMutation = useDeletePerson();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [deleting, setDeleting] = useState<Person | null>(null);

  // Open the edit dialog automatically when navigated to with ?edit=<id> (e.g.,
  // from the Schedule page's person-name links).
  const [searchParams, setSearchParams] = useSearchParams();
  const editIdFromUrl = searchParams.get("edit");
  useEffect(() => {
    if (!editIdFromUrl || !people || editing) return;
    const target = people.find((p) => p.id === editIdFromUrl);
    if (target) setEditing(target);
  }, [editIdFromUrl, people, editing]);

  const clearEditParam = () => {
    if (!editIdFromUrl) return;
    const next = new URLSearchParams(searchParams);
    next.delete("edit");
    setSearchParams(next, { replace: true });
  };

  const handleCreate = async (values: PersonFormValues) => {
    try {
      await createMutation.mutateAsync(toApiInput(values));
      toast.success(`Added ${values.name}`);
      setCreateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add person");
    }
  };

  const handleUpdate = async (values: PersonFormValues) => {
    if (!editing) return;
    try {
      await updateMutation.mutateAsync({ id: editing.id, input: toApiInput(values) });
      toast.success(`Updated ${values.name}`);
      setEditing(null);
      clearEditParam();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success(`Removed ${deleting.name}`);
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="text-sm text-muted-foreground">
            Doctors and faculty available for scheduling.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add person
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New person</DialogTitle>
              <DialogDescription>
                Add someone who can be scheduled to events.
              </DialogDescription>
            </DialogHeader>
            <PersonForm
              onSubmit={handleCreate}
              submitLabel="Add person"
              isSubmitting={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && (
        <p className="text-destructive">
          Failed to load people: {error.message}
        </p>
      )}

      {people && (
        <div className="border rounded-lg bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Labels</TableHead>
                <TableHead className="w-20">Active</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    No people yet. Click "Add person" to create your first one.
                  </TableCell>
                </TableRow>
              )}
              {people.map((person) => (
                <TableRow key={person.id}>
                  <TableCell className="font-medium">{person.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {person.email}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {person.department ?? "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {person.labels.length === 0 ? (
                        <span className="text-muted-foreground text-sm">—</span>
                      ) : (
                        person.labels.map((l) => (
                          <Badge key={l.id} variant="secondary">
                            {l.name}
                          </Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {person.active ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" asChild title="Availability">
                      <Link to={`/availability?personId=${person.id}`}>
                        <CalendarOff className="size-4" />
                      </Link>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditing(person)}
                      title="Edit"
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleting(person)}
                      title="Delete"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            clearEditParam();
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit person</DialogTitle>
          </DialogHeader>
          {editing && (
            <PersonForm
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
            <AlertDialogTitle>Remove {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the person and all their availability records and
              assignments. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
