import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  useEvents,
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
} from "@/features/events/useEvents";
import { EventForm, type EventFormValues } from "@/features/events/EventForm";
import type { Event, CreateEventInput } from "@/lib/types";

function toApiInput(values: EventFormValues): CreateEventInput {
  return {
    title: values.title,
    startDateTime: new Date(values.startDateTime).toISOString(),
    endDateTime: new Date(values.endDateTime).toISOString(),
    priorityTier: values.priorityTier,
    requiredStaffCount: values.requiredStaffCount,
    isHardRequirement: values.isHardRequirement,
    location: values.location?.trim() ? values.location : null,
    recurrenceRule: values.recurrenceRule?.trim() ? values.recurrenceRule : null,
    requiredLabelIds: values.requiredLabelIds,
  };
}

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

const tierVariant: Record<number, "default" | "secondary" | "outline"> = {
  1: "default",
  2: "default",
  3: "secondary",
  4: "outline",
  5: "outline",
};

export function EventsPage() {
  const { data: events, isLoading, error } = useEvents();
  const createMutation = useCreateEvent();
  const updateMutation = useUpdateEvent();
  const deleteMutation = useDeleteEvent();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Event | null>(null);
  const [deleting, setDeleting] = useState<Event | null>(null);

  // Scroll to and flash the row referenced by ?focus=<eventId> (deep-link from
  // the Schedule page's conflict cards).
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const rowRefs = useRef<Map<string, HTMLTableRowElement | null>>(new Map());
  useEffect(() => {
    if (!focusId || !events) return;
    const el = rowRefs.current.get(focusId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash-highlight");
    const t = setTimeout(() => el.classList.remove("flash-highlight"), 1800);
    // Drop the param so a manual re-navigation doesn't re-flash forever.
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    setSearchParams(next, { replace: true });
    return () => clearTimeout(t);
  }, [focusId, events, searchParams, setSearchParams]);

  const handleCreate = async (values: EventFormValues) => {
    try {
      await createMutation.mutateAsync(toApiInput(values));
      toast.success(`Created "${values.title}"`);
      setCreateOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create event");
    }
  };

  const handleUpdate = async (values: EventFormValues) => {
    if (!editing) return;
    try {
      await updateMutation.mutateAsync({ id: editing.id, input: toApiInput(values) });
      toast.success(`Updated "${values.title}"`);
      setEditing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success(`Deleted "${deleting.title}"`);
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="text-sm text-muted-foreground">
            Shifts and staffing needs the scheduler will fill.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add event
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New event</DialogTitle>
              <DialogDescription>
                Define a shift or staffing need with required labels.
              </DialogDescription>
            </DialogHeader>
            <EventForm
              onSubmit={handleCreate}
              submitLabel="Create event"
              isSubmitting={createMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && (
        <p className="text-destructive">
          Failed to load events: {error.message}
        </p>
      )}

      {events && (
        <div className="border rounded-lg bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="w-20">Tier</TableHead>
                <TableHead className="w-20">Staff</TableHead>
                <TableHead>Required labels</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No events yet. Click "Add event" to create your first one.
                  </TableCell>
                </TableRow>
              )}
              {events.map((ev) => (
                <TableRow
                  key={ev.id}
                  ref={(el) => {
                    rowRefs.current.set(ev.id, el);
                  }}
                >
                  <TableCell className="font-medium">
                    {ev.title}
                    {ev.isHardRequirement && (
                      <Badge variant="outline" className="ml-2">hard</Badge>
                    )}
                    {ev.location && (
                      <div className="text-xs text-muted-foreground">{ev.location}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatRange(ev.startDateTime, ev.endDateTime)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={tierVariant[ev.priorityTier]}>T{ev.priorityTier}</Badge>
                  </TableCell>
                  <TableCell>{ev.requiredStaffCount}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {ev.requiredLabels.length === 0 ? (
                        <span className="text-muted-foreground text-sm">—</span>
                      ) : (
                        ev.requiredLabels.map((l) => (
                          <Badge key={l.id} variant="secondary">{l.name}</Badge>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => setEditing(ev)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleting(ev)}>
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
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit event</DialogTitle>
          </DialogHeader>
          {editing && (
            <EventForm
              defaultValues={editing}
              onSubmit={handleUpdate}
              submitLabel="Save changes"
              isSubmitting={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the event and any assignments tied to it. This cannot be undone.
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
