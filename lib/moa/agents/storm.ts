// PaperTrail MoA v2 — STORM DEBATE agent (category: deliberation).
//
// COMPOSITION ROLE (LAYER 3 · DELIBERATION): STORM does not classify sources itself. It
// CONSUMES the per-source SUPPORTS/REFUTES/NEI labels MiniCheck PRODUCED (`source_labels`)
// and, when present, the conflict map Valsci PRODUCED (`contested`), and builds ON them a
// structured two-sided debate for a MIXED verdict. It reads the blackboard, partitions the
// input sources into a supporting side and a refuting side USING the upstream labels, then
// hands both sides to lib/synthesis/debate.buildDebate — which grounds and ranks every quote
// against the real source text and computes a synthesis STANCE from the grounded counts alone.
//
// PRODUCES: ["debate"] — a DebateFinding {stance, supportingCount, refutingCount, margin}.
// CONSUMES: ["source_labels", "contested"] — MiniCheck's labels split the sides; Valsci's
//   contested set (if any) prioritizes which sources lead each side. Because STORM depends on
//   `source_labels` to even have two sides, the scheduler orders it AFTER MiniCheck; if that
//   artifact turns out absent/empty at run time it degrades honestly (skippedContribution).
//
// MOAT: no number, rank, quote, or stance is LLM-decided — buildDebate owns the deterministic
// path. Claude (honored ONLY when ctx.options.llm) writes the connective prose alone and can
// never change a count or stance. Grounded spans are the VERBATIM located substrings buildDebate
// already grounded against the source text — never fabricated here. No DB pool, no network
// beyond the Claude prose call the engine lib already makes internally.
//
// This UPGRADES backend/moa-v1-adapters/storm.ts to the v2 composition contract: v1 read each
// source's inline `source.label`; v2 reads MiniCheck's PRODUCED `source_labels` artifact off the
// blackboard (falling back to any inline label only when the artifact lacks a source) and layers
// Valsci's `contested` prioritization on top, then PRODUCES the `debate` artifact for the trace.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  GroundedSpan,
  MoaSource,
  AgentSignal,
  SourceLabel,
  ContestedFinding,
  DebateFinding,
} from "../types";
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

const AGENT_ID = "storm";

// Eligibility weight when the input carries >= 2 sources with usable text: the upstream
// labels will (potentially) split them into two sides for a debate. Deliberation is a
// context-organizer for mixed verdicts, so it gates moderate rather than dominant.
const GATE_ELIGIBLE = 0.6;

// A debate needs at least this many usable-text sources for two sides to be possible.
const MIN_SOURCES = 2;

function hasUsableText(source: MoaSource): boolean {
  return typeof source.text === "string" && source.text.trim().length > 0;
}

// The upstream label for a source: prefer MiniCheck's PRODUCED artifact (the whole point of
// composition), fall back to the source's own inline pre-classification only when the artifact
// has no entry for it. Returns undefined when neither is present (an unlabeled source).
function labelFor(
  source: MoaSource,
  labelById: ReadonlyMap<string, SourceLabel>
): SourceLabel["label"] | undefined {
  const produced = labelById.get(source.id);
  if (produced !== undefined) return produced.label;
  return source.label;
}

// Split the usable sources into supporting / refuting debate snippets using the upstream
// labels. When Valsci's `contested` set is present, the sources it flagged as in-conflict lead
// their side (stable, deterministic: contested-first, then input order) so the debate centers
// on the genuinely disputed evidence. NEI / unlabeled sources join neither side.
function splitSides(
  sources: readonly MoaSource[],
  labelById: ReadonlyMap<string, SourceLabel>,
  contestedIds: ReadonlySet<string>
): { supporting: DebateSnippet[]; refuting: DebateSnippet[] } {
  const supporting: { snippet: DebateSnippet; contested: boolean; order: number }[] = [];
  const refuting: { snippet: DebateSnippet; contested: boolean; order: number }[] = [];

  sources.forEach((source, order) => {
    if (!hasUsableText(source)) return;
    const label = labelFor(source, labelById);
    if (label !== "SUPPORTS" && label !== "REFUTES") return; // NEI / unlabeled: no side.
    const entry = {
      snippet: { id: source.id, text: source.text } satisfies DebateSnippet,
      contested: contestedIds.has(source.id),
      order,
    };
    if (label === "SUPPORTS") supporting.push(entry);
    else refuting.push(entry);
  });

  // Contested sources first (they are what the debate is about), then original input order.
  const rank = (
    a: { contested: boolean; order: number },
    b: { contested: boolean; order: number }
  ): number => {
    if (a.contested !== b.contested) return a.contested ? -1 : 1;
    return a.order - b.order;
  };

  return {
    supporting: [...supporting].sort(rank).map((e) => e.snippet),
    refuting: [...refuting].sort(rank).map((e) => e.snippet),
  };
}

