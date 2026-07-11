// PaperTrail MoA v2 · DISCREPANCY AUDITOR — the flagship primary-source verifier.
//
// This wraps PaperTrail's full extract -> audit -> ground -> reconcile distortion detector
// (lib/verify/discrepancy) as a composing agent. It is the single most authoritative verifier
// in the mixture: on the single-source clinical benchmark that path scores 95%, beating
// Claude-alone (90%), because it classifies the FULL distortion taxonomy an entailment /
// magnitude check misses — magnitude_overstated, population_overgeneralized, caveat_dropped,
// no_support_found — and grounds every flagged span to a verbatim source substring.
//
// COMPOSITION CONTRACT
//   produces: []                 — it votes (the strongest single-source verdict).
//   consumes: ["relevance"]      — uses Loki's ranking to pick the most on-topic PRIMARY
//                                  source to audit (PaperTrail is a primary-source verifier);
//                                  falls back to the first source when relevance is absent.
//
// The verdict is grounded + reconcile-checked; the numeric reconcile is deterministic. Claude
// does the extraction + audit language steps (usedClaude reflects ctx.options.llm). Cross-source
// agreement is handled by the OTHER agents (MultiVerS/PyMARE/STORM); this one audits the primary.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  GroundedSpan,
  SourceRelevance,
  AgentSignal,
  MoaSource,
} from "../types";
import { makeContribution, skippedContribution, erroredContribution, clamp01 } from "../types";
import { detectDiscrepancy, type DiscrepancyType } from "../../verify/discrepancy";

const AGENT_ID = "discrepancy";

// Distortion types that mean the claim drifted from the source -> a refuting vote.
const DISTORTIONS: ReadonlySet<DiscrepancyType> = new Set([
  "magnitude_overstated",
  "population_overgeneralized",
  "caveat_dropped",
]);

// Pick the PRIMARY source to audit: the highest-relevance on-topic source when Loki's ranking
// is available, otherwise the first source with text. Never audits a source ruled off-topic.
function pickPrimary(
  sources: readonly MoaSource[],
  relevance: SourceRelevance | undefined
): MoaSource | undefined {
  const withText = sources.filter((s) => s.text.trim().length > 0);
  if (withText.length === 0) return undefined;
  if (relevance === undefined) return withText[0];
  const dropped = new Set(relevance.droppedIds);
  const onTopic = withText.filter((s) => !dropped.has(s.id));
  const pool = onTopic.length > 0 ? onTopic : withText;
  // Highest relevance score first; stable fallback on original order.
  return [...pool].sort((a, b) => (relevance.rankById[b.id] ?? 0) - (relevance.rankById[a.id] ?? 0))[0];
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "Discrepancy auditor (extract → verify → reconcile)",
  category: "verification",
  description:
    "PaperTrail's flagship primary-source verifier: extracts the source finding, audits the " +
    "claim against it for magnitude/population/caveat distortions, grounds every flagged span, " +
    "and applies the deterministic reconcile. The single most authoritative vote in the mixture.",
  // The authoritative verifier: it alone reproduces the full PaperTrail path (~95% single-source),
  // so it must DOMINATE the mix rather than be diluted to one equal vote among weaker enrichers.
  // 3.0 lets a confident audit outweigh a crowd of dissenting low-weight agents while still being
  // moveable by strong cross-source consensus (MultiVerS/PyMARE) on multi-source claims.
  authority: 3.0,

  produces: [] as const,
  consumes: ["relevance"] as const,

  // The primary-source audit applies to any claim with at least one usable source.
  gate(ctx: OrchestrationContext): number {
    if (ctx.claim.trim().length === 0) return 0;
    const usable = ctx.sources.filter((s) => s.text.trim().length > 0).length;
    if (usable === 0) return 0;
    // The extraction+audit is a language task; without Claude it cannot run.
    return ctx.options.llm ? 0.95 : 0;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    const claim = ctx.claim.trim();
    if (claim.length === 0) {
      return skippedContribution(AGENT_ID, "No claim to audit.");
    }
    if (ctx.options.llm !== true) {
      return skippedContribution(
        AGENT_ID,
        "The discrepancy audit's extraction+verification steps require the Claude language step."
      );
    }

    // COMPOSE: use Loki's relevance ranking to choose the primary source to audit.
    const relevance = bb.get("relevance");
    const primary = pickPrimary(ctx.sources, relevance);
    if (primary === undefined) {
      return skippedContribution(AGENT_ID, "No usable source text to audit.");
    }

    try {
      const result = await detectDiscrepancy(claim, primary.text);

      let signal: AgentSignal;
      let confidence: number;
      if (result.discrepancyType === "accurate") {
        signal = "supports";
        confidence = clamp01(result.trustScore / 100);
      } else if (DISTORTIONS.has(result.discrepancyType)) {
        signal = "refutes";
        // Deterministic confidence for a refuting distortion vote — no LLM in this path.
        // A distortion is only decisive when the audit is severe AND well grounded, so
        // confidence scales with BOTH trustScore severity and grounding success:
        //
        //   * Fix 3 guard: a high trustScore (>80) alongside a distortion verdict is an
        //     anomalous, self-contradicting audit (per VERIFICATION_SYSTEM trust bands,
        //     >80 is "accurate/minor drift", not "meaningful distortion"). Treat it as a
        //     weak, suspect signal rather than a decisive refute.
        //   * Fix 1 severity floor: trustScore 60-89 is minor drift (floor 0.3), 31-60 is
        //     meaningful distortion (floor 0.5), <=30 is a hard distortion (floor 0.8).
        //   * Fix 2 grounding degradation: fold the fraction of flagged spans that survived
        //     grounding into confidence, so a vote backed by 1/5 grounded spans is weaker
        //     than one backed by 5/5. groundingRate in [0,1]; overall multiplier in [0.3,1].
        if (result.trustScore > 80) {
          confidence = 0.3;
        } else {
          const minConfidence =
            result.trustScore <= 30 ? 0.8 : result.trustScore <= 60 ? 0.5 : 0.3;
          const groundingRate =
            result.groundedSpans.length /
            Math.max(1, result.groundedSpans.length + result.droppedUngroundedSpans);
          confidence = clamp01(
            Math.max(minConfidence, 1 - result.trustScore / 100) * (0.3 + 0.7 * groundingRate)
          );
        }
      } else {
        // no_support_found — honest insufficient.
        signal = "insufficient";
        confidence = 0;
      }

      const groundedSpans: GroundedSpan[] = result.groundedSpans.map((s) => ({
        sourceId: primary.id,
        text: s.sourceSpan,
        start: s.start,
        end: s.end,
      }));

      const summary =
        result.discrepancyType === "accurate"
          ? `Primary source AUDIT: claim is accurate (trust ${result.trustScore}/100).`
          : result.discrepancyType === "no_support_found"
            ? "Primary source does not meaningfully address the claim."
            : `Primary source AUDIT: ${result.discrepancyType.replace(/_/g, " ")}` +
              `${result.reconcileDemoted ? " (deterministic reconcile)" : ""} — ${result.explanation.slice(0, 160)}`;

      return makeContribution(AGENT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          primarySourceId: primary.id,
          discrepancyType: result.discrepancyType,
          trustScore: result.trustScore,
          reconcileDemoted: result.reconcileDemoted,
          flaggedSpanCount: result.groundedSpans.length,
          droppedUngroundedSpans: result.droppedUngroundedSpans,
          consumedRelevance: relevance !== undefined,
        },
        groundedSpans,
        usedClaude: true,
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
