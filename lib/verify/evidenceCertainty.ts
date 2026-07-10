// OPTIONAL, ADDITIVE enrichment for /api/verify: when the verify flow has MULTIPLE
// confident cross-source registered results (each trial's OWN sponsor-reported
// primary ratio estimate from ClinicalTrials.gov), pool them via the deterministic
// meta-analysis engine and rate the resulting body of evidence with GRADE — the
// same k / I² / pooled-CI / crosses-null mapping lib/evidenceReport.ts uses.
//
// This is a READ-ONLY summariser over already-cached registered results. NO LLM in
// the numeric loop, no mutation of inputs, no network. It intentionally pools ONLY
// registered ratio primaries (ground truth we can defend), never the LLM findings.
// Returns null whenever there are fewer than two poolable sources so the caller can
// omit the field silently.

import { metaAnalyze, type StudyEffectInput, type RatioMeasure } from "../metaAnalysis";
import { gradeCertainty, type GradeResult } from "../grade";
import type { TrialResultAnalysis } from "../sources/clinicaltrials";

// A source as seen by /api/verify: enough to identify it and read its registered
// results. Kept structural so we don't couple to the route's internal row type.
export interface PoolableSource {
  source_type: string;
  external_id?: string | null;
  title?: string | null;
  registered_results?: unknown;
}

export interface EvidenceCertainty {
  /** GRADE certainty of the pooled body of registered primary results. */
  certainty: GradeResult["certainty"];
  /** Number of sources whose registered primary ratio result was poolable. */
  pooledSourceCount: number;
  pooled: {
    measure: RatioMeasure;
    point: number;
    ciLower: number;
    ciUpper: number;
    reductionPercent: number;
    significant: boolean;
    iSquared: number;
  };
  grade: GradeResult;
  /** Labels of the sources that contributed a poolable primary estimate. */
  contributingSources: string[];
  rationale: string;
}

// Map ClinicalTrials.gov's free-text paramType ("Hazard Ratio (HR)", "Odds Ratio
// (OR)", "Risk Ratio (RR)", "Relative Risk"...) to the meta-analysis engine's
// ratio-measure enum. Returns null for anything not a poolable ratio.
function toRatioMeasure(paramType: string | null | undefined): RatioMeasure | null {
  if (!paramType) return null;
  const p = paramType.toLowerCase();
  if (p.includes("hazard ratio") || /\bhr\b/.test(p)) return "HR";
  if (p.includes("odds ratio") || /\bor\b/.test(p)) return "OR";
  if (
    p.includes("risk ratio") ||
    p.includes("rate ratio") ||
    p.includes("relative risk") ||
    /\brr\b/.test(p)
  ) {
    return "RR";
  }
  return null;
}

// Pick the source's most defensible registered analysis: a PRIMARY ratio outcome
// with a point estimate and a full confidence interval, falling back to any ratio
// primary analysis with a CI. Returns null when none is poolable.
function primaryRatioAnalysis(
  analyses: TrialResultAnalysis[]
): { measure: RatioMeasure; point: number; ciLower: number; ciUpper: number } | null {
  const usable = analyses.filter(
    (a) =>
      a.paramValue !== null &&
      a.paramValue > 0 &&
      a.ciLower !== null &&
      a.ciLower > 0 &&
      a.ciUpper !== null &&
      a.ciUpper > 0 &&
      toRatioMeasure(a.paramType) !== null
  );
  if (usable.length === 0) return null;

  const chosen =
    usable.find((a) => a.outcomeType === "PRIMARY") ?? usable[0];
  const measure = toRatioMeasure(chosen.paramType);
  if (measure === null) return null;

  return {
    measure,
    point: chosen.paramValue as number,
    ciLower: chosen.ciLower as number,
    ciUpper: chosen.ciUpper as number,
  };
}

function isTrialResultAnalysisArray(v: unknown): v is TrialResultAnalysis[] {
  return Array.isArray(v);
}

/**
 * Build the optional evidence-certainty enrichment from a set of verify sources.
 *
 * Pools each source's registered PRIMARY ratio estimate (point + CI) via
 * metaAnalyze, then rates the pooled body of evidence with gradeCertainty. Returns
 * null (so the caller omits the field) whenever fewer than two sources contribute a
 * poolable registered primary — an honest "not enough to synthesise" rather than a
 * forced low-confidence rating. Pure and side-effect-free; never mutates inputs.
 */
export function buildEvidenceCertainty(
  sources: readonly PoolableSource[]
): EvidenceCertainty | null {
  const inputs: StudyEffectInput[] = [];
  const contributingSources: string[] = [];

  for (const s of sources) {
    if (s.source_type !== "clinicaltrials") continue;
    if (!isTrialResultAnalysisArray(s.registered_results)) continue;

    const primary = primaryRatioAnalysis(s.registered_results);
    if (!primary) continue;

    const label = s.title || s.external_id || `Source ${inputs.length + 1}`;
    inputs.push({
      label,
      measure: primary.measure,
      point: primary.point,
      ciLower: primary.ciLower,
      ciUpper: primary.ciUpper,
      ciPct: 95,
    });
    contributingSources.push(label);
  }

  // Fewer than two poolable sources: nothing to synthesise — omit the field.
  if (inputs.length < 2) return null;

  const pooled = metaAnalyze(inputs);
  if (!pooled) return null;

  // Same GRADE mapping lib/evidenceReport.ts derives from the pooled random-effects
  // result: k, I², pooled point + CI, and whether the CI crosses the null. The
  // judgement domains (risk of bias, indirectness, publication bias) are not
  // declared here, so GRADE takes them as zero — this is a numeric-only rating.
  const grade = gradeCertainty({
    k: pooled.k,
    iSquared: pooled.heterogeneity.iSquared,
    point: pooled.random.point,
    ciLower: pooled.random.ciLower,
    ciUpper: pooled.random.ciUpper,
    ciCrossesNull: !pooled.random.significant,
    totalN: null,
  });

  const r = pooled.random;
  const rationale =
    `Pooled ${pooled.k} sources' registered primary ${pooled.measure} results: ` +
    `${r.point} (95% CI ${r.ciLower}–${r.ciUpper}), about a ${Math.round(r.reductionPercent)}% ` +
    `reduction, I²=${Math.round(pooled.heterogeneity.iSquared)}% heterogeneity. ` +
    `GRADE certainty of this pooled body of evidence: ${grade.certainty}.`;

  return {
    certainty: grade.certainty,
    pooledSourceCount: pooled.k,
    pooled: {
      measure: pooled.measure,
      point: r.point,
      ciLower: r.ciLower,
      ciUpper: r.ciUpper,
      reductionPercent: r.reductionPercent,
      significant: r.significant,
      iSquared: pooled.heterogeneity.iSquared,
    },
    grade,
    contributingSources,
    rationale,
  };
}
