// Deterministic VERDICT-FRAGILITY ANALYSIS.
//
// A "significant" pooled verdict is not automatically a robust one. The classic
// question a generic significance checker never asks is: how many event
// reassignments would it take to FLIP the verdict? A trial that is significant
// only because of a single event in the smaller arm is statistically fragile —
// one patient's outcome could overturn the conclusion. This module answers that
// with two field-standard, fully deterministic devices:
//
//   1. The Walsh Fragility Index (FI) for a single 2x2 table: the minimum number
//      of event reassignments in the arm with fewer events required to move the
//      two-sided Fisher exact p-value across the 0.05 significance threshold.
//      A small FI (relative to the number of lost-to-follow-up patients) means a
//      brittle result; a large FI means a robust one.
//
//   2. A meta-analytic robustness check for a set of studies: reusing the
//      existing meta-analysis engine, it reports whether pooled significance
//      survives leave-one-study-out (LOO) deletion, and reuses the trial
//      sequential Required Information Size to state whether enough information
//      has accrued for the pooled verdict to be considered conclusive.
//
// NO LLM is anywhere in this loop. Every value is a pure closed-form or
// exhaustive-search computation; the same inputs always reproduce the same
// verdict. Reuses lib/biostats.ts, lib/metaAnalysis.ts and lib/trialSequential.ts
// WITHOUT editing them.

import { z } from "zod";
import { logGamma } from "./stats/distributions";
import { requiredInformationSize } from "./trialSequential";
import { metaAnalyze, type StudyEffectInput, type RatioMeasure } from "./metaAnalysis";

// ---------------------------------------------------------------------------
// Boundary schemas (validated before any math runs)
// ---------------------------------------------------------------------------

// A 2x2 contingency table. a/b are events/non-events in arm 1 (treatment),
// c/d are events/non-events in arm 2 (control). All non-negative integers.
export const TwoByTwoSchema = z.object({
  a: z.number().int().nonnegative(),
  b: z.number().int().nonnegative(),
  c: z.number().int().nonnegative(),
  d: z.number().int().nonnegative(),
});
export type TwoByTwo = z.infer<typeof TwoByTwoSchema>;

// One study for the meta-robustness path. Mirrors metaAnalysis' StudyEffectInput
// but validated at the boundary so the public route never trusts raw JSON.
const RatioMeasureSchema = z.enum(["RR", "HR", "OR"]);
export const FragilityStudySchema = z.object({
  label: z.string().min(1).max(200),
  measure: RatioMeasureSchema,
  point: z.number().finite().positive().nullish(),
  ciLower: z.number().finite().positive().nullish(),
  ciUpper: z.number().finite().positive().nullish(),
  ciPct: z.number().finite().gt(0).lt(100).nullish(),
  events1: z.number().int().nonnegative().nullish(),
  total1: z.number().int().positive().nullish(),
  events2: z.number().int().nonnegative().nullish(),
  total2: z.number().int().positive().nullish(),
});
export type FragilityStudyInput = z.infer<typeof FragilityStudySchema>;

// Optional RIS anticipation parameters for the meta path — used to decide
// whether enough information has accrued for the pooled verdict.
export const InformationSizeParamsSchema = z.object({
  controlRisk: z.number().finite().gt(0).lt(1),
  relativeRiskReduction: z.number().finite().gt(0).lt(1),
  alpha: z.number().finite().gt(0).lt(1).default(0.05),
  power: z.number().finite().gt(0).lt(1).default(0.8),
});
export type InformationSizeParamsInput = z.input<typeof InformationSizeParamsSchema>;

// A single request envelope so the public route can dispatch by mode.
export const FragilityRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("table") }).merge(TwoByTwoSchema),
  z.object({
    mode: z.literal("meta"),
    studies: z.array(FragilityStudySchema).min(2).max(100),
    informationSize: InformationSizeParamsSchema.optional(),
  }),
]);
export type FragilityRequest = z.infer<typeof FragilityRequestSchema>;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type FragilityVerdict = "fragile" | "moderate" | "robust" | "not_significant";

