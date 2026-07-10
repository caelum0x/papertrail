// Deterministic survival / time-to-event engine. This is a NEW moat capability for
// PaperTrail: it reconciles time-to-event efficacy claims (hazard ratios, median
// survival, absolute risk at a landmark timepoint) against the numbers a trial
// actually reports — with NO LLM anywhere in the numeric loop. Every function here
// is a pure closed-form computation of an accepted biostatistics formula (Peto
// logrank O–E hazard ratio, median-survival ratio, Kaplan–Meier absolute risk
// reduction / NNT), oracle-tested against reference tools (metafor/RevMan/epitools).
//
// The claim reconciler mirrors lib/synthesisVerification.ts: it applies ONLY
// rule-decidable comparisons on top of these deterministic numbers, and defers with
// "cannot_reconcile" rather than adjudicating a case a rule can't settle. It reuses
// lib/effectSize.ts `claimedReductionPercent` for parsing the claim and
// lib/stats/distributions.ts `ciZ` (built on the shared normal quantile) for the HR
// confidence interval — it never reimplements the quantile or the parser.
//
// No LLM, no network, no randomness, no mutation — pure numeric functions only.

import { z } from "zod";
import { claimedReductionPercent } from "./effectSize";
import { ciZ } from "./stats/distributions";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// The relative reduction (as a percent) implied by a hazard ratio, e.g. HR 0.7 -> 30.
function hrToReductionPercent(hr: number): number {
  return (1 - hr) * 100;
}

// ---------------------------------------------------------------------------
// 1. Hazard ratio from the logrank O–E (Peto) method
// ---------------------------------------------------------------------------

export interface HazardRatioEstimate {
  hazardRatio: number; // exp((O1 - E1) / V)
  logHazardRatio: number; // (O1 - E1) / V
  seLogHazardRatio: number; // 1 / sqrt(V)
  ciLower: number; // 95% CI (or `ciPct`) on the HR scale
  ciUpper: number;
  ciPct: number;
  reductionPercent: number; // (1 - HR) * 100
  significant: boolean; // CI excludes the null value of 1
}

/**
 * Hazard ratio and CI from the Peto (logrank) observed-minus-expected method.
 *
 * Given, for the treatment arm across the pooled logrank calculation:
 *   O1 = observed events in arm 1 (the treatment/experimental arm)
 *   E1 = expected events in arm 1 under the null of no difference
 *   V  = variance of (O1 - E1) — the hypergeometric logrank variance
 *
 * the Peto one-step estimate is:
 *   ln(HR) = (O1 - E1) / V,   SE(ln HR) = 1 / sqrt(V),   HR = exp(ln HR)
 * and the (1 - alpha) CI is exp(ln HR ± z * SE). This is the estimator metafor's
 * `escalc(measure="PETO")` and RevMan's Peto method use. Pure; returns null on
 * unusable inputs (V must be > 0). `ciPct` defaults to 95.
 */
export function hazardRatioFromLogrank(
  observedEvents: number,
  expectedEvents: number,
  variance: number,
  ciPct = 95
): HazardRatioEstimate | null {
  if (![observedEvents, expectedEvents, variance].every((x) => Number.isFinite(x))) {
    return null;
  }
  if (variance <= 0) return null;

  const oMinusE = observedEvents - expectedEvents;
  const logHr = oMinusE / variance;
  const seLogHr = 1 / Math.sqrt(variance);
  const hr = Math.exp(logHr);
  const z = ciZ(ciPct);
  const ciLower = Math.exp(logHr - z * seLogHr);
  const ciUpper = Math.exp(logHr + z * seLogHr);

  return {
    hazardRatio: round(hr, 3),
    logHazardRatio: round(logHr, 4),
    seLogHazardRatio: round(seLogHr, 4),
    ciLower: round(ciLower, 2),
    ciUpper: round(ciUpper, 2),
    ciPct,
    reductionPercent: round(hrToReductionPercent(hr), 1),
    significant: ciUpper < 1 || ciLower > 1,
  };
}

// ---------------------------------------------------------------------------
// 2. Median survival ratio
// ---------------------------------------------------------------------------

