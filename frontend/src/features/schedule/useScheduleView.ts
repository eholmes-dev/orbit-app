import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  GenerateScheduleResult,
  ScheduleAssignment,
  ScheduleConflict,
} from "@/lib/types";

/**
 * The "current view" of the schedule the admin is looking at. Lives in the
 * TanStack Query cache (not SchedulePage local state) so navigating to other
 * pages and back doesn't wipe it, AND mirrored into localStorage so it
 * survives a page refresh. Only a fresh Generate replaces it; smaller
 * mutations patch in place via the patcher returned by useScheduleViewActions.
 */
export interface ScheduleView extends GenerateScheduleResult {
  /** The date range the user generated this view for; used to re-seed the
   *  date pickers on remount. */
  range: { startDate: string; endDate: string };
  generatedAt: string;
}

const KEY = ["schedule", "view"] as const;
const STORAGE_KEY = "orbit.scheduleView";

// Bump when the ScheduleView shape (or any embedded type like
// GenerateScheduleResult / ScheduleConflict) changes in a way that would make
// reading a previous payload unsafe. Old payloads are silently discarded.
const STORAGE_SCHEMA_VERSION = 2;

// How long to trust a cached view. Beyond this, the underlying DB has
// usually drifted enough (events added/edited/cancelled, people deactivated)
// that surfacing the old conflicts / warnings / solver diagnostic is
// misleading — admin should re-Generate. Tunable; this is conservative.
const STORAGE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

interface StoredPayload {
  schemaVersion: number;
  storedAt: string;
  view: ScheduleView;
}

function readStored(): ScheduleView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPayload | ScheduleView;
    // Backwards-compat: pre-v2 payloads were the bare ScheduleView. Discard
    // them so old shapes don't bleed into new component code.
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("schemaVersion" in parsed) ||
      (parsed as StoredPayload).schemaVersion !== STORAGE_SCHEMA_VERSION
    ) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    const payload = parsed as StoredPayload;
    // TTL: if too old, discard. Refresh-after-a-week shouldn't resurrect
    // last week's solver diagnostic.
    const age = Date.now() - new Date(payload.storedAt).getTime();
    if (!Number.isFinite(age) || age > STORAGE_MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return payload.view;
  } catch {
    // Corrupt JSON or storage access denied — fall back to no cached view.
    return null;
  }
}

function writeStored(view: ScheduleView | null) {
  if (typeof window === "undefined") return;
  try {
    if (view === null) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const payload: StoredPayload = {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      storedAt: new Date().toISOString(),
      view,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded / disabled storage — silently skip. The cache stays
    // in-memory; we just lose the survive-refresh property.
  }
}

export function useScheduleView() {
  return useQuery<ScheduleView | null>({
    queryKey: KEY,
    // We never auto-fetch — cache is populated by setView() / read from
    // localStorage on first mount.
    queryFn: () => Promise.resolve(readStored()),
    staleTime: Infinity,
    gcTime: Infinity,
    initialData: () => readStored(),
    enabled: false,
  });
}

export function useScheduleViewActions() {
  const qc = useQueryClient();
  return {
    setView: (view: ScheduleView | null) => {
      qc.setQueryData<ScheduleView | null>(KEY, view);
      writeStored(view);
    },
    clear: () => {
      qc.setQueryData<ScheduleView | null>(KEY, null);
      writeStored(null);
    },
    patchAssignments: (
      updater: (prev: ScheduleAssignment[]) => ScheduleAssignment[],
    ) => {
      const next = qc.setQueryData<ScheduleView | null>(KEY, (prev) => {
        if (!prev) return prev;
        return { ...prev, assignments: updater(prev.assignments) };
      });
      writeStored(next ?? null);
    },
    patchConflicts: (
      updater: (prev: ScheduleConflict[]) => ScheduleConflict[],
    ) => {
      const next = qc.setQueryData<ScheduleView | null>(KEY, (prev) => {
        if (!prev) return prev;
        return { ...prev, conflicts: updater(prev.conflicts) };
      });
      writeStored(next ?? null);
    },
  };
}
