import {
  Sparkles,
  Play,
  Send,
  Loader2,
  AlertCircle,
  Circle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateTimeInput } from "@/components/DateTimeInput";
import type { GenerateScheduleResult } from "@/lib/types";

interface Props {
  startDate: string;
  endDate: string;
  onChangeStartDate: (v: string) => void;
  onChangeEndDate: (v: string) => void;
  onQuickRange: (range: [string, string]) => void;
  quickRanges: Array<[string, () => [string, string]]>;

  view: GenerateScheduleResult | null;
  /** Date range the cached `view` was generated for — surfaced so admins can
   *  see at a glance whether the cached conflicts/warnings are stale relative
   *  to the date range currently in the pickers above. */
  viewRange?: { startDate: string; endDate: string };
  /** ISO timestamp of when the cached view was produced. */
  viewGeneratedAt?: string;
  isGenerating: boolean;
  generateError: string | null;
  onGenerate: () => void;

  /** Total proposed assignments across the DB — drives Publish enable/count. */
  proposedCount: number;
  /** Unresolved conflicts in the last generate — only used to color the
   *  Publish button's tooltip ("X assignments will sync. N conflicts remain"). */
  conflictsCount: number;
  isPublishing: boolean;
  onPublish: () => void;
}

function formatViewRange(startDate: string, endDate: string): string {
  const fmt: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  return `${new Date(startDate).toLocaleDateString(undefined, fmt)} – ${new Date(endDate).toLocaleDateString(undefined, fmt)}`;
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function SchedulingAssistant({
  startDate,
  endDate,
  onChangeStartDate,
  onChangeEndDate,
  onQuickRange,
  quickRanges,
  view,
  viewRange,
  viewGeneratedAt,
  isGenerating,
  generateError,
  onGenerate,
  proposedCount,
  conflictsCount,
  isPublishing,
  onPublish,
}: Props) {

  return (
    <aside className="border rounded-lg bg-card flex flex-col max-h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          Scheduling Assistant
        </h2>
      </div>

      {/* Body — scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Date range */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {quickRanges.map(([label, fn]) => (
              <button
                key={label}
                type="button"
                onClick={() => onQuickRange(fn())}
                className="text-xs px-2 py-0.5 rounded border hover:bg-accent text-muted-foreground hover:text-foreground"
              >
                {label}
              </button>
            ))}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Start
            </label>
            <DateTimeInput value={startDate} onChange={onChangeStartDate} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              End
            </label>
            <DateTimeInput value={endDate} onChange={onChangeEndDate} />
          </div>
        </div>

        <Button
          className="w-full"
          onClick={onGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {isGenerating ? "Solving…" : "Generate schedule"}
        </Button>

        {/* Progress steps (during solve). The solver doesn't emit phase events,
            so these are synthetic but match what the backend actually does. */}
        {isGenerating && (
          <div className="rounded-md border bg-muted/40 p-3 space-y-1.5 text-sm">
            <ProgressStep label="Gathering events + people" state="done" />
            <ProgressStep label="Running solver" state="active" />
            <ProgressStep label="Categorizing conflicts" state="pending" />
          </div>
        )}

        {generateError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
            <span>{generateError}</span>
          </div>
        )}

        {/* Result summary */}
        {view && view.counts.events > 0 && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Solver</span>
              <span className="font-medium capitalize">{view.status}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Assigned</span>
              <span className="font-medium text-green-700">
                {view.counts.assignments}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Conflicts</span>
              <span
                className={`font-medium ${conflictsCount > 0 ? "text-destructive" : ""}`}
              >
                {conflictsCount}
              </span>
            </div>
            {viewRange && viewGeneratedAt && (
              <div className="pt-1 mt-1 border-t border-border/60 text-xs text-muted-foreground">
                Generated{" "}
                <span title={new Date(viewGeneratedAt).toLocaleString()}>
                  {relativeAge(viewGeneratedAt)}
                </span>{" "}
                for {formatViewRange(viewRange.startDate, viewRange.endDate)}
              </div>
            )}
          </div>
        )}

        {/* Clean-result indicator — Conflicts/Warnings panels render
            separately below this card (in SchedulePage) so this just confirms
            the last generate landed cleanly. */}
        {view &&
          view.counts.events > 0 &&
          conflictsCount === 0 &&
          view.warnings.length === 0 &&
          !isGenerating && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="size-4" />
              No conflicts or warnings.
            </div>
          )}
      </div>

      {/* Sticky footer — Publish */}
      <div className="border-t p-3">
        <Button
          className="w-full"
          onClick={onPublish}
          disabled={proposedCount === 0 || isPublishing}
          title={
            proposedCount === 0
              ? "Generate a schedule with proposed assignments first"
              : conflictsCount > 0
                ? `${proposedCount} assignment${proposedCount === 1 ? "" : "s"} will sync. ${conflictsCount} conflict${conflictsCount === 1 ? "" : "s"} remain unresolved.`
                : `Push ${proposedCount} assignment${proposedCount === 1 ? "" : "s"} to Outlook`
          }
        >
          {isPublishing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          {isPublishing
            ? "Publishing…"
            : proposedCount > 0
              ? `Publish schedule (${proposedCount})`
              : "Publish schedule"}
        </Button>
      </div>
    </aside>
  );
}

function ProgressStep({
  label,
  state,
}: {
  label: string;
  state: "done" | "active" | "pending";
}) {
  return (
    <div className="flex items-center gap-2">
      {state === "done" && <CheckCircle2 className="size-3.5 text-green-600" />}
      {state === "active" && (
        <Loader2 className="size-3.5 animate-spin text-primary" />
      )}
      {state === "pending" && (
        <Circle className="size-3.5 text-muted-foreground/40" />
      )}
      <span
        className={
          state === "pending" ? "text-muted-foreground" : "text-foreground"
        }
      >
        {label}
      </span>
    </div>
  );
}