export interface MedianSurvivalRatioResult {
  ratio: number; // medianTreatment / medianControl
  prolongationPercent: number; // (ratio - 1) * 100 — how much longer on treatment
}

/**
 * Ratio of median survival times, medianTreatment / medianControl. Under an
 * exponential (constant-hazard) model this ratio equals 1/HR, which is how a median
 * benefit maps onto a hazard-ratio claim. Guards against non-positive medians —
 * a zero or negative median is not a usable survival time — and returns null there.
 * Pure.
 */
export function medianSurvivalRatio(
  medianTreatment: number,
  medianControl: number
): MedianSurvivalRatioResult | null {
  if (![medianTreatment, medianControl].every((x) => Number.isFinite(x))) return null;
  if (medianTreatment <= 0 || medianControl <= 0) return null;

  const ratio = medianTreatment / medianControl;
  return {
    ratio: round(ratio, 3),
    prolongationPercent: round((ratio - 1) * 100, 1),
  };
}

// ---------------------------------------------------------------------------
// 3. Absolute risk reduction at a landmark timepoint (from Kaplan–Meier S(t))
// ---------------------------------------------------------------------------

export interface AbsoluteRiskAtTimepointResult {
  timepoint: number | null; // the landmark t, echoed for the citation trail
  riskControl: number; // 1 - S_control(t)
  riskTreatment: number; // 1 - S_treat(t)
  absoluteRiskReduction: number; // S_treat(t) - S_control(t) = risk_control - risk_treat
  numberNeededToTreat: number | null; // 1 / ARR, null when ARR <= 0
}

/**
 * Absolute risk reduction at a landmark timepoint t from Kaplan–Meier survival
 * probabilities. Given S_control(t) and S_treat(t) (each a survival probability in
 * [0, 1]), the ARR at t is S_treat(t) - S_control(t) — equivalently the difference
 * in cumulative event risk, risk_control - risk_treat. NNT = 1 / ARR when the
 * treatment reduces risk (ARR > 0); otherwise NNT is null (no one is "needed to
 * treat" for a harm or a null effect). Probabilities outside [0, 1] are rejected.
 * Pure. `timepoint` is optional and only echoed back for the citation trail.
 */
export function absoluteRiskAtTimepoint(
  survivalControl: number,
  survivalTreatment: number,
  timepoint: number | null = null
): AbsoluteRiskAtTimepointResult | null {
  if (![survivalControl, survivalTreatment].every((x) => Number.isFinite(x))) return null;
  if (survivalControl < 0 || survivalControl > 1) return null;
  if (survivalTreatment < 0 || survivalTreatment > 1) return null;

  const riskControl = 1 - survivalControl;
  const riskTreatment = 1 - survivalTreatment;
  const arr = survivalTreatment - survivalControl; // = riskControl - riskTreatment
  const nnt = arr > 0 ? 1 / arr : null;

  return {
    timepoint,
    riskControl: round(riskControl, 4),
    riskTreatment: round(riskTreatment, 4),
    absoluteRiskReduction: round(arr, 4),
    numberNeededToTreat: nnt === null ? null : round(nnt, 1),
  };
}

// ---------------------------------------------------------------------------
// 4. Claim reconciler: verify a survival claim against the trial's own numbers
// ---------------------------------------------------------------------------

export type SurvivalVerdict =
  | "matches_hr" // claim's relative reduction agrees with the trial HR
  | "overstates_hr" // claim materially exceeds the HR-implied reduction
  | "understates_hr" // claim is materially smaller than the HR-implied reduction
  | "median_vs_hr_mismatch" // claim's median-implied HR disagrees with the reported HR
  | "not_significant" // claim asserts a benefit but the HR CI crosses the null
  | "cannot_reconcile"; // no comparable numbers, or a case no rule can settle

export interface SurvivalData {
  // At least one of these must be present for a reconciliation to be possible.
  hazardRatio?: number | null;
  hrCiLower?: number | null;
  hrCiUpper?: number | null;
  medianTreatment?: number | null; // median survival on the treatment arm
  medianControl?: number | null; // median survival on the control arm
}

