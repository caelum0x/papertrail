// EFFECT-SIZE SANITY rule engine.
//
// A bioinformatics finding quotes an effect size — an AUC, a hazard ratio (HR), or a
// log fold-change (logFC) — usually with a confidence interval and a claimed direction
// of benefit. This engine checks that the reported number is internally coherent and
// consistent with the claimed benefit, PURELY and with NO LLM:
//
//   AUC   — must lie in [0.5, 1]. A reported AUC below 0.5 (worse than chance) is a
//           data-sanity error; a CI must contain the point estimate.
//   HR    — a hazard ratio; direction: HR<1 = protective (benefit if a REDUCTION is
//           claimed), HR>1 = harmful. A CI must contain the point estimate, and if the CI
//           spans 1 the effect is not significant (an overstated "significant" claim).
//   logFC — sign is the direction of regulation; a CI (when given) must contain it.
//
// This is a PURE function of the provided numbers + the claimed benefit direction; it
// does NOT ground the number in source text (the verifier does that separately via
// locateSpan before calling this). Nothing is fabricated: a missing CI simply skips the
// CI check rather than inventing bounds.

import type { EffectMetric, FindingSignal } from "@/lib/bio/bioinformatics.schemas";

// The direction of benefit a finding claims for its effect. For AUC, higher is always
// better, so `claimedBenefit` is not consulted. For HR/logFC it disambiguates whether the
// reported sign/ratio supports the asserted benefit:
//   reduction — the claim asserts the marker/intervention REDUCES the outcome (HR<1 good).
//   increase  — the claim asserts an INCREASE (HR>1 / logFC>0 good).
export type ClaimedBenefit = "reduction" | "increase";

export interface EffectSizeInput {
  metric: EffectMetric;
  value: number;
  ciLower?: number | null;
  ciUpper?: number | null;
  // Only meaningful for HR/logFC; ignored for AUC.
  claimedBenefit?: ClaimedBenefit;
}

// One failed coherence check, surfaced verbatim for the audit trail.
export interface EffectSizeIssue {
  code:
    | "auc_out_of_range"
    | "ci_excludes_estimate"
    | "ci_inverted"
    | "ci_spans_null"
    | "direction_contradicts_benefit";
  message: string;
}

export interface EffectSizeSanityResult {
  metric: EffectMetric;
  value: number;
  issues: EffectSizeIssue[];
  signal: FindingSignal;
  summary: string;
}

// The null-effect value for each metric's CI: HR is a ratio (null = 1, no effect); logFC
// is a log difference (null = 0, no change). AUC's "null" (0.5, chance) is handled by the
// range check, not the spans-null check.
function nullValueFor(metric: EffectMetric): number | null {
  if (metric === "HR") return 1;
  if (metric === "logFC") return 0;
  return null;
}

// Does the CI, when both bounds are present and ordered, contain `value`?
function ciContains(
  value: number,
  lower: number | null | undefined,
  upper: number | null | undefined
): { checked: boolean; ordered: boolean; contains: boolean } {
  if (
    typeof lower !== "number" ||
    typeof upper !== "number" ||
    !Number.isFinite(lower) ||
    !Number.isFinite(upper)
  ) {
    return { checked: false, ordered: true, contains: true };
  }
  if (lower > upper) return { checked: true, ordered: false, contains: false };
  return { checked: true, ordered: true, contains: value >= lower && value <= upper };
}

// Does the (ordered) CI straddle the metric's null-effect value → not significant?
function ciSpansNull(
  metric: EffectMetric,
  lower: number | null | undefined,
  upper: number | null | undefined
): boolean {
  const nullVal = nullValueFor(metric);
  if (
    nullVal === null ||
    typeof lower !== "number" ||
    typeof upper !== "number" ||
    !Number.isFinite(lower) ||
    !Number.isFinite(upper) ||
    lower > upper
  ) {
    return false;
  }
  return lower <= nullVal && nullVal <= upper;
}

