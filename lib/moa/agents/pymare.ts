// PaperTrail MoA v2 · PyMARE Bayesian meta VERIFIER (category "meta").
//
// Layer-2 CONSUMER in the composition DAG. It does NOT re-parse the corpus: it READS the
// typed `effect_sizes` artifact (ParsedEffectSize[]) that the quant-extractor enricher
// PRODUCED in Layer 1, POOLS those numbers into a single Bayesian random-effects posterior
// with lib/metaBayesian.bayesianMetaAnalyze, then compares the pooled effect DIRECTION and
// its credible/predictive intervals against the claim's asserted direction (read with
// lib/effectSize.claimedReductionPercent) to vote supports / refutes / mixed / insufficient.
//
// This is the capability a generic LLM claim-checker structurally cannot reproduce:
// instead of asking a model whether "the literature agrees", it independently synthesizes
// the reported ratio effect sizes (RR/HR/OR) across >=2 sources into a closed-form
// (conjugate normal-normal) posterior and reads the vote off that deterministic posterior.
//
// COMPOSITION: consumes ["effect_sizes"]; produces []. If the upstream artifact is absent
// or carries fewer than two poolable studies in a shared measure, it degrades honestly with
// skippedContribution rather than forcing a low-confidence vote.
//
// Deterministic end-to-end: pooling is closed form, the signal is read off the posterior.
// No LLM, no I/O, no DB pool — usedClaude is always false. Every grounded quote is the
// verbatim `raw` substring the effect-size extractor already matched, re-located in its
// source (never fabricated).

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  AgentSignal,
  GroundedSpan,
  MoaSource,
  ParsedEffectSize,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import { claimedReductionPercent } from "../../effectSize";
import { bayesianMetaAnalyze } from "../../metaBayesian";
import type { StudyEffectInput, RatioMeasure } from "../../metaAnalysis";

const AGENT_ID = "pymare";

// The three ratio measures the Bayesian engine can pool. A pooled meta-analysis must
// share ONE measure, so we pool whichever ratio measure has the most usable studies.
const RATIO_MEASURES: readonly RatioMeasure[] = ["HR", "RR", "OR"];

// The null value shared by every ratio measure: ratio == 1 <=> no effect (log == 0).
const NULL = 1;

// Per-study detail row for the UI panel — ids/measures/numbers only, never the raw source
// body beyond the short grounded effect string the extractor already matched.
interface PooledStudyDetail {
  sourceId: string;
  measure: RatioMeasure;
  point: number;
  ciLow: number;
  ciHigh: number;
  raw: string;
}

// A ParsedEffectSize's measure is always one of the three ratio measures by the producer's
// contract, so no re-validation of shape is needed here — the enricher already dropped
// anything non-poolable. This narrows the union to RatioMeasure for the pooling engine.
function isRatioMeasure(m: ParsedEffectSize["measure"]): m is RatioMeasure {
  return m === "HR" || m === "RR" || m === "OR";
}