export interface FragilityIndexResult {
  fragilityIndex: number | null; // null when the table is not significant to begin with
  baselineP: number; // two-sided Fisher exact p of the given table
  flippedP: number | null; // Fisher exact p after the FI reassignments (just past 0.05)
  direction: "toward_significance" | "away_from_significance" | null;
  eventsAltered: number; // = fragilityIndex when defined, else 0
  smallerEventArm: 1 | 2 | null; // which arm's events were reassigned
  verdict: FragilityVerdict; // categorical robustness verdict for this table
  interpretation: string;
}

export interface InformationSizeResult {
  informationSizeMet: boolean;
  accruedN: number;
  requiredN: number;
  informationFraction: number; // accruedN / requiredN, capped at 1 for display
  note: string;
}

export interface RobustnessResult {
  pooledSignificant: boolean;
  survivesLeaveOneOut: boolean; // pooled significance holds after every single-study deletion
  flippingStudy: string | null; // the study whose removal flips the verdict (if any)
  k: number; // studies actually pooled
  note: string;
}

export interface FragilityTableResult {
  kind: "table";
  fragilityIndex: number | null;
  interpretation: string;
  verdict: FragilityVerdict;
  detail: FragilityIndexResult;
}

export interface FragilityMetaResult {
  kind: "meta";
  fragilityIndex: null; // FI is a single-table concept; the meta path reports robustness instead
  interpretation: string;
  verdict: FragilityVerdict;
  informationSizeMet: boolean | null;
  robustness: RobustnessResult;
  informationSize: InformationSizeResult | null;
}

export type FragilityResult = FragilityTableResult | FragilityMetaResult;

// ---------------------------------------------------------------------------
// Fisher exact test (deterministic, pure) — two-sided p-value for a 2x2 table
// ---------------------------------------------------------------------------

const SIGNIFICANCE_ALPHA = 0.05;
// Guardrail so the exhaustive FI search cannot run away on pathological inputs.
const MAX_TABLE_MARGIN = 1_000_000;

// ln(n!) via logGamma(n+1); keeps the hypergeometric probability numerically
// stable for large tables where factorials would overflow.
function logFactorial(n: number): number {
  return logGamma(n + 1);
}

// Point probability of a specific 2x2 table under the hypergeometric
// distribution with the observed margins fixed (the kernel of Fisher's test).
function hypergeometricLogProb(a: number, b: number, c: number, d: number): number {
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const col2 = b + d;
  const n = row1 + row2;
  return (
    logFactorial(row1) +
    logFactorial(row2) +
    logFactorial(col1) +
    logFactorial(col2) -
    logFactorial(n) -
    logFactorial(a) -
    logFactorial(b) -
    logFactorial(c) -
    logFactorial(d)
  );
}

/**
 * Two-sided Fisher exact test p-value for a 2x2 table, using the standard
 * "sum of all tables at least as extreme" definition: with the margins held
 * fixed, sum the hypergeometric probability of every table whose probability is
 * <= that of the observed table (with a small epsilon for float equality).
 *
 * Pure and deterministic. Returns a p in (0, 1].
 */
export function fisherExactTwoSided(table: TwoByTwo): number {
  const { a, b, c, d } = table;
  const row1 = a + b;
  const col1 = a + c;
  const n = row1 + c + d;

  if (n === 0) return 1;
  if (n > MAX_TABLE_MARGIN) {
    // Degenerate guard: astronomically large tables are outside this tool's
    // scope. Callers validate realistic trial sizes upstream.
    return 1;
  }

  // a ranges over all values consistent with the fixed margins.
  const aMin = Math.max(0, col1 - row2Total(a, b, c, d));
  const aMax = Math.min(row1, col1);

  const observedLogProb = hypergeometricLogProb(a, b, c, d);
  const threshold = observedLogProb + 1e-7; // epsilon for float equality

  let p = 0;
  for (let ai = aMin; ai <= aMax; ai++) {
    const bi = row1 - ai;
    const ci = col1 - ai;
    const di = n - ai - bi - ci;
    if (bi < 0 || ci < 0 || di < 0) continue;
    const lp = hypergeometricLogProb(ai, bi, ci, di);
    if (lp <= threshold) {
      p += Math.exp(lp);
    }
  }

  return Math.min(1, p);
}

// row2 total (c + d) expressed via the four cells so aMin is derivable without
// re-summing the whole table at the call site.
function row2Total(_a: number, _b: number, c: number, d: number): number {
  return c + d;
}

