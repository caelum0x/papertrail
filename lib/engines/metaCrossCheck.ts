// Production oracle: cross-check PaperTrail's in-process TS meta-analysis engine
// (lib/metaAnalysis.ts) against the independent PyMARE reference implementation
// (lib/engines/pymare.ts, a direct subprocess to python/pymare/run.py).
//
// Both engines pool the SAME study-level log effects (yi) and variances (vi) —
// the exact standardized numbers our TS engine derived — so any divergence in the
// random-effects pooled estimate is a real bug in one side, not a difference of
// inputs. This is the strongest possible check on the numeric core: a second,
// battle-tested (MIT, neurostuff) implementation of the same closed forms.
//
// PyMARE is OFF by default (opt-in via PYMARE_ENABLED, needs Python). This module
// NEVER changes the TS result and NEVER throws: when PyMARE is disabled or its
// subprocess rejects for any reason, the reference is simply null and the caller
// keeps our TS oracle result unchanged. Purely numeric — logs nothing itself.

import { metaAnalyze, type MetaAnalysisResult, type StudyEffectInput } from "../metaAnalysis";
import { isPyMareEnabled, pooledPyMARE, type PyMareResult } from "./pymare";

// Absolute tolerance on the log-scale random-effects estimate. The two engines
// implement the same inverse-variance + DerSimonian–Laird closed forms, so they
// should agree to well within floating-point noise; this leaves headroom for the
// Python<->JSON round-trip without masking a genuine formula divergence.
const AGREEMENT_TOLERANCE = 1e-6;

export interface MetaCrossCheckResult {
  // Our deterministic TS meta-analysis (null when fewer than two usable studies).
  ours: MetaAnalysisResult | null;
  // The independent PyMARE reference result, or null when PyMARE is disabled,
  // rejected, or our own engine produced nothing to cross-check.
  reference: PyMareResult | null;
  // True when both engines' random-effects estimates match within tolerance;
  // false when they diverge; null when there is no reference to compare against.
  agree: boolean | null;
  // Absolute difference between the two random-effects log-scale estimates; null
  // when there is no reference to compare against.
  maxAbsDiff: number | null;
}

/**
 * Run our TS meta-analysis and, when PyMARE is enabled, an independent PyMARE
 * cross-check over the identical yi/vi, then compare the random-effects estimate.
 *
 * Never throws: a PyMARE rejection (disabled, missing Python, timeout, bad shape)
 * degrades gracefully to { ours, reference: null, agree: null, maxAbsDiff: null }.
 * Pure with respect to `studies` — does not mutate the caller's inputs.
 */
export async function crossCheckMeta(
  studies: readonly StudyEffectInput[],
): Promise<MetaCrossCheckResult> {
  const ours = metaAnalyze(studies);

  // Nothing to cross-check: our engine dropped below two usable studies, or the
  // reference is switched off. Keep the TS result exactly as-is.
  if (ours === null || !isPyMareEnabled()) {
    return { ours, reference: null, agree: null, maxAbsDiff: null };
  }

  // Pool the SAME standardized log effects our engine pooled — not the raw
  // caller inputs — so the two engines share identical numeric inputs and any
  // divergence is attributable to the pooling math, not to standardization.
  const yi = ours.studies.map((s) => s.yi);
  const vi = ours.studies.map((s) => s.vi);

  try {
    const reference = await pooledPyMARE({ yi, vi });
    // Compare on the log scale, where both engines compute the estimate. Our TS
    // random-effects estimate lives in `random.logPoint`; PyMARE reports the same
    // quantity as `random.estimate`.
    const maxAbsDiff = Math.abs(ours.random.logPoint - reference.random.estimate);
    return {
      ours,
      reference,
      agree: maxAbsDiff <= AGREEMENT_TOLERANCE,
      maxAbsDiff,
    };
  } catch {
    // ANY rejection (disabled at runtime, subprocess error, timeout, unexpected
    // shape) falls back to the TS-only result. The bridge never leaks input
    // values in its errors, and we deliberately do not surface the error here.
    return { ours, reference: null, agree: null, maxAbsDiff: null };
  }
}