// Pick the ratio measure with the most usable studies; that measure defines the pool (the
// Bayesian engine cannot mix HRs with ORs). Ties break by the fixed RATIO_MEASURES order
// (HR, RR, OR) so the choice is deterministic. Returns null when no single measure reaches
// two studies (nothing to pool).
function dominantMeasure(effects: readonly ParsedEffectSize[]): RatioMeasure | null {
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

// Translate a consumed effect-size artifact row into the pooling engine's study input.
function toStudyInput(e: ParsedEffectSize): StudyEffectInput {
  return {
    label: e.sourceId,
    measure: e.measure,
    point: e.point,
    ciLower: e.ciLow,
    ciUpper: e.ciHigh,
  };
}

// Ground a pooled effect's verbatim `raw` substring back to its exact offsets in the owning
// source. Skips (never fabricates) a span when the source is absent or the substring cannot
// be located in it.
function groundEffect(
  e: ParsedEffectSize,
  sources: readonly MoaSource[]
): GroundedSpan | null {
  const source = sources.find((s) => s.id === e.sourceId);
  if (source === undefined) return null;
  const start = source.text.indexOf(e.raw);
  if (start < 0) return null;
  return {
    sourceId: e.sourceId,
    text: e.raw,
    start,
    end: start + e.raw.length,
  };
}

// Whether an interval (ratio scale) spans the null value of 1 — not distinguishable from
// "no effect".
function spansNull(lower: number, upper: number): boolean {
  return lower <= NULL && upper >= NULL;
}

// Confidence from the credible-interval width on the LOG scale: a tight posterior (narrow
// interval) is high confidence, a wide one is low. Mapped monotonically into [0,1] by
// exp(-width) so it is deterministic and never negative.
function confidenceFromWidth(lowerLog: number, upperLog: number): number {
  const width = Math.abs(upperLog - lowerLog);
  return clamp01(Math.exp(-width));
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "PyMARE Bayesian Meta-Analysis",
  category: "meta",
  description:
    "Consumes the effect_sizes artifact, pools the ratio effect sizes (RR/HR/OR) across " +
    ">=2 sources into a Bayesian random-effects posterior, then votes on the claim by the " +
    "pooled effect's direction and credible interval. Fully deterministic; no LLM in the " +
    "numeric path.",

  // PRODUCES nothing (a terminal verifier); CONSUMES the effect_sizes artifact that the
  // quant-extractor enricher writes in Layer 1.
  produces: [] as const,
  consumes: ["effect_sizes"] as const,

  // ELIGIBILITY, deterministic from the input alone (never the blackboard): with >=2 sources
  // the enricher can plausibly produce >=2 poolable effects to synthesize, so this consumer
  // is worth scheduling. Whether the produced artifact actually carries a two-study pool is
  // re-checked at run() (skip if not). Pure and side-effect-free.
  gate(ctx: OrchestrationContext): number {
    return ctx.sources.length >= 2 ? 0.85 : 0;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    try {
      // COMPOSE: read the upstream effect_sizes artifact rather than re-parsing the corpus.
      const artifact = bb.get("effect_sizes");
      if (artifact === undefined || artifact.length === 0) {
        return skippedContribution(
          AGENT_ID,
          "No effect_sizes artifact was produced upstream — the effect-size extractor found no poolable ratio effects to synthesize."
        );
      }

      // Keep only well-formed ratio effects (the producer's contract already guarantees this;
      // the narrow is defensive so the pooling engine only ever sees RatioMeasure studies).
      const ratioEffects = artifact.filter((e) => isRatioMeasure(e.measure));
      const measure = dominantMeasure(ratioEffects);
      if (measure === null) {
        return skippedContribution(
          AGENT_ID,
          "Fewer than two sources reported a poolable ratio effect (RR/HR/OR) in a shared measure — no pool to place a Bayesian posterior over."
        );
      }

      // Keep only the effects on the dominant measure; that is the pool.
      const pooled = ratioEffects.filter((e) => e.measure === measure);
      const result = bayesianMetaAnalyze(pooled.map(toStudyInput));
      if (result === null) {
        return skippedContribution(
          AGENT_ID,
          "Fewer than two studies survived standardization — the Bayesian meta-analysis had no pool to summarize."
        );
      }

      // Ground each pooled study's verbatim effect substring back to its source offsets.
      const groundedSpans: GroundedSpan[] = [];
      for (const e of pooled) {
        const span = groundEffect(e, ctx.sources);
        if (span !== null) groundedSpans.push(span);
      }

      // Direction of the pooled effect: ratio < 1 (log < 0) = beneficial (reduction).
      const pooledBenefit = result.posteriorMean < NULL;
      const credibleExcludesNull = !spansNull(result.credible.lower, result.credible.upper);
      const predictiveExcludesNull = !spansNull(
        result.predictive.lower,
        result.predictive.upper
      );

      // The claim's asserted relative reduction: positive => claim asserts a benefit
      // (expected ratio < 1); negative => harm (ratio > 1); null => the claim states no
      // comparable numeric direction to vote against.
      const claimedReduction = claimedReductionPercent(ctx.claim);
      const claimAssertsBenefit =
        claimedReduction === null ? null : claimedReduction >= 0;

      let signal: AgentSignal;
      let summary: string;

      if (claimAssertsBenefit === null) {
        // No directional claim to test: contribute the pooled effect as CONTEXT, not a vote.
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
        // Significant AND its direction agrees with the claim.
        signal = "supports";
        summary = `Pooled ${measure} ${result.posteriorMean} across ${result.k} sources (95% credible interval ${result.credible.lower}–${result.credible.upper}, excluding the null) agrees in direction with the claim.`;
      } else {
        // Significant but points the OPPOSITE way to the claim.
        signal = "refutes";
        summary = `Pooled ${measure} ${result.posteriorMean} across ${result.k} sources (95% credible interval ${result.credible.lower}–${result.credible.upper}, excluding the null) points the OPPOSITE way to the claim's asserted direction.`;
      }

      // Confidence: for a vote, the tightness of the credible interval (deterministic
      // posterior precision). For a neutral context signal, halve it — context is worth less
      // to the mix than a resolved directional vote.
      const widthConfidence = confidenceFromWidth(
        result.credible.lowerLog,
        result.credible.upperLog
      );
      const confidence =
        signal === "neutral" ? clamp01(widthConfidence * 0.5) : widthConfidence;

      const perStudy: PooledStudyDetail[] = pooled.map((e) => ({
        sourceId: e.sourceId,
        measure,
        point: e.point,
        ciLow: e.ciLow,
        ciHigh: e.ciHigh,
        raw: e.raw,
      }));

      return makeContribution(AGENT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          measure,
          k: result.k,
          consumedEffects: artifact.length,
          pooledStudyCount: pooled.length,
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
          producerOfEffectSizes: bb.producerOf("effect_sizes") ?? null,
          pooledStudies: perStudy,
          skipped: result.skipped,
        },
        groundedSpans,
        usedClaude: false,
        produced: {},
      });
    } catch (err) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
