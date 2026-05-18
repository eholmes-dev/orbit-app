import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Microscope,
} from "lucide-react";
import type { SolverInputSnapshot } from "@/lib/types";

interface Props {
  eventId: string;
  snapshot: SolverInputSnapshot | undefined;
  /** Display-only — relative time for the "ran X ago" hint. */
  generatedAt?: string;
}

interface PersonGate {
  personId: string;
  personName: string;
  /** First gate that excluded this person, in evaluation order. `null` means
   *  the solver was free to assign them — if it didn't, that's a real
   *  surprise worth investigating. */
  blockedBy:
    | null
    | { kind: "missing_labels"; labels: string[] }
    | { kind: "previously_declined" }
    | { kind: "availability"; type: string; start: string; end: string };
}

function windowsOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string },
): boolean {
  return (
    new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end)
  );
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function SolverDiagnosticSection({
  eventId,
  snapshot,
  generatedAt,
}: Props) {
  const [open, setOpen] = useState(false);

  const analysis = useMemo(() => {
    if (!snapshot) return null;
    const event = snapshot.events.find((e) => e.id === eventId);
    if (!event) {
      return { eventInScope: false, gates: [] as PersonGate[], labelNameById: new Map<string, string>() };
    }
    // Build a label-name lookup so we can show "Surgery" instead of cuids.
    // Labels aren't carried in the snapshot today — fall back to the id when
    // we can't resolve. (Worth a future enhancement: include label names too.)
    const labelNameById = new Map<string, string>();
    const declinedSet = new Set(
      snapshot.declined_pairs
        .filter((d) => d.event_id === eventId)
        .map((d) => d.person_id),
    );
    const availByPerson = new Map<
      string,
      Array<{ start: string; end: string; type: string }>
    >();
    for (const av of snapshot.availability) {
      const arr = availByPerson.get(av.person_id) ?? [];
      arr.push(av);
      availByPerson.set(av.person_id, arr);
    }
    const eventWindow = { start: event.start, end: event.end };

    const gates: PersonGate[] = snapshot.people.map((p) => {
      // 1. Labels: must have every required label.
      const ownedLabels = new Set(p.label_ids);
      const missingLabels = event.required_label_ids.filter(
        (l) => !ownedLabels.has(l),
      );
      if (missingLabels.length > 0) {
        return {
          personId: p.id,
          personName: p.name,
          blockedBy: { kind: "missing_labels", labels: missingLabels },
        };
      }
      // 2. Previously declined for this event → hard exclusion.
      if (declinedSet.has(p.id)) {
        return {
          personId: p.id,
          personName: p.name,
          blockedBy: { kind: "previously_declined" },
        };
      }
      // 3. Availability blocking the event window.
      const blocking = (availByPerson.get(p.id) ?? []).find((av) =>
        windowsOverlap(av, eventWindow),
      );
      if (blocking) {
        return {
          personId: p.id,
          personName: p.name,
          blockedBy: {
            kind: "availability",
            type: blocking.type,
            start: blocking.start,
            end: blocking.end,
          },
        };
      }
      // 4. Passed all gates — solver had this person as a variable.
      return { personId: p.id, personName: p.name, blockedBy: null };
    });

    // Sort: eligible first (the surprising case), then by gate type, then by name.
    gates.sort((a, b) => {
      const aEligible = a.blockedBy === null;
      const bEligible = b.blockedBy === null;
      if (aEligible !== bEligible) return aEligible ? -1 : 1;
      return a.personName.localeCompare(b.personName);
    });

    return { eventInScope: true, gates, labelNameById };
  }, [eventId, snapshot]);

  if (!snapshot) {
    return (
      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        Solver diagnostic isn't available — the cached generate result predates
        this feature. Re-run Generate to capture a fresh snapshot.
      </div>
    );
  }
  if (!analysis) return null;

  const eligibleCount = analysis.gates.filter((g) => g.blockedBy === null).length;

  return (
    <section className="border rounded-md bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-muted/40 transition rounded-md"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Microscope className="size-4 text-muted-foreground" />
          Solver diagnostic
          {analysis.eventInScope ? (
            <span className="text-xs text-muted-foreground font-normal">
              · {eligibleCount} eligible at solve time
            </span>
          ) : (
            <span className="text-xs text-amber-600 font-normal">
              · event wasn't in the solver's input
            </span>
          )}
        </div>
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2 text-sm">
          {generatedAt && (
            <p className="text-xs text-muted-foreground">
              Cached snapshot from{" "}
              <span title={new Date(generatedAt).toLocaleString()}>
                {relativeAge(generatedAt)}
              </span>
              .
            </p>
          )}

          {!analysis.eventInScope && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50/50 p-2.5">
              <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div>
                  This event wasn't part of the solver's input. Most common
                  causes:
                </div>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>
                    The event is <strong>cancelled</strong> — check the Events
                    page for a "Cancelled" badge. The Conflicts panel's
                    "Cancel &amp; archive" action sets this. Cancelled events
                    are never scheduled.
                  </li>
                  <li>
                    The event was added <strong>after</strong> the last Generate
                    ran — re-run Generate to include it.
                  </li>
                  <li>
                    The event sits outside the generated date range.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {analysis.eventInScope && analysis.gates.length === 0 && (
            <p className="text-xs text-muted-foreground">
              The solver had no people at all in scope.
            </p>
          )}

          {analysis.eventInScope && analysis.gates.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {eligibleCount > 0
                  ? `${eligibleCount} ${
                      eligibleCount === 1 ? "person was" : "people were"
                    } eligible. If they weren't assigned, the solver likely chose another event for them or their assignment was deleted later.`
                  : "No one was eligible at solve time — the gate column shows the first hard rule that excluded each person."}
              </p>
              <ul className="divide-y rounded-md border">
                {analysis.gates.map((g) => (
                  <li
                    key={g.personId}
                    className="px-2.5 py-2 text-xs flex items-start gap-2"
                  >
                    {g.blockedBy === null ? (
                      <CheckCircle2 className="size-3.5 text-green-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="size-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {g.personName}
                      </div>
                      <div className="text-muted-foreground">
                        {g.blockedBy === null && (
                          <span>Eligible — solver had a variable for this pair.</span>
                        )}
                        {g.blockedBy?.kind === "missing_labels" && (
                          <span>
                            Missing required label{g.blockedBy.labels.length === 1 ? "" : "s"}
                            : {g.blockedBy.labels.join(", ")}
                          </span>
                        )}
                        {g.blockedBy?.kind === "previously_declined" && (
                          <span>Previously declined for this event.</span>
                        )}
                        {g.blockedBy?.kind === "availability" && (
                          <span>
                            Blocked by {g.blockedBy.type} (
                            {shortDate(g.blockedBy.start)} –{" "}
                            {shortDate(g.blockedBy.end)}).
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
