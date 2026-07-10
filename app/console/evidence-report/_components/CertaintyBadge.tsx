import type { Certainty } from "@/lib/grade";

// GRADE certainty badge. Four discrete levels, each with a fixed color so the
// rating reads at a glance (high = confident, very_low = fragile). Colors are
// muted to sit inside the paper theme rather than shout.

interface CertaintyBadgeProps {
  certainty: Certainty;
}

const STYLES: Record<Certainty, { label: string; className: string }> = {
  high: { label: "High certainty", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  moderate: { label: "Moderate certainty", className: "bg-sky-50 text-sky-800 border-sky-200" },
  low: { label: "Low certainty", className: "bg-amber-50 text-amber-800 border-amber-200" },
  very_low: { label: "Very low certainty", className: "bg-red-50 text-red-800 border-red-200" },
};

export function CertaintyBadge({ certainty }: CertaintyBadgeProps) {
  const style = STYLES[certainty];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${style.className}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      GRADE: {style.label}
    </span>
  );
}
