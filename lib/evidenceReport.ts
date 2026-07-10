// Composite EVIDENCE REPORT — the headline capability that chains PaperTrail's
// deterministic biostatistics engines into ONE defensible object. Given a claim
// and a set of trial effect estimates, it runs, in order:
//
//   1. meta-analysis          (lib/metaAnalysis.ts)     — pool fixed + random effects
//   2. publication-bias       (lib/publicationBias.ts)  — Egger's small-study test
//   3. GRADE certainty        (lib/grade.ts)            — rate the body of evidence
//   4. synthesis verdict      (lib/synthesisVerification.ts) — claim vs the pool
//
// and returns a single object a reviewer can defend line by line. Pure
// orchestration: NO LLM anywhere in the numeric loop. Every number traces back to
// the inputs through the engines above; this file only wires them together and
// derives one GRADE input from the pooled result. It never mutates its inputs.

import { z } from "zod";
import {
  metaAnalyze,
  type MetaAnalysisResult,
  type StudyEffectInput,
} from "./metaAnalysis";
import {
  eggersTest,
  interpret,
  type EggersTestResult,
  type BiasVerdict,
  type StudyEffect as BiasStudyEffect,
} from "./publicationBias";
import { gradeCertainty, type GradeResult } from "./grade";
import { absoluteFromRelative, type AbsoluteEffect } from "./absoluteEffects";
import {
  verifyAgainstSynthesis,
  type SynthesisCheck,
  type SynthesisSource,
} from "./synthesisVerification";
import { claimedReductionPercent } from "./effectSize";

// ---------------------------------------------------------------------------
// Request schema. One study is either a point + CI on the ratio scale, or raw
// 2x2 counts (validated further by the meta-analysis engine). Mirrors the shape
// SynthesisRequest uses so the two endpoints accept identical study payloads.
// ---------------------------------------------------------------------------
export const EvidenceReportStudySchema = z
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
export type EvidenceReportStudy = z.infer<typeof EvidenceReportStudySchema>;

export const EvidenceReportRequestSchema = z.object({
  claim: z.string().trim().min(10).max(2000),
  studies: z.array(EvidenceReportStudySchema).min(1).max(100),
  // Optional caller-supplied GRADE judgement downgrades (study-level appraisal a
  // numeric layer cannot invent). Publication-bias steps are derived from Egger's
  // test, so that domain is NOT accepted here — it is computed, not declared.
  risk_of_bias_steps: z.number().int().min(0).max(2).optional(),
  indirectness_steps: z.number().int().min(0).max(2).optional(),
  // Optional assumed control-arm (baseline) risk, strictly inside (0, 1). When
  // supplied, the report additionally translates the pooled random-effects
  // relative estimate into absolute effects (ARR / NNT / events-per-1000).
  baselineRisk: z.number().gt(0).lt(1).optional(),
});
export type EvidenceReportRequest = z.infer<typeof EvidenceReportRequestSchema>;

// ---------------------------------------------------------------------------
// Result shape. A single defensible object: pooled numbers, the publication-bias
// test + its verdict, the GRADE certainty rating, the claim-vs-pool verdict, the
// claim's own parsed magnitude, and a plain-language rationale tying it together.
// ---------------------------------------------------------------------------
export interface PublicationBiasReport {
  test: EggersTestResult | null;
  verdict: BiasVerdict;
  note: string;
}

export interface EvidenceReportVerdict {
  verdict: SynthesisCheck["verdict"];
  rationale: string;
  claimedReductionPercent: number | null;
  pooledReductionPercent: number | null;
  measure: SynthesisCheck["measure"];
}

export interface EvidenceReport {
  ok: true;
  claim: string;
  pooled: MetaAnalysisResult;
  publicationBias: PublicationBiasReport;
  certainty: GradeResult;
  verdict: EvidenceReportVerdict;
  claimedReductionPercent: number | null;
  rationale: string;
  // Additive: present only when a baselineRisk in (0, 1) was supplied and the
  // pooled random-effects estimate yields a valid absolute translation.
  absoluteEffects?: AbsoluteEffect;
}

