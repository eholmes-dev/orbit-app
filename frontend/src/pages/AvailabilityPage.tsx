import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Trash2, Plus, RefreshCw, Repeat } from "lucide-react";
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
  useSyncOutlookAvailability,
} from "@/features/availability/useAvailability";
import {
  AvailabilityForm,
  type AvailabilityFormValues,
} from "@/features/availability/AvailabilityForm";
import {
  groupRecurring,
  formatWeekdays,
  formatTimeOfDayRange,
  formatDateSpan,
} from "@/features/availability/groupRecurring";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [personId, setPersonId] = useState<string | null>(
    () => searchParams.get("personId"),
  );

  // Stay in sync if the URL changes (e.g., user navigates from a People row).
  useEffect(() => {
    const fromUrl = searchParams.get("personId");
    if (fromUrl && fromUrl !== personId) setPersonId(fromUrl);
  }, [searchParams, personId]);

  const selectPerson = (v: string) => {
    setPersonId(v);
    const next = new URLSearchParams(searchParams);
    next.set("personId", v);
    setSearchParams(next, { replace: true });
  };

  const { data: records, isLoading } = useAvailability(personId);
  const grouped = useMemo(() => (records ? groupRecurring(records) : []), [records]);

  const createMutation = useCreateAvailability();
  const updateMutation = useUpdateAvailability();
  const deleteMutation = useDeleteAvailability();
  const syncMutation = useSyncOutlookAvailability();

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

  const handleSync = async () => {
    if (!personId) return;
    // Sync window: today through 60 days out (covers next month + buffer).
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setDate(to.getDate() + 60);
    to.setHours(23, 59, 59, 999);
    try {
      const result = await syncMutation.mutateAsync({
        personIds: [personId],
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const me = result.perPerson[0];
      if (me?.status === "error") {
        toast.error(`Sync failed: ${me.error}`);
      } else {
        toast.success(`Synced ${result.synced} busy window${result.synced === 1 ? "" : "s"} from Outlook`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
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
            onValueChange={selectPerson}
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!personId || syncMutation.isPending}
            onClick={handleSync}
            title="Pull this person's busy windows from their Outlook calendar"
          >
            <RefreshCw
              className={`size-4 ${syncMutation.isPending ? "animate-spin" : ""}`}
            />
            {syncMutation.isPending ? "Syncing…" : "Sync from Outlook"}
          </Button>
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
              {grouped.map((g) => {
                if (g.kind === "single") {
                  const r = g.record;
                  const isSynced = r.source === "outlook_sync";
                  return (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Badge variant={TYPE_BADGE[r.type]}>{r.type}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatRange(r.startDateTime, r.endDateTime)}
                      </TableCell>
                      <TableCell>
                        {isSynced ? (
                          <Badge variant="outline" className="font-normal">
                            Outlook
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">manual</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditing(r)}
                          disabled={isSynced}
                          title={
                            isSynced
                              ? "Synced from Outlook — edit in Outlook, then re-sync"
                              : "Edit"
                          }
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleting(r)}
                          disabled={isSynced}
                          title={
                            isSynced
                              ? "Synced from Outlook — delete in Outlook, then re-sync"
                              : "Delete"
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                }
                // Recurring group
                const isSynced = g.source === "outlook_sync";
                const groupKey = g.records[0].id;
                return (
                  <TableRow key={`group-${groupKey}`}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant={TYPE_BADGE[g.type]}>{g.type}</Badge>
                        <Repeat className="size-3.5 text-muted-foreground" />
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">
                        {formatWeekdays(g.weekdays)} · {formatTimeOfDayRange(g.startTimeOfDay, g.endTimeOfDay)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {g.records.length} occurrences · {formatDateSpan(g.firstStart, g.lastStart)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {isSynced ? (
                        <Badge variant="outline" className="font-normal">
                          Outlook
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">manual</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled
                        title={
                          isSynced
                            ? "Recurring series synced from Outlook — edit in Outlook, then re-sync"
                            : "Recurring series — edit individual occurrences not yet supported"
                        }
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled
                        title={
                          isSynced
                            ? "Recurring series synced from Outlook — delete in Outlook, then re-sync"
                            : "Recurring series — delete individual occurrences not yet supported"
                        }
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
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
