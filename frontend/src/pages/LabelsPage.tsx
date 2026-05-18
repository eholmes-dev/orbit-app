import { useState } from "react";
import { Pencil, Trash2, Plus, Tags } from "lucide-react";
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
  useLabels,
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
} from "@/features/labels/useLabels";
import { LabelForm, type LabelFormValues } from "@/features/labels/LabelForm";
import type { Label } from "@/lib/types";

export function LabelsPage() {
  const { data: labels, isLoading, error } = useLabels();
  const createMutation = useCreateLabel();
  const updateMutation = useUpdateLabel();
  const deleteMutation = useDeleteLabel();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Label | null>(null);
  const [deleting, setDeleting] = useState<Label | null>(null);

  const handleCreate = async (values: LabelFormValues) => {
    try {
      await createMutation.mutateAsync(values);
      toast.success(`Created "${values.name}"`);
      setCreateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create label");
    }
  };

  const handleUpdate = async (values: LabelFormValues) => {
    if (!editing) return;
    try {
      await updateMutation.mutateAsync({ id: editing.id, input: values });
      toast.success(`Updated "${values.name}"`);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update label");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success(`Deleted "${deleting.name}"`);
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete label");
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Tags className="size-6" /> Labels
          </h1>
          <p className="text-sm text-muted-foreground">
            Tags used to qualify staff for specific events (e.g. Surgery, ER, On-call).
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add label
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New label</DialogTitle>
              <DialogDescription>
                Create a label you can attach to people and events.
              </DialogDescription>
            </DialogHeader>
            <LabelForm
              onSubmit={handleCreate}
              submitLabel="Create label"
              isSubmitting={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && (
        <p className="text-destructive">
          Failed to load labels: {error.message}
        </p>
      )}

      {labels && (
        <div className="border rounded-lg bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-32">In use</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {labels.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground py-8"
                  >
                    No labels yet. Click "Add label" to create your first one.
                  </TableCell>
                </TableRow>
              )}
              {labels.map((label) => (
                <TableRow key={label.id}>
                  <TableCell className="font-medium">{label.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {label.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {label._count?.people ?? 0} ppl
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setEditing(label)}
                      title="Edit"
                      aria-label={`Edit ${label.name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleting(label)}
                      title="Delete"
                      aria-label={`Delete ${label.name}`}
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

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit label</DialogTitle>
          </DialogHeader>
          {editing && (
            <LabelForm
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
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the label from {deleting?._count?.people ?? 0}{" "}
              people and {deleting?._count?.events ?? 0} events. This cannot be undone.
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
