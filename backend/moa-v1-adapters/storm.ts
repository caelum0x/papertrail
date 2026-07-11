// STORM expert — structured debate for MIXED verdicts.
//
// Wraps lib/synthesis/debate.buildDebate: when the sources split into BOTH a
// supporting and a refuting side (derived from each source's upstream `label`),
// it assembles a deterministic four-part debate (Claim / Best-Case-For / Critique
// / Synthesis) and emits the synthesis stance as this expert's directional read.
//
// MOAT preserved: every number, rank, quote, and stance is decided inside
// buildDebate's deterministic path; Claude (honored ONLY when ctx.options.llm)
// writes the connective prose alone. Grounded spans are the VERBATIM located
// substrings buildDebate already grounded against the source text — never fabricated.

import type { Expert, OrchestrationContext, ExpertContribution } from "../types";
import {
  makeContribution,
  skippedContribution,
  erroredContribution,
  clamp01,
} from "../types";
import {
  buildDebate,
  defaultDebateDeps,
  type BuildDebateDeps,
  type DebateSnippet,
  type DebateStance,
  type DebateQuote,
} from "../../synthesis/debate";
import type { ExpertSignal, MoaSource } from "../types";

const EXPERT_ID = "storm";

// A debate needs two non-empty sides; gate this high when both are present.
const GATE_BOTH_SIDES = 0.8;

// Split the sources into supporting / refuting snippets by their upstream label.
// Only sources with usable text and a decisive label contribute a side.
function splitSides(sources: readonly MoaSource[]): {
  supporting: DebateSnippet[];
  refuting: DebateSnippet[];
} {
  const supporting: DebateSnippet[] = [];
  const refuting: DebateSnippet[] = [];
  for (const source of sources) {
    if (typeof source.text !== "string" || source.text.trim().length === 0) {
      continue;
    }
    const snippet: DebateSnippet = { id: source.id, text: source.text };
    if (source.label === "SUPPORTS") {
      supporting.push(snippet);
    } else if (source.label === "REFUTES") {
      refuting.push(snippet);
    }
  }
  return { supporting, refuting };
}

// A debate exists only when BOTH sides carry at least one usable source.
function hasBothSides(ctx: OrchestrationContext): boolean {
  const { supporting, refuting } = splitSides(ctx.sources);
  return supporting.length > 0 && refuting.length > 0;
}

// Map the deterministic synthesis stance onto a directional expert signal.
function signalFromStance(stance: DebateStance): ExpertSignal {
  switch (stance) {
    case "leans_supported":
      return "supports";
    case "leans_refuted":
      return "refutes";
    case "balanced_mixed":
      return "mixed";
    case "one_sided":
    case "insufficient":
      return "insufficient";
  }
}

// Confidence from the (grounded) margin: a wider lead between the two sides is a
// stronger read. Deterministic — derived only from buildDebate's grounded counts.
function confidenceFromMargin(
  supportingCount: number,
  refutingCount: number
): number {
  const total = supportingCount + refutingCount;
  if (total === 0) return 0;
  const margin = Math.abs(supportingCount - refutingCount);
  // 0 margin (perfectly balanced) => 0.5 floor of an honest mixed read;
  // full margin (one side dominates) => 1. Scaled by the margin fraction.
  return clamp01(0.5 + 0.5 * (margin / total));
}

// A UI-safe span text must be a real string; buildDebate guarantees it is a
// verbatim located substring, so we only need to defend against empty text.
function toGroundedSpans(quotes: readonly DebateQuote[]) {
  return quotes
    .filter((q) => typeof q.text === "string" && q.text.length > 0)
    .map((q) => ({
      sourceId: q.sourceId,
      text: q.text,
      start: q.grounding.start,
      end: q.grounding.end,
    }));
}

const expert: Expert = {
  id: EXPERT_ID,
  name: "STORM Debate",
  category: "verification",
  description:
    "Structured two-sided debate for mixed verdicts: grounds and ranks the " +
    "supporting and refuting evidence, then reports a deterministic synthesis stance.",

  gate(ctx: OrchestrationContext): number {
    // A debate is only meaningful when both a supporting and a refuting side exist.
    return hasBothSides(ctx) ? GATE_BOTH_SIDES : 0;
  },

  async run(ctx: OrchestrationContext): Promise<ExpertContribution> {
    const { supporting, refuting } = splitSides(ctx.sources);

    // Honest skip: without two non-empty sides there is no debate to run.
    if (supporting.length === 0 || refuting.length === 0) {
      return skippedContribution(
        EXPERT_ID,
        "No debate: needs both a labeled supporting and a labeled refuting source."
      );
    }

    // Claude writes ONLY the connective prose, and ONLY when the orchestrator allows it.
    const usedClaude = ctx.options.llm === true;
    const deps: BuildDebateDeps | undefined = usedClaude ? defaultDebateDeps : {};

    try {
      const debate = await buildDebate(
        { claim: ctx.claim, supporting, refuting },
        deps
      );

      const { synthesis, bestCaseFor, critique } = debate.sections;

      // buildDebate grounds every side; if grounding dropped BOTH sides to empty,
      // there is no two-sided debate to report — skip honestly rather than vote.
      if (debate.supportingCount === 0 || debate.refutingCount === 0) {
        return skippedContribution(
          EXPERT_ID,
          "No debate: evidence could not be grounded into two non-empty sides."
        );
      }

      const signal = signalFromStance(synthesis.stance);
      const confidence = confidenceFromMargin(
        debate.supportingCount,
        debate.refutingCount
      );

      const groundedSpans = [
        ...toGroundedSpans(bestCaseFor.quotes),
        ...toGroundedSpans(critique.quotes),
      ];

      const summary = `Debate stance "${synthesis.stance}" from ${debate.supportingCount} supporting vs ${debate.refutingCount} refuting grounded quotes (margin ${synthesis.margin}).`;

      return makeContribution(EXPERT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          stance: synthesis.stance,
          supportingCount: debate.supportingCount,
          refutingCount: debate.refutingCount,
          margin: synthesis.margin,
          droppedUngrounded: debate.droppedUngrounded,
          bestCaseQuoteCount: bestCaseFor.quotes.length,
          critiqueQuoteCount: critique.quotes.length,
          usedProse: usedClaude,
        },
        groundedSpans,
        usedClaude,
      });
    } catch (err: unknown) {
      return erroredContribution(EXPERT_ID, err);
    }
  },
};

export default expert;
