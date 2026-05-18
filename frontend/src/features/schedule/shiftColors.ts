// Stable color assignment for shift cards in the schedule grid. Cards are
// tinted by the event's first required Label (closest analog to "role" in
// the reference design). Each palette entry ships both light and dark
// variants — the light variant is a soft pastel that reads against a near-
// white canvas, the dark variant is a more saturated tone with a brighter
// border + lighter text so the chip feels vibrant against a near-black card.
// We map a label's id (hashed) into the palette so colors stay stable across
// reloads and don't shift when labels are added/removed.

interface ShiftColor {
  /** Tailwind classes for the card background + text (both themes). */
  bg: string;
  /** Tailwind class for the left border (the role-stripe; both themes). */
  border: string;
  /** Raw rgb for inline styles where Tailwind classes can't reach. */
  rgb: string;
}

// Pastel-on-light + saturated-on-dark per role color. Each row picks a hue
// that stays distinct on both backgrounds; ordered so adjacent labels don't
// collapse into similar hues.
const PALETTE: ShiftColor[] = [
  {
    bg: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-100",
    border: "border-l-emerald-500 dark:border-l-emerald-400",
    rgb: "rgb(16, 185, 129)",
  },
  {
    bg: "bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-100",
    border: "border-l-sky-500 dark:border-l-sky-400",
    rgb: "rgb(14, 165, 233)",
  },
  {
    bg: "bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100",
    border: "border-l-amber-500 dark:border-l-amber-400",
    rgb: "rgb(245, 158, 11)",
  },
  {
    bg: "bg-violet-100 text-violet-900 dark:bg-violet-500/25 dark:text-violet-100",
    border: "border-l-violet-500 dark:border-l-violet-400",
    rgb: "rgb(139, 92, 246)",
  },
  {
    bg: "bg-rose-100 text-rose-900 dark:bg-rose-500/25 dark:text-rose-100",
    border: "border-l-rose-500 dark:border-l-rose-400",
    rgb: "rgb(244, 63, 94)",
  },
  {
    bg: "bg-teal-100 text-teal-900 dark:bg-teal-500/25 dark:text-teal-100",
    border: "border-l-teal-500 dark:border-l-teal-400",
    rgb: "rgb(20, 184, 166)",
  },
  {
    bg: "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/25 dark:text-indigo-100",
    border: "border-l-indigo-500 dark:border-l-indigo-400",
    rgb: "rgb(99, 102, 241)",
  },
  {
    bg: "bg-orange-100 text-orange-900 dark:bg-orange-500/25 dark:text-orange-100",
    border: "border-l-orange-500 dark:border-l-orange-400",
    rgb: "rgb(249, 115, 22)",
  },
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