// ---------------------------------------------------------------------------
// 1. Walsh Fragility Index for a single 2x2 table
// ---------------------------------------------------------------------------

function classifyFragility(fi: number, smallerArmTotal: number): FragilityVerdict {
  // Field convention: an FI at or below 3 (and small relative to the arm) is a
  // brittle result; a large FI is robust. We scale the "moderate" band with the
  // arm size so a big trial isn't called fragile merely for an FI of 4.
  if (fi <= 3) return "fragile";
  const relative = smallerArmTotal > 0 ? fi / smallerArmTotal : 0;
  if (fi <= 10 || relative < 0.05) return "moderate";
  return "robust";
}

/**
 * Walsh Fragility Index for a 2x2 table.
 *
 * Definition: for a table that is significant at p < 0.05 (two-sided Fisher
 * exact), the FI is the minimum number of patients in the arm with FEWER events
 * whose outcome must be switched from non-event to event (moving them toward the
 * other arm's rate) to make the table NON-significant (p >= 0.05). For a table
 * that is NOT significant, we report the reverse: the minimum number of
 * reassignments needed to MAKE it significant (still a fragility measure — how
 * close the null result is to flipping).
 *
 * The search is exhaustive over the arm total (bounded by the arm size), moving
 * one event at a time and re-running the exact test, so the result is the true
 * minimum, not an approximation. Column margins are held fixed for the standard
 * FI (patients are reassigned within an arm: non-event -> event), matching the
 * original Walsh et al. algorithm and the `fragility` R package.
 */
export function fragilityIndex(table: TwoByTwo): FragilityIndexResult {
  const parsed = TwoByTwoSchema.parse(table);
  const { a, b, c, d } = parsed;

  const baselineP = fisherExactTwoSided(parsed);
  const total1 = a + b;
  const total2 = c + d;

  const startSignificant = baselineP < SIGNIFICANCE_ALPHA;

  // Choose the arm with fewer events — reassigning there needs the fewest moves,
  // which is the standard FI convention.
  const smallerEventArm: 1 | 2 = a <= c ? 1 : 2;

  // Walk one event at a time in the chosen arm (non-event -> event), rerunning
  // Fisher's test after each move, until the significance state flips. The arm
  // total is fixed (a patient becomes an event; the arm size is unchanged), so
  // the row margin of that arm is preserved — the classic Walsh procedure.
  let curA = a;
  let curB = b;
  let curC = c;
  let curD = d;
  const armTotal = smallerEventArm === 1 ? total1 : total2;

  let steps = 0;
  let flippedP: number | null = null;
  for (let i = 0; i < armTotal; i++) {
    if (smallerEventArm === 1) {
      if (curB <= 0) break; // no non-events left to convert
      curA += 1;
      curB -= 1;
    } else {
      if (curD <= 0) break;
      curC += 1;
      curD -= 1;
    }
    steps += 1;
    const p = fisherExactTwoSided({ a: curA, b: curB, c: curC, d: curD });
    const nowSignificant = p < SIGNIFICANCE_ALPHA;
    if (nowSignificant !== startSignificant) {
      flippedP = p;
      break;
    }
  }

  const flipped = flippedP !== null;
  const fi = flipped ? steps : null;
  const smallerArmTotal = smallerEventArm === 1 ? total1 : total2;

  let verdict: FragilityVerdict;
  let interpretation: string;
  let direction: FragilityIndexResult["direction"];

  if (!startSignificant) {
    verdict = "not_significant";
    direction = flipped ? "toward_significance" : null;
    interpretation = flipped
      ? `The table is NOT significant (Fisher exact p = ${baselineP.toFixed(4)} ≥ 0.05). ` +
        `Reassigning ${fi} outcome${fi === 1 ? "" : "s"} in arm ${smallerEventArm} would be enough ` +
        `to make it significant — a non-significant result this close to the threshold is itself ` +
        `fragile and should not be over-interpreted as evidence of no effect.`
      : `The table is NOT significant (Fisher exact p = ${baselineP.toFixed(4)} ≥ 0.05), and no ` +
        `reassignment within arm ${smallerEventArm} makes it significant. The result is stably ` +
        `non-significant on these counts.`;
  } else if (!flipped) {
    verdict = "robust";
    direction = null;
    interpretation =
      `The result is significant (Fisher exact p = ${baselineP.toFixed(4)} < 0.05) and no complete ` +
      `reassignment of arm ${smallerEventArm} makes it non-significant — the verdict is highly robust.`;
  } else {
    verdict = classifyFragility(fi as number, smallerArmTotal);
    direction = "away_from_significance";
    const relPct = smallerArmTotal > 0 ? (((fi as number) / smallerArmTotal) * 100).toFixed(1) : "n/a";
    interpretation =
      `Fragility Index = ${fi}: reassigning just ${fi} event${fi === 1 ? "" : "s"} in arm ` +
      `${smallerEventArm} (${relPct}% of that arm) flips the two-sided Fisher exact p from ` +
      `${baselineP.toFixed(4)} to ${(flippedP as number).toFixed(4)} (≥ 0.05). ` +
      (verdict === "fragile"
        ? `This is a FRAGILE result — a handful of outcome changes overturns the verdict, so it should ` +
          `not be treated as settled without corroborating evidence.`
        : verdict === "moderate"
          ? `This is a moderately robust result — it would take a non-trivial but not implausible number ` +
            `of outcome changes to overturn it.`
          : `This is a robust result — a large number of outcome changes would be required to overturn it.`);
  }

  return {
    fragilityIndex: fi,
    baselineP,
    flippedP,
    direction,
    eventsAltered: fi ?? 0,
    smallerEventArm: startSignificant || flipped ? smallerEventArm : null,
    verdict,
    interpretation,
  };
}

