// Deterministic CUMULATIVE meta-analysis for living evidence.
//
// A one-shot meta-analysis answers "what does the pooled evidence say TODAY". A
// living monitor needs the *trajectory*: re-pool the evidence as each study lands
// in time order, so we can answer questions a static pool cannot —
//   - when did the pooled effect first reach significance?
//   - does the newest study FLIP the pooled direction or significance?
//   - is the effect still moving, or has it settled?
//
// This is the exact "cumulative forest plot" that RevMan / metafor's cumul() draws.
// It is built strictly ON TOP of lib/metaAnalysis.ts metaAnalyze (which is NOT
// edited): for each prefix of the time-ordered studies with >= 2 usable members we
// call metaAnalyze and record the running pooled random-effects estimate. NO LLM is
// in this loop — every number is reproducible from the inputs.

import {
  metaAnalyze,
  type StudyEffectInput,
  type PooledEstimate,
} from "@/lib/metaAnalysis";

// A study with the year it landed, so we can order the accrual deterministically.
export interface DatedStudyInput extends StudyEffectInput {
  // Year (or ordinal) the study became available. Ties break by input order,
  // which is stable, so the cumulative sequence is fully deterministic.
  year: number;
}

// The pooled state after the k-th study was added.
export interface CumulativeStep {
  order: number; // 1-based position in the accrual
  addedLabel: string; // label of the study added at this step
  year: number;
  k: number; // number of usable studies pooled so far
  pooled: PooledEstimate | null; // running random-effects estimate (null until k>=2)
  significant: boolean; // 95% CI excludes the null (false when pooled is null)
  direction: EffectDirection; // sign of the pooled effect relative to null=1
  // Did THIS study change the picture versus the previous step?
  flippedDirection: boolean;
  flippedSignificance: boolean;
}

export type EffectDirection = "protective" | "harmful" | "null";

export interface CumulativeMetaResult {
  // Steps for every study in accrual order (including ones that could not be
  // pooled yet — their `pooled` is null so the timeline stays complete).
  steps: CumulativeStep[];
  // 1-based order at which the pooled effect FIRST became significant, or null if
  // it never did across the accrual.
  firstSignificantAtOrder: number | null;
  // The final pooled estimate (last step with k>=2), or null if never poolable.
  finalPooled: PooledEstimate | null;
  finalDirection: EffectDirection;
  finalSignificant: boolean;
  usableCount: number; // total studies that ever contributed to a pool
  skippedCount: number; // studies dropped by metaAnalyze at the final pool
}

// Classify a pooled ratio estimate's direction against the null of 1. A protective
// effect is a ratio < 1 (fewer events on treatment); harmful is > 1.
export function directionOf(pooled: PooledEstimate | null): EffectDirection {
  if (!pooled) return "null";
  if (pooled.point < 1) return "protective";
  if (pooled.point > 1) return "harmful";
  return "null";
}

// Order studies by year ascending, ties broken by their original index so the
// sequence is deterministic. Pure: does not mutate the input array.
function orderByAccrual(studies: readonly DatedStudyInput[]): DatedStudyInput[] {
  return studies
    .map((s, index) => ({ s, index }))
    .sort((a, b) => (a.s.year - b.s.year) || (a.index - b.index))
    .map((x) => x.s);
}

/**
 * Build the cumulative meta-analysis trajectory. Studies are pooled in time order;
 * each step re-runs metaAnalyze over the prefix accrued so far and records the
 * running pooled random-effects estimate, whether significance has been reached,
 * and whether the newly added study flipped the pooled direction or significance.
 *
 * Deterministic and pure — reuses metaAnalyze (never edits it). Returns a result
 * whose `steps` always covers every input study in accrual order, even studies
 * that arrive before a poolable body (k<2) exists.
 */
export function cumulativeMetaAnalysis(
  studies: readonly DatedStudyInput[]
): CumulativeMetaResult {
  const ordered = orderByAccrual(studies);
  const steps: CumulativeStep[] = [];

  let prevDirection: EffectDirection = "null";
  let prevSignificant = false;
  let firstSignificantAtOrder: number | null = null;
  let finalPooled: PooledEstimate | null = null;

  for (let i = 0; i < ordered.length; i++) {
    const prefix = ordered.slice(0, i + 1);
    const result = metaAnalyze(prefix);

    const pooled = result?.random ?? null;
    const k = result?.k ?? 0;
    const significant = pooled ? pooled.significant : false;
    const direction = directionOf(pooled);

    // A flip is only meaningful once a pool exists on BOTH sides of the step.
    const hadPool = prevDirection !== "null" || prevSignificant;
    const flippedDirection =
      pooled !== null && hadPool && direction !== prevDirection && direction !== "null";
    const flippedSignificance =
      pooled !== null && hadPool && significant !== prevSignificant;

    if (significant && firstSignificantAtOrder === null) {
      firstSignificantAtOrder = i + 1;
    }
    if (pooled) {
      finalPooled = pooled;
    }

    steps.push({
      order: i + 1,
      addedLabel: ordered[i].label,
      year: ordered[i].year,
      k,
      pooled,
      significant,
      direction,
      flippedDirection,
      flippedSignificance,
    });

    // Only advance the "previous" baseline once a real pool exists, so the first
    // poolable step is never spuriously counted as a flip.
    if (pooled) {
      prevDirection = direction;
      prevSignificant = significant;
    }
  }

  const finalMeta = metaAnalyze(ordered);

  return {
    steps,
    firstSignificantAtOrder,
    finalPooled,
    finalDirection: directionOf(finalPooled),
    finalSignificant: finalPooled ? finalPooled.significant : false,
    usableCount: finalMeta?.k ?? 0,
    skippedCount: finalMeta?.skipped.length ?? 0,
  };
}
