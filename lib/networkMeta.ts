// Deterministic NETWORK / INDIRECT META-ANALYSIS via the Bucher method.
//
// When no head-to-head trial of A vs C exists, you can still estimate the A-vs-C
// effect INDIRECTLY through a common comparator B: given pooled contrasts for
// A-vs-B and B-vs-C, the classic indirect treatment comparison (Bucher 1997) is
//
//   logEffect(A vs C) = logEffect(A vs B) + logEffect(B vs C)
//   Var(A vs C)       = Var(A vs B) + Var(B vs C)
//
// on the natural-log scale (RR / HR / OR). This is the exact closed form used by
// netmeta / the Cochrane indirect-comparison methods — no LLM anywhere in the
// numeric loop, every number reproducible from the two input contrasts.
//
// The direction convention matters: both contrasts must share the common
// comparator B in the SAME role. `bucherIndirect(ab, bc)` treats `ab` as the log
// effect of A relative to B and `bc` as the log effect of B relative to C, so the
// two logs add directly to give A relative to C. If your data is A-vs-B and
// C-vs-B (B as the second arm in both), negate the second contrast's logEffect
// before passing it in (Var is unchanged by sign).
//
// When BOTH a direct A-vs-C trial and this indirect estimate exist,
// `combineDirectIndirect` inverse-variance combines them AND runs a Bucher
// INCOHERENCE (inconsistency) test — the z-test for whether direct and indirect
// disagree by more than chance. A significant incoherence is a red flag that the
// network's transitivity assumption is violated and the combined number should
// not be trusted.
//
// Pure and immutable: no function here mutates its inputs.

import { z } from "zod";
import { ciZ, studentTCdf } from "./stats/distributions";
import { metaAnalyze, type StudyEffectInput } from "./metaAnalysis";

// A pooled contrast on the natural-log scale: the log effect and its variance.
// This is the unit the Bucher method operates on — produced either directly by a
// caller (from a published pooled log-HR + SE) or by `poolContrastFromStudies`.
export interface Contrast {
  logEffect: number; // e.g. ln(HR)
  variance: number; // Var(logEffect) = SE^2
}

export interface IndirectEstimate {
  logEffect: number; // log-scale indirect A-vs-C effect
  variance: number; // Var on the log scale
  se: number; // sqrt(variance)
  point: number; // exp(logEffect) — ratio scale
  ciLower: number; // 95% CI lower (ratio scale)
  ciUpper: number; // 95% CI upper (ratio scale)
  significant: boolean; // 95% CI excludes the null of 1
}

export interface Incoherence {
  incoherenceZ: number; // (logDirect - logIndirect) / sqrt(sum of variances)
  pValue: number; // two-sided p for the incoherence z
  inconsistent: boolean; // p < 0.05 → direct & indirect disagree beyond chance
}

export interface CombinedEstimate {
  logEffect: number; // inverse-variance combined log effect
  variance: number;
  se: number;
  point: number;
  ciLower: number;
  ciUpper: number;
  significant: boolean;
  incoherence: Incoherence;
}

const CI_PCT = 95;
const INCOHERENCE_ALPHA = 0.05;

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function isFiniteContrast(c: Contrast): boolean {
  return (
    Number.isFinite(c.logEffect) && Number.isFinite(c.variance) && c.variance > 0
  );
}

// Build a ratio-scale estimate (point + CI + significance) from a log effect and
// its variance. Shared by the indirect and combined estimates so both use the
// exact same z-based interval the rest of the engine (metaAnalyze) uses.
function ratioEstimate(logEffect: number, variance: number): {
  se: number;
  point: number;
  ciLower: number;
  ciUpper: number;
  significant: boolean;
} {
  const se = Math.sqrt(variance);
  const z = ciZ(CI_PCT);
  const point = Math.exp(logEffect);
  const ciLower = Math.exp(logEffect - z * se);
  const ciUpper = Math.exp(logEffect + z * se);
  return {
    se: round(se, 6),
    point: round(point, 4),
    ciLower: round(ciLower, 4),
    ciUpper: round(ciUpper, 4),
    significant: ciUpper < 1 || ciLower > 1,
  };
}

