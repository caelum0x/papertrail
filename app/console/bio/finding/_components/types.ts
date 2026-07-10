// Client-side view types for the bioinformatics-finding verification console.
//
// These mirror the deterministic shape returned by POST /api/bio/verify-finding:
// an overall verdict + rationale, a per-check breakdown, the effect-size spans
// grounded verbatim to the source, and a count of spans dropped as ungroundable.
// Kept intentionally tolerant (optional fields) so the UI degrades gracefully if
// a given check omits detail — it never fabricates missing data.

export type OverallVerdict =
  | "supported"
  | "partially_supported"
  | "overstated"
  | "unsupported"
  | "insufficient_evidence";

// One per-check result from the composed deterministic engines.
export interface FindingCheck {
  kind: string;
  verdict: string;
  summary: string;
  source: string;
}

// An effect-size span grounded to a verbatim substring of the source text.
// `sourceStart` / `sourceEnd` are character offsets into `source_text` when the
// finding was verified against a supplied source; absent otherwise.
export interface GroundedSpan {
  text: string;
  value?: number | null;
  unit?: string | null;
  label?: string | null;
  sourceStart?: number | null;
  sourceEnd?: number | null;
}

export interface FindingResult {
  finding: string;
  overallVerdict: OverallVerdict;
  rationale: string;
  checks: FindingCheck[];
  groundedSpans: GroundedSpan[];
  groundingDroppedCount: number;
  sourceText?: string | null;
}

// Verdict → badge styling. House tokens only; deterministic mapping.
export const VERDICT_STYLES: Record<
  OverallVerdict,
  { label: string; className: string }
> = {
  supported: {
    label: "Supported",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  partially_supported: {
    label: "Partially supported",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  overstated: {
    label: "Overstated",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  unsupported: {
    label: "Unsupported",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  insufficient_evidence: {
    label: "Insufficient evidence",
    className: "border-ink/15 bg-paper text-ink/60",
  },
};

// A generic verdict word (per-check) → subtle color. Falls back to neutral for
// engine-specific verdict vocabularies we don't recognize.
export function checkVerdictClass(verdict: string): string {
  const v = verdict.toLowerCase();
  if (
    v.includes("overstated") ||
    v.includes("conflicting") ||
    v.includes("not_confirmed") ||
    v.includes("no_signal")
  ) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (
    v.includes("confirmed") ||
    v.includes("significant") ||
    v.includes("pathogenic") ||
    v.includes("association_found") ||
    v.includes("signal_detected") ||
    v.includes("high") ||
    v.includes("moderate")
  ) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (v.includes("not_found") || v.includes("no_association")) {
    return "border-ink/15 bg-paper text-ink/60";
  }
  return "border-ink/15 bg-white text-ink/70";
}

// Humanize a snake_case check kind or verdict for display.
export function humanize(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
