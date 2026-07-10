// Deterministic ABSOLUTE-EFFECT translation.
//
// A pooled RELATIVE effect (RR / HR / OR) tells you nothing a clinician can act on
// until it is anchored to a baseline (control) risk. This module does that anchoring
// deterministically: given a relative effect + assumed control-arm risk, it returns
// the ARsolute Risk Reduction/Increase, the Number Needed to Treat/Harm, and
// events-per-1000 — each with a 95% CI propagated from the relative effect's CI.
//
// No LLM is in this loop. Every number is a closed-form function of the four inputs
// (measure, point, CI bounds, baseline), reproducible and oracle-tested. Pure: no
// mutation, no randomness, no I/O.
//
// Method notes:
//  - RR: riskTreated = baseline * RR (a risk ratio scales the risk directly).
//  - OR: odds are scaled, not risk, so we convert baseline risk -> control odds,
//    multiply by OR, then convert the treated odds back to a risk. This is the
//    standard OR -> absolute-risk conversion (e.g. the one Cochrane/GRADE use for
//    "assumed vs corresponding risk" tables).
//  - HR: a hazard ratio governs the instantaneous event rate, not a risk directly.
//    Absolutely-correct translation needs the full baseline survival curve. Here we
//    apply the common, explicitly-approximate GRADE simplification of treating the
//    HR as a risk ratio of the cumulative incidence at the chosen baseline. This is
//    documented as an approximation and is exact only when the baseline risk is small.
//
// The relative-effect CI is propagated by applying each CI bound of the relative
// effect to the baseline via the same transform, giving an ARR interval. Because the
// transform is monotone in the relative effect, the ARR bounds come straight from the
// relative bounds (a lower RR/OR/HR -> lower treated risk -> larger reduction).

export type AbsoluteMeasure = "RR" | "HR" | "OR";

export interface AbsoluteEffectInput {
  measure: AbsoluteMeasure;
  point: number; // relative effect point estimate (ratio scale, > 0)
  ciLower: number; // lower bound of the relative effect's 95% CI (ratio scale)
  ciUpper: number; // upper bound of the relative effect's 95% CI (ratio scale)
  baselineRisk: number; // assumed control-arm risk, strictly in (0, 1)
}

export type EffectDirection = "benefit" | "harm" | "null";