export interface SurvivalCheck {
  verdict: SurvivalVerdict;
  rationale: string;
  claimedReductionPercent: number | null;
  hazardRatio: number | null;
  hrReductionPercent: number | null;
  medianRatio: number | null;
  medianImpliedHr: number | null;
}

// A claimed relative reduction must exceed the trial's by this factor before we call
// it overstated — keeps us off borderline rounding disputes (mirrors effectSize.ts).
const OVERSTATE_FACTOR = 1.5;

// The median-implied HR (1/ratio, exponential model) may differ from the reported HR
// by at most this multiplicative tolerance before we flag a median-vs-HR mismatch.
const MEDIAN_HR_TOLERANCE = 1.5;

// A definite benefit assertion in the claim (same grammar as effectSize.ts).
const BENEFIT_RE =
  /\b(reduc\w*|lower\w*|cut\w*|decreas\w*|improv\w*|effective|benefit\w*|prevent\w*|halv\w*|cuts?\b|prolong\w*|extend\w*|surviv\w*)/i;

function hrCiCrossesNull(lower: number | null | undefined, upper: number | null | undefined): boolean {
  if (lower === null || lower === undefined || upper === null || upper === undefined) return false;
  return lower <= 1 && upper >= 1;
}

function magnitudesClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return Math.abs(a - b) < 5;
  return a <= b * OVERSTATE_FACTOR && b <= a * OVERSTATE_FACTOR;
}

/**
 * Deterministically reconcile a time-to-event claim against a trial's own reported
 * survival numbers. Mirrors the philosophy of verifyAgainstSynthesis: it fires ONLY
 * on rule-decidable cases and otherwise defers.
 *
 * Order of adjudication (most disqualifying first):
 *   1. not_significant   — claim asserts a benefit but the HR's CI crosses 1.
 *   2. median_vs_hr_mismatch — reported HR and reported medians tell inconsistent
 *      stories (the exponential-model median-implied HR ≠ the reported HR).
 *   3. overstates_hr / understates_hr — the claimed relative reduction materially
 *      differs from the HR-implied reduction.
 *   4. matches_hr — the claimed reduction agrees with the HR.
 *   5. cannot_reconcile — no HR and no median pair, or no comparable numeric claim.
 *
 * Pure: never mutates its inputs; returns a fresh object.
 */
