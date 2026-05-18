// Stable color assignment for shift cards in the schedule grid. Cards are
// tinted by the event's first required Label (closest analog to "role" in
// the reference design). Colors are picked from a pastel palette that sits
// well on top of the app's neutral background tokens; we map a label's id
// (hashed) into the palette so colors stay stable across reloads and don't
// shift when labels are added/removed.

interface ShiftColor {
  /** Tailwind classes for the card background + text. */
  bg: string;
  /** Tailwind class for the left border (the role-stripe). */
  border: string;
  /** Raw rgb for inline styles where Tailwind classes can't reach. */
  rgb: string;
}

// Pastel palette derived from Tailwind's *-100 / *-500 swatches. Each entry
// is one role color. Order matters only as a deterministic fallback when
// hashing labels — picking visually-distinct colors next to each other keeps
// adjacent labels from collapsing into the same hue.
const PALETTE: ShiftColor[] = [
  { bg: "bg-emerald-50 text-emerald-900", border: "border-l-emerald-500", rgb: "rgb(16, 185, 129)" },
  { bg: "bg-sky-50 text-sky-900", border: "border-l-sky-500", rgb: "rgb(14, 165, 233)" },
  { bg: "bg-amber-50 text-amber-900", border: "border-l-amber-500", rgb: "rgb(245, 158, 11)" },
  { bg: "bg-violet-50 text-violet-900", border: "border-l-violet-500", rgb: "rgb(139, 92, 246)" },
  { bg: "bg-rose-50 text-rose-900", border: "border-l-rose-500", rgb: "rgb(244, 63, 94)" },
  { bg: "bg-teal-50 text-teal-900", border: "border-l-teal-500", rgb: "rgb(20, 184, 166)" },
  { bg: "bg-indigo-50 text-indigo-900", border: "border-l-indigo-500", rgb: "rgb(99, 102, 241)" },
  { bg: "bg-orange-50 text-orange-900", border: "border-l-orange-500", rgb: "rgb(249, 115, 22)" },
];

const NEUTRAL: ShiftColor = {
  bg: "bg-muted text-foreground",
  border: "border-l-muted-foreground/40",
  rgb: "rgb(148, 163, 184)",
};

/** Cheap deterministic hash — same string always maps to the same slot. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForLabelId(labelId: string | null | undefined): ShiftColor {
  if (!labelId) return NEUTRAL;
  return PALETTE[hashString(labelId) % PALETTE.length];
}
