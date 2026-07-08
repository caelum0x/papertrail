// Deterministic verification against a trial's REGISTERED statistical results.
// This is the part a generic LLM claim-checker cannot do: instead of asking a model
// to compare two blobs of text, we compare the claim's stated effect against the
// sponsor-reported effect estimate from ClinicalTrials.gov's structured resultsSection
// (paramValue, CI, p-value) — ground truth that cannot be fabricated. No LLM in the loop.

import { TrialResultAnalysis } from "./sources/clinicaltrials";
import { claimedReductionPercent } from "./effectSize";

export type RegistryVerdict =
  | "matches_registry" // claim's magnitude agrees with the registered primary result
  | "overstates_registry" // claim's effect is materially larger than registered
  | "understates_registry" // claim's effect is materially smaller than registered
  | "significance_mismatch" // claim asserts benefit but registered CI crosses the null
  | "secondary_endpoint_match" // claim matches a SECONDARY outcome, not the primary
  | "no_registered_results" // trial has no posted results to check against
  | "not_comparable"; // results exist but no comparable numeric claim/measure

export interface RegistryCheck {
  verdict: RegistryVerdict;
  rationale: string;
  /** The specific registered analysis we checked against (for the citation trail). */
  primaryAnalysis: TrialResultAnalysis | null;
  claimedReductionPercent: number | null;
  registeredReductionPercent: number | null;
  /** Raw-count-derived stats from the registry (percentage points / count), when available. */
  absoluteRiskReduction: number | null;
  numberNeededToTreat: number | null;
}

// Claimed effect must exceed the registered effect by this factor to be "overstated".
const OVERSTATE_FACTOR = 1.5;

function isRatioMeasure(paramType: string | null): boolean {
  if (!paramType) return false;
  const p = paramType.toLowerCase();
  return (
    p.includes("hazard ratio") ||
    p.includes("odds ratio") ||
    p.includes("risk ratio") ||
    p.includes("rate ratio") ||
    p.includes("relative risk") ||
    /\b(hr|or|rr)\b/.test(p)
  );
}

/** The relative reduction (%) implied by a registered ratio estimate, e.g. HR 0.75 -> 25. */
function ratioToReductionPercent(value: number): number {
  return (1 - value) * 100;
}

/** True when a ratio analysis's CI spans the null value of 1 (not statistically significant). */
function ciCrossesNull(a: TrialResultAnalysis): boolean {
  if (a.ciLower === null || a.ciUpper === null) return false;
  return a.ciLower <= 1 && a.ciUpper >= 1;
}

const BENEFIT_RE =
  /\b(reduc\w*|lower\w*|cut\w*|decreas\w*|improv\w*|effective|benefit\w*|prevent\w*|halv\w*|cuts?\b)/i;

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function describe(a: TrialResultAnalysis): string {
  const ci =
    a.ciLower !== null && a.ciUpper !== null ? ` (${a.ciPct ?? 95}% CI ${a.ciLower}–${a.ciUpper})` : "";
  const p = a.pValue ? `, p=${a.pValue}` : "";
  return `${a.paramType} ${a.paramValue}${ci}${p}`;
}

/** Two relative-reduction magnitudes agree if neither materially exceeds the other. */
function magnitudesClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return Math.abs(a - b) < 5;
  return a <= b * OVERSTATE_FACTOR && b <= a * OVERSTATE_FACTOR;
}

/** The relative reduction (%) implied by a ratio analysis, or null if not a usable ratio. */
function ratioReduction(a: TrialResultAnalysis): number | null {
  if (!isRatioMeasure(a.paramType) || a.paramValue === null) return null;
  return ratioToReductionPercent(a.paramValue);
}

/** A sentence describing the raw-count-derived absolute stats, when available. */
function absoluteStatsText(a: TrialResultAnalysis): string {
  if (a.absoluteRiskReduction === null || a.absoluteRiskReduction === undefined) return "";
  const nnt = a.numberNeededToTreat != null ? `, NNT ${Math.round(a.numberNeededToTreat)}` : "";
  return ` The registered raw counts give an absolute risk reduction of ${round(a.absoluteRiskReduction)} percentage points${nnt}.`;
}

/**
 * Check a claim against a trial's registered results. Deterministic and defensible:
 * fires only on the rule-decidable cases and cites the exact registered analysis,
 * including the sponsor's raw-count absolute risk reduction / NNT when available, and
 * detects when a claim's effect matches a secondary — not the primary — endpoint.
 */
