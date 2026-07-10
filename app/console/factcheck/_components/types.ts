import type { FactCheckOutput, ClaimResult, GroundedEvidence } from "@/lib/factcheck/schemas";

// Console-side view types for the fact-check page. The wire payload is the
// pipeline's FactCheckOutput; these re-exports keep the page decoupled from the
// lib module path and give the components a stable, page-local vocabulary.

export type FactCheckResult = FactCheckOutput;
export type FactCheckClaim = ClaimResult;
export type FactCheckEvidence = GroundedEvidence;

// Presentational metadata for each per-claim verdict badge (label + house
// Tailwind token classes). Kept as data so the page stays declarative.
export interface VerdictStyle {
  label: string;
  className: string;
}

export const VERDICT_STYLES: Record<FactCheckClaim["verdict"], VerdictStyle> = {
  supported: { label: "Supported", className: "border-emerald-300 bg-emerald-50 text-emerald-700" },
  refuted: { label: "Refuted", className: "border-red-200 bg-red-50 text-red-700" },
  unverified: { label: "Unverified", className: "border-amber-300 bg-amber-50 text-amber-700" },
  not_checkworthy: { label: "Not checkworthy", className: "border-ink/15 bg-white text-ink/50" },
};

export const RELATIONSHIP_STYLES: Record<FactCheckEvidence["relationship"], VerdictStyle> = {
  supported: { label: "supports", className: "text-emerald-700" },
  refuted: { label: "refutes", className: "text-red-700" },
  unverified: { label: "does not address", className: "text-ink/50" },
};

// Format the overall/per-claim factuality (0-1) as a percentage, or a dash when
// nothing could be verified.
export function formatFactuality(value: number | null): string {
  if (value === null) return "—";
  return `${Math.round(value * 100)}%`;
}
