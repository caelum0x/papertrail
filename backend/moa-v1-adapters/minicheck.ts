// MoA expert adapter for the MiniCheck engine — negation-aware presence/absence
// entailment. Wraps lib/grounding/negationEntailment.verifyAbsenceClaim, which decides
// claim polarity DETERMINISTICALLY (negation-cue lexicon) and asks Claude only the
// polarity-neutral "does the source assert presence / absence / neither?" question,
// counting that judgement only once its supporting sentence is GROUNDED in the source.
//
// This adapter is stateless: it owns no DB pool and opens no network beyond the Claude
// call the engine already makes internally (and only when ctx.options.llm is true).

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
import {
  verifyAbsenceClaim,
  type VerifyAbsenceResult,
  type AbsenceLabel,
} from "../../grounding/negationEntailment";

const EXPERT_ID = "minicheck";

// Map the engine's fixed absence-aware label onto an MoA directional signal.
//   supported            -> a positive claim confirmed by evidence of presence -> supports
//   negative_supported   -> an absence claim confirmed by evidence of absence  -> supports
//   refuted              -> the source contradicts the claim's polarity        -> refutes
//   nei                  -> no groundable evidence either way                   -> insufficient
function signalFromAbsenceLabel(label: AbsenceLabel): ExpertSignal {
  switch (label) {
    case "supported":
    case "negative_supported":
      return "supports";
    case "refuted":
      return "refutes";
    case "nei":
      return "insufficient";
  }
}

function hasVerifiableText(text: string): boolean {
  return text.trim().length > 0;
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "MiniCheck (negation-aware entailment)",
  category: "verification",
  description:
    "Negation-aware presence/absence entailment: detects claim polarity deterministically " +
    "and checks each source for grounded evidence that the claimed effect is present or absent.",

  // Highly relevant to any efficacy/safety claim with at least one source with body text.
  // Polarity detection is always applicable, so we gate high whenever there is grounded
  // text to check against; 0 when there is nothing to verify.
  gate(ctx: OrchestrationContext): number {
    if (ctx.claim.trim().length === 0) return 0;
    const usable = ctx.sources.filter((s) => hasVerifiableText(s.text)).length;
    if (usable === 0) return 0;
    // One usable source is enough to run; more sources marginally raise confidence in
    // relevance. Cap at 0.9 to leave headroom for a planner boost.
    return clamp01(0.85 + Math.min(usable - 1, 1) * 0.05);
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    const usableSources = ctx.sources.filter((s) => hasVerifiableText(s.text));
    if (usableSources.length === 0) {
      return skippedContribution(
        EXPERT_ID,
        "No source with usable text to check the claim against."
      );
    }

    // The engine's model step must run to produce an assertion; if the Claude language
    // step is disabled, MiniCheck has no deterministic-only fallback — skip honestly.
    if (!ctx.options.llm) {
      return skippedContribution(
        EXPERT_ID,
        "MiniCheck's presence/absence judgement requires the Claude step, which is disabled."
      );
    }

    try {
      const claim = ctx.claim;
      const perSource: Array<{ source: MoaSource; result: VerifyAbsenceResult }> = [];
      for (const source of usableSources) {
        const result = await verifyAbsenceClaim({
          claim,
          sourceText: source.text,
        });
        perSource.push({ source, result });
      }

      // Pick the highest-confidence result that actually voted (a grounded label, i.e.
      // not nei). Prefer decisive, grounded evidence over honest-insufficient ones.
      const decisive = perSource.filter(({ result }) => result.label !== "nei");
      const best =
        decisive.length > 0
          ? decisive.reduce((a, b) => (b.result.score > a.result.score ? b : a))
          : perSource.reduce((a, b) => (b.result.score > a.result.score ? b : a));

      const { source, result } = best;
      const signal = signalFromAbsenceLabel(result.label);
      const confidence = signal === "insufficient" ? 0 : clamp01(result.score);

      // Surface the engine's already-grounded supporting span verbatim. The engine
      // guarantees supporting_span.text is a located substring of the source text.
      const groundedSpans: GroundedSpan[] =
        result.supporting_span !== null
          ? [
              {
                sourceId: source.id,
                text: result.supporting_span.text,
                start: result.supporting_span.grounding.start,
                end: result.supporting_span.grounding.end,
              },
            ]
          : [];

      const decisiveCount = decisive.length;
      const summary =
        result.label === "nei"
          ? `No groundable presence/absence evidence found across ${usableSources.length} source(s).`
          : `${result.polarity} claim: source asserts ${result.source_assertion} of the effect -> ${result.label}.`;

      return makeContribution(EXPERT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          claimPolarity: result.polarity,
          negationCues: result.negation_cues,
          label: result.label,
          sourceAssertion: result.source_assertion,
          bestSourceId: source.id,
          score: result.score,
          groundingDropped: result.grounding_dropped,
          sourcesChecked: usableSources.length,
          decisiveSourceCount: decisiveCount,
        },
        groundedSpans,
        usedClaude: true,
      });
    } catch (err: unknown) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