export function verifyAgainstSurvival(claim: string, data: SurvivalData): SurvivalCheck {
  const hr = data.hazardRatio ?? null;
  const median =
    data.medianTreatment != null && data.medianControl != null
      ? medianSurvivalRatio(data.medianTreatment, data.medianControl)
      : null;
  const medianRatio = median?.ratio ?? null;
  // Under an exponential model the HR implied by a median ratio is 1 / ratio.
  const medianImpliedHr = medianRatio && medianRatio > 0 ? round(1 / medianRatio, 3) : null;

  const claimed = claimedReductionPercent(claim);
  const hrReduction = hr !== null && hr > 0 ? hrToReductionPercent(hr) : null;
  const assertsBenefit = BENEFIT_RE.test(claim);

  const base = {
    claimedReductionPercent: claimed === null ? null : round(claimed, 1),
    hazardRatio: hr,
    hrReductionPercent: hrReduction === null ? null : round(hrReduction, 1),
    medianRatio,
    medianImpliedHr,
  };

  // Nothing to reconcile against.
  if (hr === null && medianImpliedHr === null) {
    return {
      ...base,
      verdict: "cannot_reconcile",
      rationale:
        "No hazard ratio and no pair of median survival times were provided, so there is no time-to-event number to reconcile the claim against.",
    };
  }

  // (1) NOT SIGNIFICANT: the claim asserts a benefit but the reported HR's CI crosses
  // the null of 1. A non-significant survival result must not be reframed as a benefit.
  if (
    hr !== null &&
    assertsBenefit &&
    hrCiCrossesNull(data.hrCiLower, data.hrCiUpper)
  ) {
    return {
      ...base,
      verdict: "not_significant",
      rationale: `The trial reports HR ${hr} with a 95% CI of ${data.hrCiLower}–${data.hrCiUpper}, which crosses the null of 1 (not statistically significant), but the claim asserts a definite survival benefit.`,
    };
  }

  // (2) MEDIAN vs HR MISMATCH: both a reported HR and a median pair exist, but the
  // exponential-model HR implied by the medians disagrees with the reported HR.
  if (hr !== null && medianImpliedHr !== null && !magnitudesClose(hr, medianImpliedHr)) {
    return {
      ...base,
      verdict: "median_vs_hr_mismatch",
      rationale: `The reported hazard ratio (HR ${hr}) and the reported medians (${data.medianTreatment} vs ${data.medianControl}; median ratio ${medianRatio}, which implies HR ≈ ${medianImpliedHr} under a constant-hazard model) tell inconsistent stories — the median benefit and the hazard ratio cannot both be cited as stated.`,
    };
  }

  // Pick the HR to reconcile the claim against: the reported HR if present, else the
  // median-implied HR. Beyond here we need a comparable numeric claim.
  const effectiveHr = hr ?? medianImpliedHr;
  if (effectiveHr === null || effectiveHr <= 0) {
    return {
      ...base,
      verdict: "cannot_reconcile",
      rationale: "The provided survival numbers do not yield a usable hazard ratio to reconcile the claim against.",
    };
  }
  const effectiveReduction = hrToReductionPercent(effectiveHr);
  const hrLabel = hr !== null ? `HR ${hr}` : `a median-implied HR ≈ ${medianImpliedHr}`;

  if (claimed === null) {
    return {
      ...base,
      verdict: "cannot_reconcile",
      rationale: `The trial reports ${hrLabel} (about a ${round(effectiveReduction, 1)}% relative reduction), but the claim states no comparable numeric magnitude to reconcile.`,
    };
  }

  // (3) OVERSTATES / UNDERSTATES: the claimed relative reduction materially differs
  // from the HR-implied reduction.
  if (effectiveReduction > 0 && claimed > effectiveReduction * OVERSTATE_FACTOR) {
    return {
      ...base,
      verdict: "overstates_hr",
      rationale: `The claim implies a ~${round(claimed, 1)}% reduction, but the trial reports ${hrLabel} — about a ${round(effectiveReduction, 1)}% reduction. The claim overstates the reported hazard ratio.`,
    };
  }
  if (effectiveReduction > 0 && claimed * OVERSTATE_FACTOR < effectiveReduction) {
    return {
      ...base,
      verdict: "understates_hr",
      rationale: `The claim implies a ~${round(claimed, 1)}% reduction, but the trial reports ${hrLabel} — about a ${round(effectiveReduction, 1)}% reduction. The claim understates the reported hazard ratio.`,
    };
  }

  // (4) MATCHES: the claimed reduction agrees with the (effective) hazard ratio.
  return {
    ...base,
    verdict: "matches_hr",
    rationale: `The claim's ~${round(claimed, 1)}% reduction agrees with the trial's ${hrLabel} (about a ${round(effectiveReduction, 1)}% reduction).`,
  };
}

// ---------------------------------------------------------------------------
// Zod request schema for the /api/survival route
// ---------------------------------------------------------------------------

// Validated at the API boundary before any computation. The claim is bounded like
// /api/verify; the survival data is optional-per-field but the route requires enough
// to compute at least one thing (an HR, or a median pair, or KM survival probs).
export const SurvivalRequestSchema = z.object({
  claim: z
    .string()
    .trim()
    .min(10, "Please provide a claim of at least 10 characters.")
    .max(2000, "Claim is too long (max 2000 characters)."),
  hazardRatio: z.number().positive().optional(),
  hrCiLower: z.number().positive().optional(),
  hrCiUpper: z.number().positive().optional(),
  medianTreatment: z.number().positive().optional(),
  medianControl: z.number().positive().optional(),
  survivalControl: z.number().min(0).max(1).optional(),
  survivalTreatment: z.number().min(0).max(1).optional(),
  timepoint: z.number().positive().optional(),
});

export type SurvivalRequest = z.infer<typeof SurvivalRequestSchema>;
