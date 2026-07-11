// PaperTrail MoA v2 · MINICHECK — the KEY PRODUCER of the `source_labels` artifact.
//
// MiniCheck (Tang, Laban & Durrett, EMNLP 2024) answers one grounded question per source:
// does the document ENTAIL the claim? PaperTrail's negation-aware specialization
// (lib/grounding/negationEntailment.verifyAbsenceClaim) first decides the claim's polarity
// DETERMINISTICALLY from a negation-cue lexicon, then asks Claude only the polarity-neutral
// "does the source assert PRESENCE / ABSENCE / NEITHER of the effect?" question, and only
// counts that judgement once its supporting sentence is GROUNDED as a verbatim substring of
// the source. A fixed (polarity x assertion) table maps that to SUPPORTS / REFUTES / NEI.
//
// COMPOSITION CONTRACT
//   produces: ["source_labels"] — a per-source SourceLabel[] { sourceId, label, confidence,
//     span }. This is the artifact MultiVerS / Valsci / STORM downstream CONSUME to reason
//     about agreement, contest, and debate. MiniCheck is the entailment backbone of the DAG.
//   consumes: ["relevance", "quality"] — both OPTIONAL, both used to compose honestly:
//     · relevance (Loki): SKIP any source in relevance.droppedIds (ruled off-topic) so we
//       never waste a Claude call — or emit a label — on a source that isn't about the claim.
//     · quality (paper-qa): DOWN-WEIGHT each label's confidence by that source's quality
//       weight, so a decisive label from a preprint / low-tier / retracted source counts less
//       than the same label from a Tier-A source. Missing quality => no down-weighting (1.0).
//
// The AGENT VOTE is the single strongest DECISIVE label (SUPPORTS/REFUTES, not NEI), mapped to
// a directional signal via signalFromLabel; its (down-weighted) confidence and grounded span
// become the contribution's confidence and groundedSpans.
//
// Stateless: owns no DB pool and opens no network beyond the Claude call the engine already
// makes internally, and only when ctx.options.llm is true. MiniCheck has no deterministic-only
// path (the presence/absence judgement is the model step), so when llm is false it SKIPS.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  GroundedSpan,
  SourceLabel,
  SourceRelevance,
  SourceQuality,
  MoaSource,
} from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
  signalFromLabel,
} from "../types";
import {
  verifyAbsenceClaim,
  type VerifyAbsenceResult,
  type AbsenceLabel,
} from "../../grounding/negationEntailment";

const AGENT_ID = "minicheck";

// CALIBRATED GATE (deterministic, input-only — no LLM, no blackboard). Label reliability
// scales with evidence density: more on-topic sources and longer source text both raise the
// expected quality of the resulting verdict. We therefore scale the gate from a floor toward a
// ceiling as usable-source count and mean text length grow, instead of a flat constant.
const GATE_FLOOR = 0.5; // one sparse source: eligible, but modest
const GATE_CEILING = 0.95; // saturates well before certainty
const GATE_PER_SOURCE = 0.05; // each usable source adds this much
const GATE_PER_CHAR = 0.0001; // each char of mean source length adds this much

// The MoA three-way label consumers read off the blackboard.
type MoaLabel = SourceLabel["label"];

function hasVerifiableText(text: string): boolean {
  return text.trim().length > 0;
}

// Map the engine's fixed absence-aware verdict onto the three-way source label consumers use.
//   supported / negative_supported -> the source ENTAILS the claim's polarity     -> SUPPORTS
//   refuted                        -> the source CONTRADICTS the claim's polarity  -> REFUTES
//   nei                            -> no groundable evidence either way            -> NEI
function moaLabelFromAbsence(label: AbsenceLabel): MoaLabel {
  switch (label) {
    case "supported":
    case "negative_supported":
      return "SUPPORTS";
    case "refuted":
      return "REFUTES";
    case "nei":
      return "NEI";
  }
}

// The engine already returns supporting_span.text as a located verbatim substring of the
// source; surface it as a typed GroundedSpan, or null when nei / ungroundable.
function spanFromResult(sourceId: string, result: VerifyAbsenceResult): GroundedSpan | null {
  // Defensive: verifyAbsenceClaim never emits a non-null supporting_span with null grounding,
  // but a grounded span with no location would be unusable — treat either as "ungrounded".
  if (result.supporting_span === null || result.supporting_span.grounding === null) return null;
  return {
    sourceId,
    text: result.supporting_span.text,
    start: result.supporting_span.grounding.start,
    end: result.supporting_span.grounding.end,
  };
}