// For HR/logFC, does the reported effect's direction match the claimed benefit?
//   HR:   <1 is protective (matches "reduction"), >1 harmful (matches "increase").
//   logFC: >0 is up (matches "increase"), <0 down (matches "reduction").
function directionMatchesBenefit(
  metric: EffectMetric,
  value: number,
  benefit: ClaimedBenefit | undefined
): { checked: boolean; matches: boolean } {
  if (metric === "AUC" || benefit === undefined) {
    return { checked: false, matches: true };
  }
  if (metric === "HR") {
    if (value === 1) return { checked: true, matches: false };
    const protective = value < 1;
    return { checked: true, matches: benefit === "reduction" ? protective : !protective };
  }
  // logFC
  if (value === 0) return { checked: true, matches: false };
  const up = value > 0;
  return { checked: true, matches: benefit === "increase" ? up : !up };
}

/**
 * Assess effect-size sanity. PURE — no network, no LLM. Collects coherence issues and
 * rolls up ONE signal:
 *   - AUC out of [0.5,1], CI excludes/ inverts the estimate, or a direction that
 *     contradicts the claimed benefit → overstated (the finding is internally inconsistent
 *     or claims a benefit the number doesn't support — the dangerous direction).
 *   - CI spans the null value (not significant while implying significance) → overstated.
 *   - otherwise, a coherent effect → positive.
 */
export function verifyEffectSizeSanity(
  input: EffectSizeInput
): EffectSizeSanityResult {
  const { metric, value } = input;
  const issues: EffectSizeIssue[] = [];

  // 1. AUC range: must be in [0.5, 1].
  if (metric === "AUC" && (value < 0.5 || value > 1)) {
    issues.push({
      code: "auc_out_of_range",
      message: `Reported AUC ${value} is outside the valid [0.5, 1] range (0.5 = chance, 1 = perfect); the discrimination claim is not internally coherent.`,
    });
  }

  // 2. CI must contain the point estimate.
  const ci = ciContains(value, input.ciLower, input.ciUpper);
  if (ci.checked && !ci.ordered) {
    issues.push({
      code: "ci_inverted",
      message: `The confidence interval is inverted (lower bound ${input.ciLower} > upper bound ${input.ciUpper}), so it cannot be a valid interval for the estimate.`,
    });
  } else if (ci.checked && !ci.contains) {
    issues.push({
      code: "ci_excludes_estimate",
      message: `The reported confidence interval [${input.ciLower}, ${input.ciUpper}] does not contain the point estimate ${value}, which is internally inconsistent.`,
    });
  }

  // 3. CI spanning the null value → the effect isn't significant.
  if (ciSpansNull(metric, input.ciLower, input.ciUpper)) {
    const nullVal = nullValueFor(metric);
    issues.push({
      code: "ci_spans_null",
      message: `The confidence interval [${input.ciLower}, ${input.ciUpper}] spans the null-effect value (${nullVal}), so the ${metric} effect is not statistically significant.`,
    });
  }

  // 4. Direction vs claimed benefit (HR/logFC only).
  const dir = directionMatchesBenefit(metric, value, input.claimedBenefit);
  if (dir.checked && !dir.matches) {
    issues.push({
      code: "direction_contradicts_benefit",
      message: `The reported ${metric} of ${value} points in the OPPOSITE direction to the claimed ${input.claimedBenefit} benefit.`,
    });
  }

  const signal: FindingSignal = issues.length > 0 ? "overstated" : "positive";
  const summary =
    issues.length > 0
      ? `Effect-size sanity failed: ${issues.map((i) => i.message).join(" ")}`
      : `Reported ${metric} of ${value} is internally coherent${
          ci.checked ? " (CI contains the estimate)" : ""
        }${dir.checked ? " and consistent with the claimed benefit direction" : ""}.`;

  return { metric, value, issues, signal, summary };
}