// Map the deterministic synthesis stance onto a directional MoA signal.
//   leans_supported            -> supports
//   leans_refuted              -> refutes
//   balanced_mixed             -> mixed
//   one_sided / insufficient   -> insufficient
function signalFromStance(stance: DebateStance): AgentSignal {
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

// Confidence from the grounded margin: a wider lead between the two sides is a stronger read.
// Deterministic — derived only from buildDebate's grounded counts, never from Claude.
function confidenceFromMargin(supportingCount: number, refutingCount: number): number {
  const total = supportingCount + refutingCount;
  if (total === 0) return 0;
  const margin = Math.abs(supportingCount - refutingCount);
  // Perfectly balanced => 0.5 floor of an honest mixed read; one side dominant => up to 1.
  return clamp01(0.5 + 0.5 * (margin / total));
}

// Surface buildDebate's already-grounded quotes as verbatim spans. buildDebate guarantees each
// quote text is a located substring of a real source, so we only defend against empty text.
function toGroundedSpans(quotes: readonly DebateQuote[]): GroundedSpan[] {
  return quotes
    .filter((q) => typeof q.text === "string" && q.text.length > 0)
    .map((q) => ({
      sourceId: q.sourceId,
      text: q.text,
      start: q.grounding.start,
      end: q.grounding.end,
    }));
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "STORM Debate",
  category: "deliberation",
  description:
    "Deliberation: consumes MiniCheck's per-source labels (and Valsci's contested set) to " +
    "partition sources into a supporting and a refuting side, then assembles a deterministic, " +
    "grounded two-sided debate and reports its synthesis stance for a mixed verdict.",

  // Deliberation: produces the `debate` artifact (the structured two-sided synthesis).
  produces: ["debate"] as const,
  // Composition: reads MiniCheck's labels to split the sides and Valsci's contested set to
  // prioritize the disputed sources. Scheduler orders STORM after those producers.
  consumes: ["source_labels", "contested"] as const,

  // ELIGIBILITY: pure + deterministic over the INPUT only (never the blackboard). Eligible at
  // GATE_ELIGIBLE when >= 2 sources carry usable text, since the upstream labels can then split
  // them into two sides; otherwise 0. No I/O, no LLM, never throws.
  gate(ctx: OrchestrationContext): number {
    const usable = ctx.sources.filter(hasUsableText).length;
    return usable >= MIN_SOURCES ? GATE_ELIGIBLE : 0;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    try {
      // COMPOSE: read the upstream artifacts. `source_labels` is the load-bearing dependency —
      // without it (MiniCheck skipped / disabled) and without inline labels, there are no sides.
      const labels = bb.get("source_labels");
      const labelById = new Map<string, SourceLabel>(
        (labels ?? []).map((l) => [l.sourceId, l] as const)
      );

      // Optional: Valsci's contested set prioritizes which sources lead each side.
      const contested: ContestedFinding | undefined = bb.get("contested");
      const contestedIds = new Set<string>(contested?.sourceIds ?? []);

      // If MiniCheck produced no labels AND no source carries an inline label, STORM has no
      // grounded basis to split the sides — degrade honestly rather than guess.
      const anyLabelAvailable =
        labelById.size > 0 || ctx.sources.some((s) => s.label !== undefined);
      if (!anyLabelAvailable) {
        return skippedContribution(
          AGENT_ID,
          "No per-source labels available upstream (MiniCheck did not produce source_labels); no grounded sides to debate."
        );
      }

      const { supporting, refuting } = splitSides(ctx.sources, labelById, contestedIds);

      // Honest skip: a debate requires BOTH a supporting and a refuting side.
      if (supporting.length === 0 || refuting.length === 0) {
        return skippedContribution(AGENT_ID, "no two grounded sides to debate");
      }

      // Claude writes ONLY the connective prose, and ONLY when the orchestrator allows it. The
      // numeric skeleton (counts, ranks, stance) is deterministic regardless.
      const usedClaude = ctx.options.llm === true;
      const deps: BuildDebateDeps | undefined = usedClaude ? defaultDebateDeps : {};

      const debate = await buildDebate({ claim: ctx.claim, supporting, refuting }, deps);

      const { synthesis, bestCaseFor, critique } = debate.sections;

      // buildDebate grounds every side; if grounding dropped either side to empty there is no
      // two-sided debate to report — skip honestly rather than vote on ungroundable evidence.
      if (debate.supportingCount === 0 || debate.refutingCount === 0) {
        return skippedContribution(AGENT_ID, "no two grounded sides to debate");
      }

      const signal = signalFromStance(synthesis.stance);
      const confidence = confidenceFromMargin(debate.supportingCount, debate.refutingCount);

      const groundedSpans: GroundedSpan[] = [
        ...toGroundedSpans(bestCaseFor.quotes),
        ...toGroundedSpans(critique.quotes),
      ];

      // The PRODUCED artifact downstream agents / the UI trace read via bb.get("debate").
      const debateFinding: DebateFinding = {
        stance: synthesis.stance,
        supportingCount: debate.supportingCount,
        refutingCount: debate.refutingCount,
        margin: synthesis.margin,
      };

      const summary =
        `Debate stance "${synthesis.stance}" from ${debate.supportingCount} supporting vs ` +
        `${debate.refutingCount} refuting grounded quotes (margin ${synthesis.margin}).`;

      return makeContribution(AGENT_ID, {
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
          // Composition provenance: what upstream artifacts STORM actually consumed.
          consumedLabelCount: labelById.size,
          labelsProducer: bb.producerOf("source_labels") ?? null,
          contestedProducer: bb.producerOf("contested") ?? null,
          contestedSourceCount: contestedIds.size,
          contestedDimension: contested?.dimension ?? null,
          usedProse: usedClaude,
        },
        groundedSpans,
        usedClaude,
        produced: { debate: debateFinding },
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