// Look up a source's quality weight from the `quality` artifact. Missing quality (or a source
// absent from it) => 1.0: we degrade honestly to no down-weighting rather than guessing.
function qualityWeightFor(quality: SourceQuality | undefined, sourceId: string): number {
  if (quality === undefined) return 1;
  const entry = quality.weightById[sourceId];
  if (entry === undefined) return 1;
  return clamp01(entry.weight);
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "MiniCheck (negation-aware entailment)",
  category: "verification",
  description:
    "Key producer of source_labels: detects claim polarity deterministically and checks each " +
    "on-topic source for grounded evidence that the claimed effect is present or absent, " +
    "emitting a per-source SUPPORTS/REFUTES/NEI label that MultiVerS, Valsci, and STORM consume.",

  // KEY PRODUCER: writes the per-source entailment labels the downstream verifiers build on.
  produces: ["source_labels"] as const,
  // Composes with Loki's relevance triage (skip off-topic) and paper-qa's quality weighting
  // (down-weight low-tier). Both optional: MiniCheck degrades honestly without them.
  consumes: ["relevance", "quality"] as const,

  // Pure + deterministic from the INPUT ONLY: usefulness is a function of how many sources
  // carry verifiable text. No I/O, no LLM, no blackboard read, no throwing.
  gate(ctx: OrchestrationContext): number {
    if (ctx.claim.trim().length === 0) return 0;
    const usableSources = ctx.sources.filter((s) => hasVerifiableText(s.text));
    const usable = usableSources.length;
    if (usable === 0) return 0;
    // Evidence density: one short source -> near the floor; many long sources -> near the ceiling.
    const meanLength =
      usableSources.reduce((sum, s) => sum + s.text.trim().length, 0) / usable;
    const scaled = GATE_FLOOR + GATE_PER_SOURCE * usable + GATE_PER_CHAR * meanLength;
    return clamp01(Math.min(GATE_CEILING, scaled));
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    const claim = ctx.claim.trim();
    if (claim.length === 0) {
      return skippedContribution(AGENT_ID, "No claim text to check the sources against.");
    }

    // COMPOSE: read Loki's relevance ranking and skip sources ruled off-topic; read paper-qa's
    // quality weighting to down-weight per-source label confidence. Both are advisory soft deps.
    const relevance: SourceRelevance | undefined = bb.get("relevance");
    const quality: SourceQuality | undefined = bb.get("quality");
    const droppedIds = new Set<string>(relevance?.droppedIds ?? []);

    const usableSources = ctx.sources.filter(
      (s) => hasVerifiableText(s.text) && !droppedIds.has(s.id)
    );

    if (usableSources.length === 0) {
      // Every source either lacked text or was ruled off-topic upstream — honest skip, no labels.
      const reason =
        droppedIds.size > 0
          ? "All sources with usable text were ruled off-topic upstream (Loki); nothing to label."
          : "No source with usable text to check the claim against.";
      return skippedContribution(AGENT_ID, reason);
    }

    // The engine's presence/absence judgement IS the model step; MiniCheck has no
    // deterministic-only fallback, so with the Claude step disabled it skips honestly.
    if (ctx.options.llm !== true) {
      return skippedContribution(
        AGENT_ID,
        "MiniCheck's presence/absence judgement requires the Claude step, which is disabled."
      );
    }

    try {
      // Verify each on-topic source, building the per-source SourceLabel the DAG consumes.
      const evaluated: Array<{
        source: MoaSource;
        result: VerifyAbsenceResult;
        moaLabel: MoaLabel;
        qualityWeight: number;
        rawConfidence: number;
        weightedConfidence: number;
        span: GroundedSpan | null;
      }> = [];

      // Per-source isolation (fix 4): one source failing (schema/parse/timeout) must NOT discard
      // the labels for sources that already succeeded. Skip the failing source, keep going, and
      // report how many of M we actually evaluated so consumers can judge the label set's breadth.
      const failedSourceIds: string[] = [];
      for (const source of usableSources) {
        try {
          const result = await verifyAbsenceClaim({ claim, sourceText: source.text });
          const moaLabel = moaLabelFromAbsence(result.label);
          const qualityWeight = qualityWeightFor(quality, source.id);
          // rawConfidence is the engine's un-down-weighted score for a decisive judgement; the
          // weighted one folds in the source's quality. NEI carries no decisive confidence, so
          // its weighted value stays 0 regardless of quality (see NEI note in the vote block).
          const rawConfidence = moaLabel === "NEI" ? 0 : clamp01(result.score);
          const weightedConfidence =
            moaLabel === "NEI" ? 0 : clamp01(result.score * qualityWeight);
          evaluated.push({
            source,
            result,
            moaLabel,
            qualityWeight,
            rawConfidence,
            weightedConfidence,
            span: spanFromResult(source.id, result),
          });
        } catch {
          // This one source could not be verified; record and continue with the rest.
          failedSourceIds.push(source.id);
        }
      }

      // If EVERY source failed, we have nothing to label — honest skip rather than a fake verdict.
      if (evaluated.length === 0) {
        return skippedContribution(
          AGENT_ID,
          `MiniCheck could not verify any of ${usableSources.length} on-topic source(s); no labels produced.`
        );
      }

      // PRODUCE: the per-source labels artifact. Confidence is the quality-down-weighted score;
      // spans are only ever the engine's already-grounded verbatim substrings (never fabricated).
      const sourceLabels: SourceLabel[] = evaluated.map((e) => ({
        sourceId: e.source.id,
        label: e.moaLabel,
        confidence: e.weightedConfidence,
        span: e.span,
      }));

      // VOTE: the single strongest DECISIVE label (SUPPORTS/REFUTES), by down-weighted
      // confidence. Fall back to the strongest overall (an NEI) only when nothing was decisive.
      //
      // Deterministic tie-break (fix 2): all-NEI fallback entries share weightedConfidence = 0, so
      // a bare `>` comparator would just keep whichever the filter yielded first (source-order
      // dependent). We break ties on the raw model score (more evidence of "neither"), then on
      // source id, so the representative NEI is a stable function of the inputs — not array order.
      const pickBest = (a: (typeof evaluated)[number], b: (typeof evaluated)[number]) => {
        if (b.weightedConfidence !== a.weightedConfidence) {
          return b.weightedConfidence > a.weightedConfidence ? b : a;
        }
        if (b.result.score !== a.result.score) {
          return b.result.score > a.result.score ? b : a;
        }
        return b.source.id > a.source.id ? b : a;
      };
      const decisive = evaluated.filter((e) => e.moaLabel !== "NEI");
      const best =
        decisive.length > 0 ? decisive.reduce(pickBest) : evaluated.reduce(pickBest);

      // Map the winning label to a directional MoA signal. SUPPORTS/REFUTES/NEI align 1:1 with
      // the MoaSource label union signalFromLabel expects.
      const signal = signalFromLabel(best.moaLabel);
      // NEI stays at confidence 0 BY DESIGN (fixes 1 & 6). signalFromLabel("NEI") === "insufficient",
      // which the aggregator EXCLUDES from the vote mass (VOTES = supports|refutes|mixed): an NEI
      // contribution never adds to supports/refutes and never consumes a directional vote slot, so
      // a non-zero NEI confidence would be inert-yet-misleading in the deterministic mix. We keep
      // it 0 so an honest "couldn't decide" reads as a true neutral. The raw model score for the
      // NEI judgement is preserved for consumers in detail.bestRawScore and detail.labels[].
      const confidence = best.moaLabel === "NEI" ? 0 : best.weightedConfidence;

      // groundedSpans is the winning label's grounded span (verbatim engine substring), if any.
      const groundedSpans: GroundedSpan[] = best.span !== null ? [best.span] : [];

      const supportsCount = sourceLabels.filter((l) => l.label === "SUPPORTS").length;
      const refutesCount = sourceLabels.filter((l) => l.label === "REFUTES").length;
      const neiCount = sourceLabels.filter((l) => l.label === "NEI").length;

      // How many of the on-topic sources we actually got a verdict for (fix 4 transparency).
      const evaluatedCount = evaluated.length;
      const failedNote =
        failedSourceIds.length > 0
          ? ` (${evaluatedCount}/${usableSources.length} sources verified; ${failedSourceIds.length} could not be evaluated)`
          : "";

      const summary =
        best.moaLabel === "NEI"
          ? `No groundable presence/absence evidence across ${evaluatedCount} on-topic source(s)${failedNote}.`
          : `${best.result.polarity} claim: strongest source asserts ${best.result.source_assertion} of the effect -> ${best.moaLabel} (conf ${confidence.toFixed(2)})${failedNote}.`;

      return makeContribution(AGENT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          claimPolarity: best.result.polarity,
          negationCues: best.result.negation_cues,
          bestLabel: best.moaLabel,
          bestSourceId: best.source.id,
          bestSourceAssertion: best.result.source_assertion,
          bestRawScore: Number(best.result.score.toFixed(4)),
          bestQualityWeight: Number(best.qualityWeight.toFixed(4)),
          groundingDropped: best.result.grounding_dropped,
          bestRawConfidence: Number(best.rawConfidence.toFixed(4)),
          sourcesChecked: usableSources.length,
          sourcesEvaluated: evaluatedCount,
          failedSourceIds,
          droppedOffTopic: droppedIds.size,
          consumedRelevance: relevance !== undefined,
          consumedQuality: quality !== undefined,
          labelCounts: { supports: supportsCount, refutes: refutesCount, nei: neiCount },
          // Per-source diagnostics. We surface rawConfidence (un-down-weighted engine score) and
          // qualityWeight ALONGSIDE the weighted confidence (fix 3) so a downstream verifier can
          // see WHY a "best" label was ranked where it was — e.g. a high-raw REFUTES that quality
          // weighting pushed below a lower-raw SUPPORTS — and re-weight itself if it disagrees.
          // NOTE: the public source_labels artifact keeps its stable shape; this richer view lives
          // only in detail, so no consumer's SourceLabel contract changes.
          labels: evaluated.map((e) => ({
            sourceId: e.source.id,
            label: e.moaLabel,
            confidence: Number(e.weightedConfidence.toFixed(4)),
            rawConfidence: Number(e.rawConfidence.toFixed(4)),
            qualityWeight: Number(e.qualityWeight.toFixed(4)),
            grounded: e.span !== null,
          })),
        },
        groundedSpans,
        usedClaude: ctx.options.llm === true,
        produced: { source_labels: sourceLabels },
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
