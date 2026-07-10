// Deterministic leave-one-out sensitivity analysis for random-effects
// meta-analysis. Re-pools the studies k times, each time DROPPING one study, and
// reports how far the summary estimate SWINGS when that study is removed — the
// standard influence diagnostic (metafor's `leave1out`). A single study whose
// removal materially moves the pooled effect is an influential/fragile point the
// verdict should not silently rest on.
//
// No LLM, no randomness, no mutation. Every number is reproducible from the
// inputs. The engine reuses lib/metaAnalysis.ts's pooling (so each leave-one-out
// re-pool is the identical DerSimonian–Laird random-effects computation the main
// engine uses) rather than re-deriving the closed forms here.

import { metaAnalyze, type StudyEffectInput, type RatioMeasure } from "./metaAnalysis";

// Fractional change in the pooled point estimate, on the log scale, above which a
// dropped study is flagged as INFLUENTIAL. 0.10 ≈ a 10% shift in the log effect
// on removal — the conventional "material influence" heuristic. Deterministic
// constant, not an LLM guess.
const INFLUENCE_LOG_SHIFT_THRESHOLD = 0.1;

// A study whose removal flips statistical significance (the 95% CI crosses the
// null in one configuration but not the other) is ALWAYS flagged, regardless of
// the magnitude of the point shift — significance-flipping is the most
// decision-relevant form of fragility.

export interface LeaveOneOutRow {
  droppedLabel: string; // the study removed in this re-pool
  k: number; // studies remaining in the re-pool
  point: number; // random-effects pooled point WITHOUT the dropped study (ratio)
  ciLower: number;
  ciUpper: number;
  logPoint: number; // pooled log effect without the study
  logShift: number; // logPoint(without) - logPoint(all): signed swing on log scale
  pointShift: number; // point(without) - point(all): signed swing on ratio scale
  significant: boolean; // 95% CI excludes the null WITHOUT this study
  flipsSignificance: boolean; // significance differs from the all-studies pool
  influential: boolean; // |logShift| >= threshold OR flipsSignificance
  iSquared: number; // heterogeneity without this study (%)
}

export interface SensitivityResult {
  measure: RatioMeasure;
  k: number; // studies in the full pool

  // The full-pool random-effects estimate every row is compared against.
  overallPoint: number;
  overallLogPoint: number;
  overallCiLower: number;
  overallCiUpper: number;
  overallSignificant: boolean;
  overallISquared: number;

  // One row per study, in input order (skipped studies excluded).
  leaveOneOut: LeaveOneOutRow[];

  // The largest |pointShift| across all rows and the study that produced it —
  // the single most influential study by point movement.
  maxSwing: number;
  maxSwingLabel: string | null;
  // The largest |logShift| across all rows (scale-free influence magnitude).
  maxLogSwing: number;

  // Labels of every study flagged influential (point shift and/or sig flip).
  influentialLabels: string[];
  // True when ANY single study's removal flips statistical significance —
  // the headline fragility signal.
  anyFlipsSignificance: boolean;

  // Studies dropped during standardization, forwarded from the pooling engine.
  skipped: { label: string; reason: string }[];
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Leave-one-out sensitivity analysis over a set of ratio-measure studies.
 *
 * Pools all usable studies once (the reference), then re-pools k times dropping
 * each usable study in turn, recording for each the resulting random-effects
 * point/CI, the SWING relative to the full pool, whether removal flips
 * significance, and an influence flag. Reports the maximum swing and its study,
 * plus the set of influential studies.
 *
 * Requires at least three usable studies (so each leave-one-out pool still has
 * two — the minimum for a meta-analysis); returns null otherwise, honestly
 * signalling that a sensitivity analysis cannot be run rather than forcing one.
 * Pure: does not mutate its inputs.
 *
 * @param inputs Ratio-measure studies (point+CI or 2x2 counts), same contract
 *               as lib/metaAnalysis.ts.
 */
export function leaveOneOutSensitivity(
  inputs: readonly StudyEffectInput[]
): SensitivityResult | null {
  // Pool the full set first: this standardizes studies, drops the unusable ones
  // into `skipped`, and gives the reference estimate every row compares to.
  const full = metaAnalyze(inputs);
  if (full === null) return null;

  // Each leave-one-out re-pool must retain >= 2 studies to be a meta-analysis,
  // so we need >= 3 usable studies in the full pool.
  if (full.k < 3) return null;

  // The usable studies, in the exact form the engine standardized them. We
  // re-pool from their (label, measure, yi/vi-derived) point+CI so every
  // leave-one-out run uses identical numeric inputs to the full pool.
  const usable = full.studies;
  const measure = full.measure;

  const overallLogPoint = full.random.logPoint;
  const overallPoint = full.random.point;

  const rows: LeaveOneOutRow[] = [];
  let maxSwing = 0;
  let maxSwingLabel: string | null = null;
  let maxLogSwing = 0;
  const influentialLabels: string[] = [];
  let anyFlipsSignificance = false;

  for (let drop = 0; drop < usable.length; drop++) {
    // Rebuild the leave-one-out input set from the standardized studies. Each
    // carries its own measure + point + CI (95%), which metaAnalyze re-derives
    // to the identical yi/vi — so this is a faithful re-pool, not a new
    // standardization path.
    const subset: StudyEffectInput[] = usable
      .filter((_, i) => i !== drop)
      .map((s) => ({
        label: s.label,
        measure: s.measure,
        point: s.point,
        ciLower: s.ciLower,
        ciUpper: s.ciUpper,
        ciPct: 95,
      }));

    const reduced = metaAnalyze(subset);
    // Defensive: with >= 2 studies remaining this is non-null, but never assert.
    if (reduced === null) continue;

    const logShift = reduced.random.logPoint - overallLogPoint;
    const pointShift = reduced.random.point - overallPoint;
    const flipsSignificance = reduced.random.significant !== full.random.significant;
    const influential =
      Math.abs(logShift) >= INFLUENCE_LOG_SHIFT_THRESHOLD || flipsSignificance;

    if (Math.abs(pointShift) > Math.abs(maxSwing)) {
      maxSwing = pointShift;
      maxSwingLabel = usable[drop].label;
    }
    if (Math.abs(logShift) > Math.abs(maxLogSwing)) {
      maxLogSwing = logShift;
    }
    if (flipsSignificance) anyFlipsSignificance = true;
    if (influential) influentialLabels.push(usable[drop].label);

    rows.push({
      droppedLabel: usable[drop].label,
      k: reduced.k,
      point: reduced.random.point,
      ciLower: reduced.random.ciLower,
      ciUpper: reduced.random.ciUpper,
      logPoint: reduced.random.logPoint,
      logShift: round(logShift, 6),
      pointShift: round(pointShift, 4),
      significant: reduced.random.significant,
      flipsSignificance,
      influential,
      iSquared: reduced.heterogeneity.iSquared,
    });
  }

  return {
    measure,
    k: full.k,
    overallPoint,
    overallLogPoint,
    overallCiLower: full.random.ciLower,
    overallCiUpper: full.random.ciUpper,
    overallSignificant: full.random.significant,
    overallISquared: full.heterogeneity.iSquared,
    leaveOneOut: rows,
    maxSwing: round(Math.abs(maxSwing), 4),
    maxSwingLabel,
    maxLogSwing: round(Math.abs(maxLogSwing), 6),
    influentialLabels,
    anyFlipsSignificance,
    skipped: full.skipped,
  };
}
