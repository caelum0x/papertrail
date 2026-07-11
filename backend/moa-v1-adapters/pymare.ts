// PaperTrail MoA expert · PyMARE Bayesian random-effects meta-analysis (QUANTITATIVE
// expert, category "meta").
//
// This is the capability a generic LLM claim-checker structurally cannot reproduce:
// instead of asking a model whether "the literature agrees", it independently POOLS the
// reported ratio effect sizes (RR/HR/OR) parsed from >=2 cached sources into a single
// Bayesian random-effects posterior, then compares the pooled effect DIRECTION and its
// credible interval against the claim's asserted direction to vote supports / refutes /
// mixed / insufficient.
//
// Pipeline, all reusing existing PaperTrail libs — no new numeric logic here:
//   1. lib/effectSize.ts  · parseEffectSizes  — deterministically extract HR/RR/OR point
//      estimates + CI from each source's cached text (verbatim `raw` substrings).
//   2. lib/effectSize.ts  · claimedReductionPercent — read the claim's asserted relative
//      reduction (positive => benefit => expected ratio < 1 => log effect < 0).
//   3. lib/metaBayesian.ts · bayesianMetaAnalyze — pool the extracted effects into a
//      closed-form (conjugate normal-normal) posterior + credible/predictive intervals.
//
// Deterministic end-to-end: extraction is regex, pooling is closed form, the signal is
// read off the deterministic posterior. No LLM, no I/O, no DB pool — usedClaude is always
// false and the expert is safe to run inside the stateless orchestrator. Every grounded
// quote is a verbatim substring the effect-size extractor already matched.

