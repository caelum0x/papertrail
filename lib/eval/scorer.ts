import type {
  CaseScore,
  ExpectedResult,
  PredictedResult,
  TrustBand,
} from "@/lib/eval/types";
import type { DiscrepancyType } from "@/lib/eval/schemas";

// Pure scoring for a single eval case. No mutation, no side effects, no I/O.
// A case is scored on three independent dimensions and passes only when all
// applicable dimensions hold:
//
//   1. discrepancy match  — predicted discrepancy_type equals the expected label.
//   2. span grounding     — every expected substring appears within one of the
//                           flagged source spans (verbatim). Skipped (treated as
//                           satisfied) when the case declares no expected substrings.
//   3. trust band match   — the predicted trust_score falls in the trust band the
//                           expected label implies (accurate -> high, unsupported ->
//                           low, everything in between -> moderate). This checks the
//                           numeric score agrees in spirit with the label without
//                           demanding an exact number from an LLM-derived pipeline.

// The trust band an expected discrepancy_type implies. A claim labeled "accurate"
// should score high; one with no support should score low; any material drift
// (magnitude/population/caveat) should land in the moderate band.
const EXPECTED_BAND: Record<DiscrepancyType, TrustBand> = {
  accurate: "high",
  magnitude_overstated: "moderate",
  population_overgeneralized: "moderate",
  caveat_dropped: "moderate",
  no_support_found: "low",
};

// Band cut points, mirroring lib/trustBand.ts (kept local so this module's
// scoring contract is self-contained and doesn't drift with UI banding).
const HIGH_MIN = 90;
const MODERATE_MIN = 60;

/** Band a 0–100 trust score. Out-of-range scores are clamped defensively. */
export function scoreToBand(score: number): TrustBand {
  const clamped = Number.isNaN(score) ? 0 : Math.max(0, Math.min(100, score));
  if (clamped >= HIGH_MIN) return "high";
  if (clamped >= MODERATE_MIN) return "moderate";
  return "low";
}

/** The trust band an expected discrepancy label implies. */
export function expectedBandFor(type: DiscrepancyType): TrustBand {
  return EXPECTED_BAND[type];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * True when every expected substring is contained (whitespace/case-insensitively)
 * within at least one of the flagged source spans the pipeline produced. This is
 * the eval-set analogue of PaperTrail's grounding invariant: the tool must not
 * only reach the right verdict, it must point at the right place in the source.
 */
export function spansCoverExpected(
  flaggedSourceSpans: readonly string[],
  expectedSubstrings: readonly string[]
): boolean {
  if (expectedSubstrings.length === 0) return true;
  const haystacks = flaggedSourceSpans.map(norm);
  return expectedSubstrings.every((expected) => {
    const needle = norm(expected);
    return needle.length > 0 && haystacks.some((h) => h.includes(needle));
  });
}

/**
 * Score one predicted result against its expected label. Returns a per-dimension
 * breakdown; `passed` is true only when the discrepancy matches, the trust band
 * matches, and (when applicable) all expected substrings are grounded in the
 * flagged spans. A pipeline error (predicted.error set / null discrepancy) fails
 * every dimension — an errored case is never a pass.
 */
export function scoreCase(
  predicted: PredictedResult,
  expected: ExpectedResult
): CaseScore {
  const spanGroundingApplicable = expected.expectedSubstrings.length > 0;

  if (predicted.error || predicted.discrepancyType === null) {
    return {
      passed: false,
      discrepancyMatch: false,
      spanGrounded: false,
      spanGroundingApplicable,
      trustBandMatch: false,
    };
  }

  const discrepancyMatch =
    predicted.discrepancyType === expected.discrepancyType;

  const spanGrounded = spansCoverExpected(
    predicted.flaggedSourceSpans,
    expected.expectedSubstrings
  );

  const predictedBand =
    predicted.trustBand ??
    (predicted.trustScore !== null ? scoreToBand(predicted.trustScore) : null);
  const trustBandMatch =
    predictedBand !== null &&
    predictedBand === expectedBandFor(expected.discrepancyType);

  const passed = discrepancyMatch && trustBandMatch && spanGrounded;

  return {
    passed,
    discrepancyMatch,
    spanGrounded,
    spanGroundingApplicable,
    trustBandMatch,
  };
}
