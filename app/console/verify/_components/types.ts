import type { ExtractedFinding, VerificationResult } from "@/lib/schemas";
import type { GroundedVerificationResult } from "@/lib/grounding";
import type { Reconciliation, ReconcileVerdict } from "@/lib/effectSize";

// Console-side view types for the claim-verification page. These mirror the exact
// wire payload returned by `POST /api/verify/text` so the page stays decoupled from
// the engine libs (which we must NOT edit) while remaining fully typed — no `any`.

// The discrepancy verdict string union, derived from the engine's own schema so it
// can never drift from what the API actually returns.
export type VerifyVerdict = VerificationResult["discrepancy_type"];

// The grounded verification block returned by verifyClaim() (spans carry char offsets).
export type VerifyVerification = GroundedVerificationResult;

export interface VerifySource {
  title: string;
  url: string;
  source_type: string;
  raw_text: string;
}

// Full response shape of `POST /api/verify/text` on success.
export interface VerifyResult {
  status: string;
  claim: string;
  source: VerifySource;
  finding: ExtractedFinding;
  verification: VerifyVerification;
  effect_size_check: Reconciliation;
}

// Presentational metadata for the main verdict badge (label + house Tailwind tokens).
// Colour semantics: green = accurate, amber = drift/overgeneralized, orange = caveat
// missing, red = distortion / unsupported.
export interface BadgeStyle {
  label: string;
  className: string;
}

export const VERDICT_STYLES: Record<VerifyVerdict, BadgeStyle> = {
  accurate: {
    label: "Accurate",
    className: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  magnitude_overstated: {
    label: "Overstated",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  population_overgeneralized: {
    label: "Overgeneralized",
    className: "border-amber-300 bg-amber-50 text-amber-700",
  },
  caveat_dropped: {
    label: "Caveat Missing",
    className: "border-orange-200 bg-orange-50 text-orange-700",
  },
  no_support_found: {
    label: "Unsupported",
    className: "border-red-300 bg-red-100 text-red-800",
  },
};

// One-line plain-language summary of what each verdict means, shown under the badge
// so a first-time reviewer understands the call without prior context.
export const VERDICT_MEANING: Record<VerifyVerdict, string> = {
  accurate: "The claim faithfully represents the source finding.",
  magnitude_overstated: "The claim reports a larger effect than the source supports.",
  population_overgeneralized: "The claim applies the finding to a broader population than studied.",
  caveat_dropped: "The claim omits a limitation or qualification stated in the source.",
  no_support_found: "The source does not support this claim.",
};

// Presentational metadata for the deterministic effect-size reconciliation verdict.
export const RECONCILE_STYLES: Record<ReconcileVerdict, BadgeStyle> = {
  magnitude_overstated: {
    label: "Magnitude Overstated",
    className: "border-red-200 bg-red-50 text-red-700",
  },
  caveat_dropped: {
    label: "Caveat Dropped",
    className: "border-orange-200 bg-orange-50 text-orange-700",
  },
  consistent: {
    label: "Consistent",
    className: "border-emerald-300 bg-emerald-50 text-emerald-700",
  },
  cannot_reconcile: {
    label: "Cannot Reconcile",
    className: "border-ink/15 bg-white text-ink/50",
  },
};

// Cross-source agreement label + tone, shown as context next to the trust score.
export const AGREEMENT_LABELS: Record<
  VerifyVerification["cross_source_agreement"],
  string
> = {
  single_source: "Single source (no corroboration in this check)",
  corroborated: "Corroborated by other retrieved sources",
  conflicting: "Conflicts with other retrieved sources",
};

// A trust score < this reads as "low confidence" to a reviewer; used only for the
// human-readable qualifier next to the number, not for any verdict logic.
export const TRUST_SCORE_STRONG = 80;
export const TRUST_SCORE_WEAK = 50;

export function trustQualifier(score: number): string {
  if (score >= TRUST_SCORE_STRONG) return "high confidence";
  if (score >= TRUST_SCORE_WEAK) return "moderate confidence";
  return "low confidence";
}
