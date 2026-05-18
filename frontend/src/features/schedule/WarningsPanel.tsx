import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ScheduleWarning } from "@/lib/types";

interface Props {
  warnings: ScheduleWarning[];
  onOpenPerson: (personId: string) => void;
}

export function WarningsPanel({ warnings, onOpenPerson }: Props) {
  return (
    <section className="border rounded-lg bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <AlertTriangle className="size-4 text-amber-500" />
        Warnings
        {warnings.length > 0 ? (
          <Badge
            variant="outline"
            className="ml-auto border-amber-500/40 text-amber-600"
          >
            {warnings.length}
          </Badge>
        ) : (
          <CheckCircle2 className="size-4 text-green-600 ml-auto" />
        )}
      </h3>
      {warnings.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No warnings — everyone's under their weekly cap.
        </p>
      ) : (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div
              key={i}
              className="border rounded-md p-2.5 bg-card text-sm space-y-1"
            >
              <button
                type="button"
                onClick={() => onOpenPerson(w.person_id)}
                className="font-medium hover:underline text-left"
              >
                {w.person_name}
              </button>
              <div className="text-xs text-muted-foreground">{w.message}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