export interface AbsoluteEffect {
  riskTreated: number; // absolute risk in the treated arm (0..1)
  riskControl: number; // the assumed baseline (echoed for symmetry)
  absoluteRiskReduction: number; // control - treated; positive = benefit, negative = harm
  nnt: number; // 1/ARR, sign-aware: positive = NNT (benefit), negative = NNH (harm)
  eventsPer1000Treated: number; // riskTreated * 1000, rounded to whole events
  eventsPer1000Control: number; // riskControl * 1000, rounded to whole events
  arrCiLower: number; // lower bound of the ARR (from the relative effect's CI)
  arrCiUpper: number; // upper bound of the ARR
  nntCiLower: number; // NNT/NNH bound corresponding to arrCiUpper (smaller |NNT|)
  nntCiUpper: number; // NNT/NNH bound corresponding to arrCiLower (larger |NNT|)
  direction: EffectDirection;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Apply a relative effect to a baseline risk, returning the treated-arm risk.
// Encapsulates the per-measure transform so the point estimate and each CI bound
// all go through exactly the same math.
function treatedRisk(measure: AbsoluteMeasure, relative: number, baseline: number): number {
  switch (measure) {
    case "OR": {
      const oddsControl = baseline / (1 - baseline);
      const oddsTreated = oddsControl * relative;
      return oddsTreated / (1 + oddsTreated);
    }
    // RR scales risk directly; HR is treated as a risk ratio of cumulative
    // incidence at the baseline (documented approximation — see file header).
    case "RR":
    case "HR":
    default:
      return baseline * relative;
  }
}

// NNT/NNH from an ARR: the reciprocal, sign-aware. A positive ARR (benefit) yields a
// positive NNT; a negative ARR (harm) yields a negative value read as NNH. Returns
// Infinity when the ARR is exactly zero (no absolute difference => infinite NNT).
function nntFromArr(arr: number): number {
  if (arr === 0) return Infinity;
  return 1 / arr;
}

function directionOf(arr: number): EffectDirection {
  if (arr > 0) return "benefit";
  if (arr < 0) return "harm";
  return "null";
}

/**
 * Translate a pooled relative effect + an assumed baseline risk into the absolute
 * numbers clinicians act on: ARR/ARI, NNT/NNH, and events-per-1000, each with a 95%
 * CI propagated from the relative effect's CI.
 *
 * Returns null when the baseline risk is not strictly inside (0, 1), or when any
 * relative-effect input is non-finite / non-positive — a ratio measure must be
 * positive to be meaningful, and an out-of-range baseline has no clinical reading.
 *
 * Pure: does not mutate its input.
 */
export function absoluteFromRelative(input: AbsoluteEffectInput): AbsoluteEffect | null {
  const { measure, point, ciLower, ciUpper, baselineRisk } = input;

  // Guard the baseline to the open interval (0, 1) — 0 and 1 both break the odds
  // conversion and have no meaningful ARR reading.
  if (!Number.isFinite(baselineRisk) || baselineRisk <= 0 || baselineRisk >= 1) {
    return null;
  }
  // Ratio measures must be finite and strictly positive.
  if (![point, ciLower, ciUpper].every((x) => Number.isFinite(x) && x > 0)) {
    return null;
  }

  const riskControl = baselineRisk;
  const riskTreated = treatedRisk(measure, point, baselineRisk);

  // Propagate the CI: apply each relative bound to the baseline. The transform is
  // monotone increasing in the relative effect, so a smaller relative value gives a
  // smaller treated risk -> a LARGER reduction (arrUpper), and vice versa.
  const treatedFromLower = treatedRisk(measure, ciLower, baselineRisk);
  const treatedFromUpper = treatedRisk(measure, ciUpper, baselineRisk);

  const absoluteRiskReduction = riskControl - riskTreated;
  const arrFromLowerRel = riskControl - treatedFromLower; // larger reduction
  const arrFromUpperRel = riskControl - treatedFromUpper; // smaller reduction

  // Order the two ARR bounds so arrCiLower <= arrCiUpper regardless of measure/sign.
  const arrCiLower = Math.min(arrFromLowerRel, arrFromUpperRel);
  const arrCiUpper = Math.max(arrFromLowerRel, arrFromUpperRel);

  // NNT bounds are reciprocals of the ARR bounds. The larger |ARR| gives the smaller
  // |NNT| (more favorable), so nntCiLower pairs with arrCiUpper.
  const nntCiLower = nntFromArr(arrCiUpper);
  const nntCiUpper = nntFromArr(arrCiLower);

  return {
    riskTreated: round(riskTreated, 4),
    riskControl: round(riskControl, 4),
    absoluteRiskReduction: round(absoluteRiskReduction, 4),
    nnt: round(nntFromArr(absoluteRiskReduction), 1),
    eventsPer1000Treated: Math.round(riskTreated * 1000),
    eventsPer1000Control: Math.round(riskControl * 1000),
    arrCiLower: round(arrCiLower, 4),
    arrCiUpper: round(arrCiUpper, 4),
    nntCiLower: round(nntCiLower, 1),
    nntCiUpper: round(nntCiUpper, 1),
    direction: directionOf(absoluteRiskReduction),
  };
}

/**
 * Plain-language, clinician-facing sentence for an absolute effect. Frames the result
 * as events-per-1000 (which lay/clinical audiences read more easily than a decimal
 * ARR) plus the NNT/NNH. Pure: derives everything from the passed AbsoluteEffect.
 */
export function formatAbsolute(effect: AbsoluteEffect): string {
  const eventDelta = Math.abs(
    effect.eventsPer1000Control - effect.eventsPer1000Treated
  );
  const nntAbs = Math.abs(effect.nnt);

  if (effect.direction === "null" || eventDelta === 0) {
    return "For every 1000 patients treated, no change in the number of events versus control.";
  }

  if (effect.direction === "benefit") {
    return (
      `For every 1000 patients treated, ~${eventDelta} fewer events ` +
      `(NNT ${nntAbs} to prevent one event).`
    );
  }

  // harm
  return (
    `For every 1000 patients treated, ~${eventDelta} more events ` +
    `(NNH ${nntAbs} to cause one additional event).`
  );
}