import type {
  Expert,
  OrchestrationContext,
  ExpertContribution,
  ExpertSignal,
  GroundedSpan,
  MoaSource,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import { parseEffectSizes, claimedReductionPercent } from "../../effectSize";
import type { ParsedEffect } from "../../effectSize";
import { bayesianMetaAnalyze } from "../../metaBayesian";
import type { StudyEffectInput } from "../../metaAnalysis";
import type { RatioMeasure } from "../../metaAnalysis";

const EXPERT_ID = "pymare";

// The three ratio measures the Bayesian engine can pool. A pooled meta-analysis must
// share ONE measure, so we pool whichever ratio measure has the most usable sources.
const RATIO_MEASURES: readonly RatioMeasure[] = ["HR", "RR", "OR"];

// I^2 above this fraction (via a prediction-interval that spans the null while the
// credible interval does not) marks the pool as too heterogeneous for a clean vote.
// The Bayesian engine reports no I^2 directly, so heterogeneity is judged by the
// predictive interval crossing the null — the honest "a new study could land either
// side" test. This is a boundary constant, not a re-derived statistic.
const NULL = 1;

// One extractable ratio effect from a single source, paired with the source it came from
// so we can (a) feed it to the pooling engine and (b) ground its verbatim `raw` text.
interface SourceEffect {
  sourceId: string;
  measure: RatioMeasure;
  effect: ParsedEffect;
}

// Per-source detail row for the UI detail panel — ids/measures/numbers only, never the
// raw source body beyond the short grounded effect string the extractor already matched.
interface PooledStudyDetail {
  sourceId: string;
  measure: RatioMeasure;
  point: number;
  ciLower: number;
  ciUpper: number;
  raw: string;
}

// A ParsedEffect is poolable by the Bayesian engine only if it is a ratio measure with a
// positive point estimate AND a widening (positive, ordered) confidence interval.
function isPoolableRatio(e: ParsedEffect): e is ParsedEffect & {
  measure: RatioMeasure;
  point: number;
  ciLow: number;
  ciHigh: number;
} {
  return (
    (e.measure === "HR" || e.measure === "RR" || e.measure === "OR") &&
    typeof e.point === "number" &&
    e.point > 0 &&
    typeof e.ciLow === "number" &&
    e.ciLow > 0 &&
    typeof e.ciHigh === "number" &&
    e.ciHigh > e.ciLow
  );
}

// Extract at most one usable ratio effect per source (the first poolable ratio match),
// so each source contributes a single study to the pool — the standard one-effect-per-
// study convention. Pure: reads only the cached text, never fetches.
function extractSourceEffect(source: MoaSource): SourceEffect | null {
  const effects = parseEffectSizes(source.text);
  for (const e of effects) {
    if (isPoolableRatio(e)) {
      return { sourceId: source.id, measure: e.measure, effect: e };
    }
  }
  return null;
}

// Collect one poolable ratio effect from every source that yields one.
function collectSourceEffects(sources: readonly MoaSource[]): SourceEffect[] {
  const out: SourceEffect[] = [];
  for (const source of sources) {
    const se = extractSourceEffect(source);
    if (se !== null) out.push(se);
  }
  return out;
}

// Pick the ratio measure with the most usable sources; that measure defines the pool
// (the Bayesian engine cannot mix HRs with ORs). Ties break by the fixed RATIO_MEASURES
// order (HR, RR, OR) so the choice is deterministic.
function dominantMeasure(effects: readonly SourceEffect[]): RatioMeasure | null {
  let best: RatioMeasure | null = null;
  let bestCount = 0;
  for (const measure of RATIO_MEASURES) {
    const count = effects.filter((e) => e.measure === measure).length;
    if (count > bestCount) {
      best = measure;
      bestCount = count;
    }
  }
  return bestCount >= 2 ? best : null;
}

// Ground a source effect's verbatim `raw` substring back to its exact offsets in the
// source text. Skips (never fabricates) a span when the substring cannot be located.
function groundEffect(
  se: SourceEffect,
  sources: readonly MoaSource[]
): GroundedSpan | null {
  const source = sources.find((s) => s.id === se.sourceId);
  if (source === undefined) return null;
  const start = source.text.indexOf(se.effect.raw);
  if (start < 0) return null;
  return {
    sourceId: se.sourceId,
    text: se.effect.raw,
    start,
    end: start + se.effect.raw.length,
  };
}

// Translate an extracted ratio effect into the pooling engine's study input shape.
function toStudyInput(se: SourceEffect): StudyEffectInput {
  return {
    label: se.sourceId,
    measure: se.measure,
    point: se.effect.point,
    ciLower: se.effect.ciLow,
    ciUpper: se.effect.ciHigh,
  };
}

// Whether an interval (on the ratio scale) spans the null value of 1 — i.e. is not
// statistically distinguishable from "no effect".
function spansNull(lower: number, upper: number): boolean {
  return lower <= NULL && upper >= NULL;
}

// Confidence from the credible-interval width on the LOG scale: a tight posterior
// (narrow interval) is high confidence, a wide one is low. Mapped monotonically into
// [0,1] by exp(-width) so it is deterministic and never negative.
function confidenceFromWidth(lowerLog: number, upperLog: number): number {
  const width = Math.abs(upperLog - lowerLog);
  return clamp01(Math.exp(-width));
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "PyMARE Bayesian Meta-Analysis",
  category: "meta",
  description:
    "Pools the ratio effect sizes (RR/HR/OR) reported across >=2 sources into a Bayesian random-effects posterior, then votes on the claim by the pooled effect's direction and credible interval. Fully deterministic; no LLM in the numeric path.",

  // HIGH relevance when >=2 sources yield an extractable, poolable ratio effect that
  // share a common measure (there is a pool to place a posterior over); otherwise 0
  // (nothing to pool). Pure and side-effect-free: only regex extraction over cached text.
  gate(ctx: OrchestrationContext): number {
    const effects = collectSourceEffects(ctx.sources);
    if (effects.length < 2) return 0;
    if (dominantMeasure(effects) === null) return 0;
    return 0.9;
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    try {
      const allEffects = collectSourceEffects(ctx.sources);
      const measure = dominantMeasure(allEffects);
      if (measure === null) {
        return skippedContribution(
          EXPERT_ID,
          "Fewer than two sources reported a poolable ratio effect (RR/HR/OR with a CI) in a shared measure — no pool to place a Bayesian posterior over."
        );
      }

      // Keep only the sources on the dominant measure; that is the pool.
      const pooled = allEffects.filter((e) => e.measure === measure);
      const result = bayesianMetaAnalyze(pooled.map(toStudyInput));
      if (result === null) {
        return skippedContribution(
          EXPERT_ID,
          "Fewer than two studies survived standardization — the Bayesian meta-analysis had no pool to summarize."
        );
      }

      // Ground each pooled study's verbatim effect substring back to its source offsets.
      const groundedSpans: GroundedSpan[] = [];
      for (const se of pooled) {
        const span = groundEffect(se, ctx.sources);
        if (span !== null) groundedSpans.push(span);
      }

      // Direction of the pooled effect: ratio < 1 (log < 0) = beneficial (reduction).
      const pooledBenefit = result.posteriorMean < NULL;
      const credibleExcludesNull = !spansNull(
        result.credible.lower,
        result.credible.upper
      );
      const predictiveExcludesNull = !spansNull(
        result.predictive.lower,
        result.predictive.upper
      );

      // The claim's asserted relative reduction: positive => claim asserts a benefit
      // (expected ratio < 1); negative => claim asserts harm (ratio > 1); null => the
      // claim states no comparable numeric direction to vote against.
      const claimedReduction = claimedReductionPercent(ctx.claim);
      const claimAssertsBenefit =
        claimedReduction === null ? null : claimedReduction >= 0;

      let signal: ExpertSignal;
      let summary: string;

      if (claimAssertsBenefit === null) {
        // No directional claim to test against: contribute the pooled effect as CONTEXT
        // (a WEIGHTING signal), not a support/refute vote.
        signal = "neutral";
        summary = `Pooled ${measure} ${result.posteriorMean} across ${result.k} sources (95% credible interval ${result.credible.lower}–${result.credible.upper}); the claim states no comparable numeric effect to vote on.`;
      } else if (!credibleExcludesNull) {
        // The pooled credible interval spans the null: no significant pooled effect.
        signal = "insufficient";
        summary = `Pooled ${measure} ${result.posteriorMean} has a 95% credible interval of ${result.credible.lower}–${result.credible.upper} that spans the null of 1 — no statistically resolvable pooled effect to confirm the claim.`;
      } else if (credibleExcludesNull && !predictiveExcludesNull) {
        // Significant on average, but a new study's predictive interval still crosses the
        // null: high between-study heterogeneity — the pooled effect is not reliable.
        signal = "mixed";
        summary = `Pooled ${measure} ${result.posteriorMean} is significant (credible interval ${result.credible.lower}–${result.credible.upper}) but the posterior-predictive interval (${result.predictive.lower}–${result.predictive.upper}) spans the null — high heterogeneity across the ${result.k} sources.`;
      } else if (pooledBenefit === claimAssertsBenefit) {
        // Pooled effect is significant AND its direction agrees with the claim.
        signal = "supports";
        summary = `Pooled ${measure} ${result.posteriorMean} across ${result.k} sources (95% credible interval ${result.credible.lower}–${result.credible.upper}, excluding the null) agrees in direction with the claim.`;
      } else {
        // Pooled effect is significant but points the OPPOSITE way to the claim.
        signal = "refutes";
        summary = `Pooled ${measure} ${result.posteriorMean} across ${result.k} sources (95% credible interval ${result.credible.lower}–${result.credible.upper}, excluding the null) points the OPPOSITE way to the claim's asserted direction.`;
      }

      // Confidence: for a vote, the tightness of the credible interval (deterministic
      // posterior precision). For a neutral context signal, halve it — context is worth
      // less to the mix than a resolved directional vote.
      const widthConfidence = confidenceFromWidth(
        result.credible.lowerLog,
        result.credible.upperLog
      );
      const confidence =
        signal === "neutral" ? clamp01(widthConfidence * 0.5) : widthConfidence;

      const perStudy: PooledStudyDetail[] = pooled.map((se) => ({
        sourceId: se.sourceId,
        measure: se.measure,
        point: se.effect.point as number,
        ciLower: se.effect.ciLow as number,
        ciUpper: se.effect.ciHigh as number,
        raw: se.effect.raw,
      }));

      return makeContribution(EXPERT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          measure,
          k: result.k,
          posteriorMean: result.posteriorMean,
          posteriorMeanLog: result.posteriorMeanLog,
          posteriorVar: result.posteriorVar,
          credible: result.credible,
          predictive: result.predictive,
          tauSquared: result.tauSquared,
          tauSource: result.tauSource,
          probBelowNull: result.probBelowNull,
          crediblePct: result.crediblePct,
          credibleExcludesNull,
          predictiveExcludesNull,
          claimedReductionPercent: claimedReduction,
          claimAssertsBenefit,
          pooledAssertsBenefit: pooledBenefit,
          pooledStudies: perStudy,
          skipped: result.skipped,
        },
        groundedSpans,
        usedClaude: false,
      });
    } catch (err) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
