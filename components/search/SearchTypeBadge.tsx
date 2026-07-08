import type { SearchType } from "@/components/search/types";

// Small colored pill labelling a result's entity type. Colors are subtle,
// consistent with the ink/accent palette used across the console.
const BADGE_STYLES: Record<SearchType, string> = {
  claim: "bg-accent/10 text-accent",
  document: "bg-ink/10 text-ink/60",
  evidence: "bg-emerald-100 text-emerald-700",
  verification: "bg-amber-100 text-amber-700",
};

const BADGE_LABELS: Record<SearchType, string> = {
  claim: "Claim",
  document: "Document",
  evidence: "Evidence",
  verification: "Verification",
};

export interface SearchTypeBadgeProps {
  type: SearchType;
}

export function SearchTypeBadge({ type }: SearchTypeBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${BADGE_STYLES[type]}`}
    >
      {BADGE_LABELS[type]}
    </span>
  );
}