/**
 * Bucher indirect comparison. Given the pooled A-vs-B contrast `ab` and the
 * pooled B-vs-C contrast `bc` (both on the natural-log scale, B in the common
 * comparator role such that the logs add), returns the indirect A-vs-C estimate:
 *
 *   logAC = logAB + logBC ,  Var(AC) = Var(AB) + Var(BC)
 *
 * back-transformed to the ratio scale with a 95% CI. Throws on non-finite or
 * non-positive-variance inputs — the caller must supply real pooled contrasts.
 * Pure: does not mutate `ab` or `bc`.
 */
export function bucherIndirect(ab: Contrast, bc: Contrast): IndirectEstimate {
  if (!isFiniteContrast(ab) || !isFiniteContrast(bc)) {
    throw new Error(
      "bucherIndirect requires finite logEffect and positive variance for both contrasts."
    );
  }
  const logEffect = ab.logEffect + bc.logEffect;
  const variance = ab.variance + bc.variance;
  const est = ratioEstimate(logEffect, variance);
  return {
    logEffect: round(logEffect, 6),
    variance: round(variance, 6),
    ...est,
  };
}

/**
 * Inverse-variance combine a DIRECT A-vs-C estimate with an INDIRECT one (both
 * log-scale contrasts) into a single mixed estimate, and run the Bucher
 * incoherence (inconsistency) test:
 *
 *   z = (logDirect - logIndirect) / sqrt(Var(direct) + Var(indirect))
 *
 * with a two-sided normal p-value (studentTCdf at large df is effectively the
 * normal). A significant incoherence (p < 0.05) flags that direct and indirect
 * evidence disagree beyond chance — the combined estimate is then suspect.
 * Throws on invalid contrasts. Pure: does not mutate its inputs.
 */
export function combineDirectIndirect(
  direct: Contrast,
  indirect: Contrast
): CombinedEstimate {
  if (!isFiniteContrast(direct) || !isFiniteContrast(indirect)) {
    throw new Error(
      "combineDirectIndirect requires finite logEffect and positive variance for both estimates."
    );
  }

  // Inverse-variance weighted combination of the two log effects.
  const wDirect = 1 / direct.variance;
  const wIndirect = 1 / indirect.variance;
  const sumW = wDirect + wIndirect;
  const logEffect = (wDirect * direct.logEffect + wIndirect * indirect.logEffect) / sumW;
  const variance = 1 / sumW;

  // Bucher incoherence z: difference between direct and indirect log effects,
  // standardized by the SE of that difference (variances add, both independent).
  const diff = direct.logEffect - indirect.logEffect;
  const seDiff = Math.sqrt(direct.variance + indirect.variance);
  const incoherenceZ = diff / seDiff;

  // Two-sided p via the Student-t CDF at large df (≈ standard normal). studentTCdf
  // is monotone; the two-sided tail is 2 * P(T <= -|z|).
  const pValue = 2 * studentTCdf(-Math.abs(incoherenceZ), 1e6);

  const est = ratioEstimate(logEffect, variance);
  return {
    logEffect: round(logEffect, 6),
    variance: round(variance, 6),
    ...est,
    incoherence: {
      incoherenceZ: round(incoherenceZ, 4),
      pValue: round(pValue, 4),
      inconsistent: pValue < INCOHERENCE_ALPHA,
    },
  };
}

/**
 * Pool a set of same-measure StudyEffectInput trials for ONE edge of the network
 * (e.g. every A-vs-B trial) into a single { logEffect, variance } contrast the
 * Bucher method can consume. Reuses `metaAnalyze` (random-effects) so the pooling
 * is identical to the rest of PaperTrail: logEffect = random.logPoint, variance =
 * random.se^2. Returns null when fewer than two usable studies pool (metaAnalyze
 * returns null), so the caller can fall back to a single published contrast.
 * Pure: does not mutate `studies`.
 */