export function checkAgainstRegistry(
  claim: string,
  analyses: TrialResultAnalysis[]
): RegistryCheck {
  if (analyses.length === 0) {
    return {
      verdict: "no_registered_results",
      rationale: "This trial has no results posted to ClinicalTrials.gov, so there is no registered statistic to check the claim against.",
      primaryAnalysis: null,
      claimedReductionPercent: null,
      registeredReductionPercent: null,
      absoluteRiskReduction: null,
      numberNeededToTreat: null,
    };
  }

  // Prefer a primary ratio outcome with a usable point estimate.
  const primary =
    analyses.find((a) => a.outcomeType === "PRIMARY" && isRatioMeasure(a.paramType) && a.paramValue !== null) ??
    analyses.find((a) => isRatioMeasure(a.paramType) && a.paramValue !== null) ??
    analyses[0];

  const arr = primary.absoluteRiskReduction ?? null;
  const nnt = primary.numberNeededToTreat ?? null;

  if (!isRatioMeasure(primary.paramType) || primary.paramValue === null) {
    return {
      verdict: "not_comparable",
      rationale: `The registered primary analysis (${describe(primary)}) isn't a ratio effect this checker can reconcile numerically; deferring rather than guessing.`,
      primaryAnalysis: primary,
      claimedReductionPercent: null,
      registeredReductionPercent: null,
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  const registeredReduction = ratioToReductionPercent(primary.paramValue);
  const claimedReduction = claimedReductionPercent(claim);
  const assertsBenefit = BENEFIT_RE.test(claim);

  // Significance: the claim asserts a benefit but the registered CI includes the null.
  if (assertsBenefit && ciCrossesNull(primary)) {
    return {
      verdict: "significance_mismatch",
      rationale: `The claim asserts a benefit, but the registered primary result ${describe(primary)} has a confidence interval that crosses 1 (not statistically significant).`,
      primaryAnalysis: primary,
      claimedReductionPercent: claimedReduction,
      registeredReductionPercent: round(registeredReduction),
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  if (claimedReduction === null) {
    return {
      verdict: "not_comparable",
      rationale: `Registered primary result: ${describe(primary)} (≈${round(registeredReduction)}% reduction).${absoluteStatsText(primary)} The claim states no comparable numeric effect to reconcile.`,
      primaryAnalysis: primary,
      claimedReductionPercent: null,
      registeredReductionPercent: round(registeredReduction),
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  // Endpoint switch: the claim doesn't match the PRIMARY outcome, but does match a
  // SECONDARY one — a common distortion (citing a secondary finding as the headline result).
  if (!magnitudesClose(claimedReduction, registeredReduction)) {
    const secondary = analyses.find(
      (a) =>
        a !== primary &&
        a.outcomeType !== "PRIMARY" &&
        ratioReduction(a) !== null &&
        magnitudesClose(claimedReduction, ratioReduction(a) as number)
    );
    if (secondary) {
      return {
        verdict: "secondary_endpoint_match",
        rationale: `The claim's ~${round(claimedReduction)}% reduction does not match the trial's PRIMARY result (${describe(primary)}, ≈${round(registeredReduction)}%), but it matches a SECONDARY outcome — "${secondary.outcomeTitle}" (${describe(secondary)}). A secondary/exploratory finding shouldn't be presented as the trial's headline result.`,
        primaryAnalysis: primary,
        claimedReductionPercent: round(claimedReduction),
        registeredReductionPercent: round(registeredReduction),
        absoluteRiskReduction: arr,
        numberNeededToTreat: nnt,
      };
    }
  }

  if (registeredReduction > 0 && claimedReduction > registeredReduction * OVERSTATE_FACTOR) {
    return {
      verdict: "overstates_registry",
      rationale: `The claim implies a ~${round(claimedReduction)}% reduction, but the registered primary result is ${describe(primary)} — about a ${round(registeredReduction)}% reduction.${absoluteStatsText(primary)} The claim overstates the trial's own registered effect.`,
      primaryAnalysis: primary,
      claimedReductionPercent: round(claimedReduction),
      registeredReductionPercent: round(registeredReduction),
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  if (registeredReduction > 0 && claimedReduction * OVERSTATE_FACTOR < registeredReduction) {
    return {
      verdict: "understates_registry",
      rationale: `The claim implies a ~${round(claimedReduction)}% reduction, but the registered primary result is ${describe(primary)} — about a ${round(registeredReduction)}% reduction.${absoluteStatsText(primary)} The claim understates the registered effect.`,
      primaryAnalysis: primary,
      claimedReductionPercent: round(claimedReduction),
      registeredReductionPercent: round(registeredReduction),
      absoluteRiskReduction: arr,
      numberNeededToTreat: nnt,
    };
  }

  return {
    verdict: "matches_registry",
    rationale: `The claim's ~${round(claimedReduction)}% reduction agrees with the registered primary result: ${describe(primary)} (≈${round(registeredReduction)}% reduction).${absoluteStatsText(primary)}`,
    primaryAnalysis: primary,
    claimedReductionPercent: round(claimedReduction),
    registeredReductionPercent: round(registeredReduction),
    absoluteRiskReduction: arr,
    numberNeededToTreat: nnt,
  };
}