// When we cannot pool (< 2 usable studies), we return an honest "insufficient"
// report rather than forcing a low-confidence answer — the house rule: a wrong
// "confident" answer is worse than an honest "couldn't verify".
export interface InsufficientEvidenceReport {
  ok: false;
  claim: string;
  reason: string;
  claimedReductionPercent: number | null;
  usableStudies: number;
  skipped: { label: string; reason: string }[];
}

export type BuildEvidenceReportResult = EvidenceReport | InsufficientEvidenceReport;

function round(n: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Map a request study to the meta-analysis engine's camelCase input. Forwards
// both the point+CI and 2x2-count shapes; the engine standardizes or skips.
function toEngineInput(study: EvidenceReportStudy): StudyEffectInput {
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

// Adapt each pooled (already-standardized, positive point + ratio-scale CI) study
// into a single-primary-analysis SynthesisSource so verifyAgainstSynthesis can
// reconcile the claim against the same effects that were pooled. It re-derives the
// pool internally, so its verdict is consistent with `pooled` (both trace to the
// same standardized studies; only 3dp rounding differs, which is immaterial).
function toSynthesisSources(pooled: MetaAnalysisResult): SynthesisSource[] {
  return pooled.studies.map((s) => ({
    label: s.label,
    analyses: [
      {
        outcomeTitle: s.label,
        outcomeType: "PRIMARY",
        paramType: s.measure,
        paramValue: s.point,
        ciPct: 95,
        ciLower: s.ciLower,
        ciUpper: s.ciUpper,
        pValue: null,
        method: null,
      },
    ],
  }));
}

function biasNote(test: EggersTestResult | null, verdict: BiasVerdict, k: number): string {
  if (verdict === "insufficient_studies") {
    return `Egger's test needs at least three studies to assess funnel-plot asymmetry; only ${k} were pooled, so small-study effects could not be tested.`;
  }
  if (!test) {
    return "Egger's test could not be computed for these studies.";
  }
  if (verdict === "possible_small_study_effects") {
    return `Egger's test shows funnel-plot asymmetry (intercept ${round(test.intercept, 2)}, p=${round(test.pValue, 3)}), a signal of possible small-study effects or publication bias. GRADE certainty is downgraded one step for publication bias.`;
  }
  return `Egger's test shows no funnel-plot asymmetry (intercept ${round(test.intercept, 2)}, p=${round(test.pValue, 3)}); no evidence of small-study effects among the pooled studies.`;
}

// Derive the GRADE input entirely from the pooled random-effects result plus the
// Egger's-test signal. All statistical domains come from numbers the engines
// already produced — nothing is invented here.
function toGradeInput(
  pooled: MetaAnalysisResult,
  eggerAsymmetry: boolean,
  overrides: { riskOfBiasSteps?: number; indirectnessSteps?: number }
) {
  return {
    k: pooled.k,
    iSquared: pooled.heterogeneity.iSquared,
    point: pooled.random.point,
    ciLower: pooled.random.ciLower,
    ciUpper: pooled.random.ciUpper,
    ciCrossesNull: !pooled.random.significant,
    totalN: null,
    riskOfBiasSteps: overrides.riskOfBiasSteps,
    indirectnessSteps: overrides.indirectnessSteps,
    publicationBiasSteps: eggerAsymmetry ? 1 : 0,
  };
}

// Stitch the four engine outputs into one plain-language paragraph a reviewer can
// read top to bottom: pooled magnitude, heterogeneity, publication bias, GRADE
// certainty, and the claim reconciliation.
function buildRationale(
  pooled: MetaAnalysisResult,
  bias: PublicationBiasReport,
  certainty: GradeResult,
  verdict: EvidenceReportVerdict
): string {
  const r = pooled.random;
  const head = `Pooled across ${pooled.k} ${pooled.measure} trials, the random-effects estimate is ${r.point} (95% CI ${r.ciLower}–${r.ciUpper}), about a ${round(r.reductionPercent)}% reduction, with I²=${round(pooled.heterogeneity.iSquared)}% heterogeneity.`;
  return `${head} ${bias.note} GRADE certainty is ${certainty.certainty}. ${verdict.rationale}`;
}

/**
 * Build a composite evidence report for a claim against a set of trial effect
 * estimates. Chains meta-analysis → publication-bias → GRADE → synthesis verdict
 * into a single defensible object. Pure orchestration, no LLM in the numeric loop.
 *
 * Handles < 2 usable studies gracefully by returning an honest
 * InsufficientEvidenceReport (ok: false) rather than forcing a low-confidence
 * pooled answer. Does not mutate its inputs.
 */
export function buildEvidenceReport(input: {
  claim: string;
  studies: readonly EvidenceReportStudy[];
  riskOfBiasSteps?: number;
  indirectnessSteps?: number;
  baselineRisk?: number;
}): BuildEvidenceReportResult {
  const claim = input.claim.trim();
  const claimed = claimedReductionPercent(claim);

  // 1. Meta-analysis. metaAnalyze returns null when fewer than two usable studies
  //    remain, in which case there is nothing to pool.
  const engineInputs = input.studies.map(toEngineInput);
  const pooled = metaAnalyze(engineInputs);

  if (!pooled) {
    // Re-run to surface per-study skip reasons even when k < 2: metaAnalyze only
    // populates `skipped` when it returns a result, so reconstruct a best-effort
    // count of how many studies produced a usable log-effect for the message.
    const usable = engineInputs.length;
    return {
      ok: false,
      claim,
      reason:
        "Fewer than two of the supplied studies produced a usable log-effect (each needs a positive point estimate with a widening confidence interval, or valid 2x2 counts). With under two comparable trials there is no pooled estimate, publication-bias test, or GRADE rating to compute — reporting this honestly rather than forcing a low-confidence answer.",
      claimedReductionPercent: claimed,
      usableStudies: usable,
      skipped: [],
    };
  }

  // 2. Publication bias: Egger's regression over the pooled studies' log effects.
  const biasStudies: BiasStudyEffect[] = pooled.studies.map((s) => ({
    label: s.label,
    yi: s.yi,
    vi: s.vi,
  }));
  const eggerTest = eggersTest(biasStudies);
  const biasVerdict = interpret(eggerTest);
  const publicationBias: PublicationBiasReport = {
    test: eggerTest,
    verdict: biasVerdict,
    note: biasNote(eggerTest, biasVerdict, pooled.k),
  };
  const eggerAsymmetry = eggerTest?.asymmetry === true;

  // 3. GRADE certainty, derived from the pooled numbers + the Egger's signal.
  const certainty = gradeCertainty(
    toGradeInput(pooled, eggerAsymmetry, {
      riskOfBiasSteps: input.riskOfBiasSteps,
      indirectnessSteps: input.indirectnessSteps,
    })
  );

  // 4. Synthesis verdict: reconcile the claim's magnitude with the pooled effect.
  const synthesis = verifyAgainstSynthesis(claim, toSynthesisSources(pooled));
  const verdict: EvidenceReportVerdict = {
    verdict: synthesis.verdict,
    rationale: synthesis.rationale,
    claimedReductionPercent: synthesis.claimedReductionPercent,
    pooledReductionPercent: synthesis.pooledReductionPercent,
    measure: synthesis.measure,
  };

  const rationale = buildRationale(pooled, publicationBias, certainty, verdict);

  // 5. Absolute effects (additive). Only when the caller supplied a baseline risk
  //    in (0, 1): translate the pooled random-effects relative estimate into ARR /
  //    NNT / events-per-1000. absoluteFromRelative returns null for an unusable
  //    baseline, in which case we simply omit the field (strictly additive).
  const absoluteEffects =
    input.baselineRisk !== undefined
      ? absoluteFromRelative({
          measure: pooled.measure,
          point: pooled.random.point,
          ciLower: pooled.random.ciLower,
          ciUpper: pooled.random.ciUpper,
          baselineRisk: input.baselineRisk,
        }) ?? undefined
      : undefined;

  return {
    ok: true,
    claim,
    pooled,
    publicationBias,
    certainty,
    verdict,
    claimedReductionPercent: claimed,
    rationale,
    ...(absoluteEffects ? { absoluteEffects } : {}),
  };
}
