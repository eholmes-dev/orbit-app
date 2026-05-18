interface Props {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad" | "warn";
}

export function SummaryCard({ label, value, hint, tone }: Props) {
  const toneClass =
    tone === "good"
      ? "text-green-600"
      : tone === "bad"
        ? "text-destructive"
        : tone === "warn"
          ? "text-amber-600"
          : "text-foreground";
  return (
    <div className="border rounded-lg bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      {hint && (
        <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
      )}
    </div>
  );
}
