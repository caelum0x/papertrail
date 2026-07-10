import type { CitationStance } from "@/lib/citations/schemas";

// Visual stance token for a smart citation. Colors follow the app's convention:
// supporting = positive/green, contrasting = warning/rose, mentioning = neutral.

interface StanceBadgeProps {
  stance: CitationStance;
  confidence?: number;
}

const STANCE_STYLES: Record<CitationStance, { label: string; className: string }> = {
  supporting: {
    label: "Supporting",
    className: "border-emerald-400/50 bg-emerald-50/70 text-emerald-800",
  },
  contrasting: {
    label: "Contrasting",
    className: "border-rose-400/50 bg-rose-50/70 text-rose-800",
  },
  mentioning: {
    label: "Mentioning",
    className: "border-ink/20 bg-white/60 text-ink/60",
  },
};

export function StanceBadge({ stance, confidence }: StanceBadgeProps) {
  const style = STANCE_STYLES[stance];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${style.className}`}
    >
      {style.label}
      {typeof confidence === "number" ? (
        <span className="font-mono text-[10px] opacity-70">
          {Math.round(confidence * 100)}%
        </span>
      ) : null}
    </span>
  );
}