// ---------------------------------------------------------------------------
// 2. Meta-analytic robustness (leave-one-out) + required information size
// ---------------------------------------------------------------------------

// Total analysed sample size accrued across studies that carry raw arm totals.
// Studies given only as point+CI contribute no countable N here (honest: we do
// not fabricate a denominator we were not given).
function accruedSampleSize(studies: readonly FragilityStudyInput[]): number {
  return studies.reduce((sum, s) => {
    const n1 = typeof s.total1 === "number" ? s.total1 : 0;
    const n2 = typeof s.total2 === "number" ? s.total2 : 0;
    return sum + n1 + n2;
  }, 0);
}

// metaAnalyze consumes StudyEffectInput; our validated study is structurally a
// superset, so map it explicitly (no `any`, no mutation of the input).
function toStudyEffectInput(s: FragilityStudyInput): StudyEffectInput {
  return {
    label: s.label,
    measure: s.measure as RatioMeasure,
    point: s.point ?? null,
    ciLower: s.ciLower ?? null,
    ciUpper: s.ciUpper ?? null,
    ciPct: s.ciPct ?? null,
    events1: s.events1 ?? null,
    total1: s.total1 ?? null,
    events2: s.events2 ?? null,
    total2: s.total2 ?? null,
  };
}

/**
 * Leave-one-out robustness of a pooled verdict, reusing lib/metaAnalysis.ts.
 * Pools all studies (random-effects verdict), then re-pools with each single
 * study removed. If any single deletion flips the pooled significance, the
 * verdict is not robust and we name the pivotal study.
 */