export function poolContrastFromStudies(
  studies: readonly StudyEffectInput[]
): Contrast | null {
  const pooled = metaAnalyze(studies);
  if (!pooled) return null;
  const { logPoint, se } = pooled.random;
  return { logEffect: logPoint, variance: se * se };
}

// ---------------------------------------------------------------------------
// Boundary schema. A contrast is either supplied directly as { log_effect,
// variance } OR as a set of studies to pool (mirrors the evidence-report study
// shape). The API route validates the request against this before any math runs.
// ---------------------------------------------------------------------------
const StudyContrastSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    measure: z.enum(["RR", "HR", "OR"]),
    point: z.number().positive().optional(),
    ci_lower: z.number().positive().optional(),
    ci_upper: z.number().positive().optional(),
    ci_pct: z.number().min(50).max(99.9).optional(),
    events1: z.number().int().nonnegative().optional(),
    total1: z.number().int().positive().optional(),
    events2: z.number().int().nonnegative().optional(),
    total2: z.number().int().positive().optional(),
  })
  .refine(
    (s) =>
      (s.point !== undefined && s.ci_lower !== undefined && s.ci_upper !== undefined) ||
      (s.events1 !== undefined &&
        s.total1 !== undefined &&
        s.events2 !== undefined &&
        s.total2 !== undefined),
    { message: "Provide either point+ci_lower+ci_upper, or all four 2x2 counts." }
  );

// One network edge: either a pre-pooled log-scale contrast, or a set of studies
// to pool into one. Exactly one of the two forms must be provided.
const EdgeSchema = z
  .object({
    log_effect: z.number().finite().optional(),
    variance: z.number().positive().optional(),
    studies: z.array(StudyContrastSchema).min(1).max(100).optional(),
  })
  .refine(
    (e) =>
      (e.log_effect !== undefined && e.variance !== undefined) ||
      (e.studies !== undefined && e.studies.length > 0),
    { message: "Provide either log_effect+variance, or a non-empty studies array." }
  );

export const NetworkMetaRequestSchema = z.object({
  // The A-vs-B edge (common comparator B in the second role).
  ab: EdgeSchema,
  // The B-vs-C edge (common comparator B in the first role) — logs add to give A-vs-C.
  bc: EdgeSchema,
  // Optional direct A-vs-C edge; when present, the response combines direct +
  // indirect and reports the incoherence test.
  direct: EdgeSchema.optional(),
});
export type NetworkMetaRequest = z.infer<typeof NetworkMetaRequestSchema>;
export type EdgeInput = z.infer<typeof EdgeSchema>;

// Resolve one validated edge to a log-scale Contrast: use the supplied
// log_effect+variance directly, otherwise pool its studies. Returns a reason
// string instead when a studies-only edge fails to pool (< 2 usable), so the
// route can surface exactly which edge could not be built.
export function resolveEdge(
  edge: EdgeInput
): Contrast | { reason: string } {
  if (edge.log_effect !== undefined && edge.variance !== undefined) {
    return { logEffect: edge.log_effect, variance: edge.variance };
  }
  const studies = (edge.studies ?? []).map(toEngineInput);
  const pooled = poolContrastFromStudies(studies);
  if (!pooled) {
    return {
      reason:
        "This edge needs at least two poolable studies (each with a positive point + widening CI, or valid 2x2 counts), or a direct log_effect+variance.",
    };
  }
  return pooled;
}

// Map a validated request study to the meta-analysis engine's camelCase input.
function toEngineInput(study: z.infer<typeof StudyContrastSchema>): StudyEffectInput {
  return {
    label: study.label,
    measure: study.measure,
    point: study.point ?? null,
    ciLower: study.ci_lower ?? null,
    ciUpper: study.ci_upper ?? null,
    ciPct: study.ci_pct ?? null,
    events1: study.events1 ?? null,
    total1: study.total1 ?? null,
    events2: study.events2 ?? null,
    total2: study.total2 ?? null,
  };
}
