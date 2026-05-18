import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Pencil,
  Plus,
  CalendarOff,
  Users,
  UserMinus,
  UserCheck,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Label as UiLabel } from "@/components/ui/label";
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
  // `removing` drives a single confirmation dialog used for BOTH deactivation
  // and (if the person has no history) permanent deletion. The dialog inspects
  // the person's _count to decide which actions are offered.
  const [removing, setRemoving] = useState<Person | null>(null);
  const [showInactive, setShowInactive] = useState(false);

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

  const handleDeactivate = async () => {
    if (!removing) return;
    try {
      const res = await updateMutation.mutateAsync({
        id: removing.id,
        input: { active: false },
      });
      const summary = res._deactivation;
      let description = "Past schedules preserved. Hidden from future scheduling.";
      if (summary && summary.declined > 0) {
        description = `${summary.declined} future shift${summary.declined === 1 ? "" : "s"} cleared (now in Conflicts to backfill). Past schedules preserved.`;
      }
      if (summary && summary.outlookCleanupFailures.length > 0) {
        toast.warning(`Deactivated ${removing.name}`, {
          description: `${description} ${summary.outlookCleanupFailures.length} Outlook event${summary.outlookCleanupFailures.length === 1 ? "" : "s"} couldn't be cleaned up — delete manually.`,
          duration: 15_000,
        });
      } else {
        toast.success(`Deactivated ${removing.name}`, { description });
      }
      setRemoving(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deactivate");
    }
  };

  const handleActivate = async (person: Person) => {
    try {
      await updateMutation.mutateAsync({
        id: person.id,
        input: { active: true },
      });
      toast.success(`Reactivated ${person.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reactivate");
    }
  };

  const handleHardDelete = async () => {
    if (!removing) return;
    try {
      await deleteMutation.mutateAsync(removing.id);
      toast.success(`Permanently deleted ${removing.name}`);
      setRemoving(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  // Filter visible people. Inactive hidden by default; toggle reveals them.
  const visiblePeople = people?.filter((p) => showInactive || p.active) ?? [];
  const inactiveCount = people?.filter((p) => !p.active).length ?? 0;
  // Hybrid policy: hard-delete only allowed when the person has zero history.
  const hasHistory =
    removing &&
    ((removing._count?.assignments ?? 0) > 0 ||
      (removing._count?.availability ?? 0) > 0);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Users className="size-6" /> People
          </h1>
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

      {people && inactiveCount > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <Switch
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
          <UiLabel htmlFor="show-inactive" className="text-sm font-normal">
            Include {inactiveCount} inactive{" "}
            {inactiveCount === 1 ? "person" : "people"}
          </UiLabel>
        </div>
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
              {visiblePeople.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-8"
                  >
                    {people.length === 0
                      ? `No people yet. Click "Add person" to create your first one.`
                      : "No active people. Toggle 'Include inactive' to show others."}
                  </TableCell>
                </TableRow>
              )}
              {visiblePeople.map((person) => (
                <TableRow
                  key={person.id}
                  className={person.active ? "" : "opacity-60"}
                >
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
                      aria-label={`Edit ${person.name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    {person.active ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setRemoving(person)}
                        title="Deactivate (or permanently delete if no history)"
                        aria-label={`Deactivate ${person.name}`}
                      >
                        <UserMinus className="size-4" />
                      </Button>
                    ) : (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleActivate(person)}
                        title="Reactivate"
                        aria-label={`Reactivate ${person.name}`}
                        disabled={updateMutation.isPending}
                      >
                        <UserCheck className="size-4" />
                      </Button>
                    )}
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
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {hasHistory ? (
                  <>
                    <p>
                      {removing?.name} has{" "}
                      <strong>
                        {removing?._count?.assignments ?? 0} assignment
                        {removing?._count?.assignments === 1 ? "" : "s"}
                      </strong>{" "}
                      and{" "}
                      <strong>
                        {removing?._count?.availability ?? 0} availability
                        {removing?._count?.availability === 1 ? " entry" : " entries"}
                      </strong>{" "}
                      on record.
                    </p>
                    <p>
                      Deactivating preserves that history (past schedules still
                      show them) but hides them from future scheduling and
                      pickers. You can reactivate later.
                    </p>
                  </>
                ) : (
                  <>
                    <p>
                      {removing?.name} has no assignments or availability on
                      record yet. You can deactivate them (reversible) or
                      permanently delete them.
                    </p>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-between">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <div className="flex gap-2">
              {!hasHistory && (
                <Button
                  variant="destructive"
                  onClick={handleHardDelete}
                  disabled={deleteMutation.isPending || updateMutation.isPending}
                >
                  Permanently delete
                </Button>
              )}
              <AlertDialogAction
                onClick={handleDeactivate}
                disabled={updateMutation.isPending}
              >
                Deactivate
              </AlertDialogAction>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