export function metaRobustness(studies: readonly FragilityStudyInput[]): RobustnessResult {
  const inputs = studies.map(toStudyEffectInput);
  const full = metaAnalyze(inputs);

  if (!full) {
    return {
      pooledSignificant: false,
      survivesLeaveOneOut: false,
      flippingStudy: null,
      k: 0,
      note:
        "Fewer than two studies could be pooled (mismatched measure, missing point+CI, or degenerate " +
        "variance), so no pooled verdict exists to test for robustness.",
    };
  }

  const pooledSignificant = full.random.significant;

  // With only two poolable studies, dropping one leaves a single study — there
  // is no pooled verdict to compare, so LOO is undefined. Report honestly.
  if (full.k < 3) {
    return {
      pooledSignificant,
      survivesLeaveOneOut: pooledSignificant, // vacuously: nothing to flip it
      flippingStudy: null,
      k: full.k,
      note:
        `Only ${full.k} studies were pooled; leave-one-out deletion would leave a single study, so a ` +
        `pooled robustness check is undefined. The pooled random-effects verdict is ` +
        `${pooledSignificant ? "significant" : "not significant"} on these two studies.`,
    };
  }

  let flippingStudy: string | null = null;
  for (let i = 0; i < inputs.length; i++) {
    const subset = inputs.filter((_, idx) => idx !== i);
    const looped = metaAnalyze(subset);
    if (!looped) continue; // deletion made the set unpoolable; skip (can't flip a null)
    if (looped.random.significant !== pooledSignificant) {
      flippingStudy = inputs[i].label;
      break;
    }
  }

  const survives = flippingStudy === null;
  const note = survives
    ? `The pooled random-effects verdict (${pooledSignificant ? "significant" : "not significant"}) ` +
      `survives leave-one-out: removing any single study of ${full.k} does not change it — a robust ` +
      `pooled conclusion.`
    : `The pooled verdict is FRAGILE: removing "${flippingStudy}" alone flips the random-effects ` +
      `significance. The conclusion hinges on one study and should not be treated as settled.`;

  return {
    pooledSignificant,
    survivesLeaveOneOut: survives,
    flippingStudy,
    k: full.k,
    note,
  };
}

/**
 * Whether the pooled evidence has accrued enough information to be conclusive,
 * reusing lib/trialSequential.ts requiredInformationSize. Compares the total
 * analysed sample size across studies against the RIS a definitive trial would
 * need for the anticipated effect.
 */
export function informationSizeMet(
  studies: readonly FragilityStudyInput[],
  params: InformationSizeParamsInput
): InformationSizeResult {
  const accruedN = accruedSampleSize(studies);
  const ris = requiredInformationSize(params);
  const requiredN = ris.risTotal;
  const met = accruedN >= requiredN;
  const informationFraction = requiredN > 0 ? Math.min(accruedN / requiredN, 1) : 0;

  const note = met
    ? `Accrued sample size (${accruedN}) meets the required information size (${requiredN}) for the ` +
      `anticipated effect — enough information has accrued for the pooled verdict to be considered ` +
      `conclusive on information grounds.`
    : accruedN === 0
      ? `No raw arm totals were supplied, so accrued sample size cannot be counted; the required ` +
        `information size is ${requiredN}. Provide events/totals per arm to assess information adequacy.`
      : `Accrued sample size (${accruedN}) is below the required information size (${requiredN}) ` +
        `(${(informationFraction * 100).toFixed(1)}% accrued) — the pooled verdict rests on insufficient ` +
        `information and one more study could still change it.`;

  return { informationSizeMet: met, accruedN, requiredN, informationFraction, note };
}

// ---------------------------------------------------------------------------
// Top-level analyzers used by the public route
// ---------------------------------------------------------------------------

export function analyzeTableFragility(table: TwoByTwo): FragilityTableResult {
  const detail = fragilityIndex(table);
  return {
    kind: "table",
    fragilityIndex: detail.fragilityIndex,
    interpretation: detail.interpretation,
    verdict: detail.verdict,
    detail,
  };
}

export function analyzeMetaFragility(
  studies: readonly FragilityStudyInput[],
  params?: InformationSizeParamsInput
): FragilityMetaResult {
  const robustness = metaRobustness(studies);
  const infoSize = params ? informationSizeMet(studies, params) : null;

  const verdict: FragilityVerdict = !robustness.pooledSignificant
    ? "not_significant"
    : robustness.survivesLeaveOneOut
      ? robustness.k >= 3
        ? "robust"
        : "moderate"
      : "fragile";

  const parts = [robustness.note];
  if (infoSize) parts.push(infoSize.note);
  const interpretation = parts.join(" ");

  return {
    kind: "meta",
    fragilityIndex: null,
    interpretation,
    verdict,
    informationSizeMet: infoSize ? infoSize.informationSizeMet : null,
    robustness,
    informationSize: infoSize,
  };
}

/**
 * Single dispatch entry point for the public route. Validated request in,
 * deterministic fragility result out. No LLM, no I/O, no mutation.
 */
export function analyzeFragility(request: FragilityRequest): FragilityResult {
  if (request.mode === "table") {
    const { a, b, c, d } = request;
    return analyzeTableFragility({ a, b, c, d });
  }
  return analyzeMetaFragility(request.studies, request.informationSize);
}
