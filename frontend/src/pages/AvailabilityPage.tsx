import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Pencil,
  Trash2,
  Plus,
  RefreshCw,
  Repeat,
  ChevronDown,
  ChevronRight,
  CalendarOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  Person,
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
  const [searchParams] = useSearchParams();
  // Multiple people can be expanded at once. URL param ?personId=X
  // auto-expands that person so deep links from the People page still work.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(searchParams.get("personId") ? [searchParams.get("personId")!] : []),
  );

  useEffect(() => {
    const fromUrl = searchParams.get("personId");
    if (fromUrl) {
      setExpanded((prev) =>
        prev.has(fromUrl) ? prev : new Set([...prev, fromUrl]),
      );
    }
  }, [searchParams]);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createMutation = useCreateAvailability();
  const updateMutation = useUpdateAvailability();
  const deleteMutation = useDeleteAvailability();
  const syncMutation = useSyncOutlookAvailability();

  // Sync window: today → +60 days. End date is computed for display in the
  // button's tooltip so admins know what range the action covers.
  const syncEndDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d;
  }, []);
  const syncEndDateLabel = syncEndDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Page-level "sync all" — pulls busy windows for every person in one call.
  // The mutation invalidates all `["availability", ...]` queries, so any
  // expanded cards refresh automatically.
  const handleSyncAll = async () => {
    if (!people || people.length === 0) return;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(syncEndDate);
    to.setHours(23, 59, 59, 999);
    try {
      const result = await syncMutation.mutateAsync({
        personIds: people.map((p) => p.id),
        from: from.toISOString(),
        to: to.toISOString(),
      });
      const errors = result.perPerson.filter((p) => p.status === "error");
      if (errors.length > 0) {
        toast.warning(
          `Synced ${result.synced} busy window${result.synced === 1 ? "" : "s"} · ${errors.length} person${errors.length === 1 ? "" : "s"} failed`,
        );
      } else {
        toast.success(
          `Synced ${result.synced} busy window${result.synced === 1 ? "" : "s"} across ${result.perPerson.length} people`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    }
  };

  const [createForPersonId, setCreateForPersonId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Availability | null>(null);
  const [deleting, setDeleting] = useState<Availability | null>(null);
  const [addForOpen, setAddForOpen] = useState(false);

  const createForPerson = people?.find((p) => p.id === createForPersonId) ?? null;

  const handleCreate = async (values: AvailabilityFormValues) => {
    if (!createForPersonId) return;
    const input: CreateAvailabilityInput = {
      personId: createForPersonId,
      type: values.type,
      startDateTime: new Date(values.startDateTime).toISOString(),
      endDateTime: new Date(values.endDateTime).toISOString(),
    };
    try {
      await createMutation.mutateAsync(input);
      toast.success("Added availability");
      setCreateForPersonId(null);
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
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <CalendarOff className="size-6" /> Availability
          </h1>
          <p className="text-sm text-muted-foreground">
            Block out PTO, vacations, and other unavailable windows so the scheduler skips them.
            Click a person to view or manage their availability.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Popover open={addForOpen} onOpenChange={setAddForOpen}>
            <PopoverTrigger asChild>
              <Button disabled={!people || people.length === 0}>
                <Plus className="size-4" /> Add availability for…
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-1" align="end">
              <div className="max-h-72 overflow-y-auto">
                {people?.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setCreateForPersonId(p.id);
                      setAddForOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-sm text-sm hover:bg-accent flex items-center justify-between"
                  >
                    <span className="truncate">{p.name}</span>
                    {p.department && (
                      <span className="text-xs text-muted-foreground ml-2 shrink-0">
                        {p.department}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            onClick={handleSyncAll}
            disabled={!people || people.length === 0 || syncMutation.isPending}
            title={`Pull busy windows from every person's Outlook calendar (today through ${syncEndDateLabel})`}
          >
            <RefreshCw
              className={`size-4 ${syncMutation.isPending ? "animate-spin" : ""}`}
            />
            {syncMutation.isPending ? "Syncing…" : "Sync all from Outlook"}
          </Button>
        </div>
      </div>

      {!people && <p className="text-muted-foreground">Loading…</p>}

      {people && people.length === 0 && (
        <p className="text-muted-foreground">
          No people yet. Add some on the People page first.
        </p>
      )}

      {people && people.length > 0 && (
        <div className="space-y-2">
          {people.map((person) => (
            <PersonAvailabilityCard
              key={person.id}
              person={person}
              expanded={expanded.has(person.id)}
              onToggle={() => toggleExpanded(person.id)}
              onAdd={() => setCreateForPersonId(person.id)}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      <Dialog
        open={!!createForPersonId}
        onOpenChange={(open) => !open && setCreateForPersonId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              New availability {createForPerson && `for ${createForPerson.name}`}
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

function PersonAvailabilityCard({
  person,
  expanded,
  onToggle,
  onAdd,
  onEdit,
  onDelete,
}: {
  person: Person;
  expanded: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onEdit: (record: Availability) => void;
  onDelete: (record: Availability) => void;
}) {
  // Lazy fetch: only hit the API when this card is expanded. Passing null
  // when collapsed keeps `enabled: false` inside the hook.
  const { data: records, isLoading } = useAvailability(expanded ? person.id : null);
  const grouped = useMemo(
    () => (records ? groupRecurring(records) : []),
    [records],
  );

  return (
    <div className="border rounded-lg bg-card">
      <div className="flex items-center justify-between gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 text-left hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium truncate">{person.name}</span>
          {expanded && records && (
            <span className="text-xs text-muted-foreground ml-2">
              {records.length} entr{records.length === 1 ? "y" : "ies"}
            </span>
          )}
          {person.department && (
            <span className="text-xs text-muted-foreground ml-auto pr-2">
              {person.department}
            </span>
          )}
        </button>
        {expanded && (
          <div className="flex gap-2 shrink-0">
            <Button size="sm" onClick={onAdd}>
              <Plus className="size-4" /> Add availability
            </Button>
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t">
          {isLoading && (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          )}
          {records && (
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
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
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
                            onClick={() => onEdit(r)}
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
                            onClick={() => onDelete(r)}
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
                      <TableCell className="text-right">
                        <span
                          className="text-xs text-muted-foreground italic"
                          title={
                            isSynced
                              ? "Recurring series synced from Outlook — edit in Outlook, then re-sync"
                              : "Recurring series — individual occurrences not yet editable"
                          }
                        >
                          {isSynced ? "edit in Outlook" : "series"}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
