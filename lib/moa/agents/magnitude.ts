// PaperTrail MoA v2 · MAGNITUDE RECONCILER — the flagship single-source distortion catch.
//
// This is the capability that separates PaperTrail from a fluent LLM: it does not ask a model
// whether a claimed effect size "looks right", it DETERMINISTICALLY recomputes the claim's
// asserted magnitude against the source's reported effect (HR/RR/OR + CI) and flags an
// overstatement or a dropped caveat by the numbers alone. It works on a SINGLE source (unlike
// PyMARE, which needs >=2 to pool), so it covers the common "reduced by 37%" vs. "HR 0.75 =
// 25%" distortion that a one-paper efficacy claim hides.
//
// COMPOSITION CONTRACT
//   produces: []                 — it votes, it does not publish an artifact.
//   consumes: ["effect_sizes"]   — quant-extractor's parsed effects tell it which sources
//                                  carry a reconcilable number; it only bothers reconciling
//                                  those (and reuses their verbatim `raw` substring for the
//                                  grounded span). The reconcile itself re-reads the source
//                                  text, so it degrades gracefully if the artifact is absent.
//
// MOAT: 100% deterministic — lib/effectSize.reconcile is regex extraction + fixed materiality
// arithmetic (OVERSTATE_FACTOR / CI exclusion). No LLM, no I/O, no DB. usedClaude is always
// false. Grounded spans are verbatim source substrings the extractor already matched.

import type {
  MoaAgent,
  OrchestrationContext,
  AgentContribution,
  Blackboard,
  GroundedSpan,
  ParsedEffectSize,
  AgentSignal,
} from "../types";
import { makeContribution, skippedContribution, erroredContribution, clamp01 } from "../types";
import { reconcile, type ReconcileVerdict } from "../../effectSize";
import { locateSpan } from "../../grounding";

const AGENT_ID = "magnitude";

// Reconcile verdicts that indicate a real distortion of the source by the claim.
const DISTORTIONS: ReadonlySet<ReconcileVerdict> = new Set([
  "magnitude_overstated",
  "caveat_dropped",
]);

interface SourceReconcile {
  sourceId: string;
  verdict: ReconcileVerdict;
  rationale: string;
  claimedValue: number | null;
}

// Find the effect the extractor already parsed for a source, so we can ground the
// reconcile against that verbatim `raw` substring rather than re-searching.
function effectFor(
  effects: readonly ParsedEffectSize[] | undefined,
  sourceId: string
): ParsedEffectSize | undefined {
  return effects?.find((e) => e.sourceId === sourceId);
}

const agent: MoaAgent = {
  id: AGENT_ID,
  name: "Magnitude reconciler (effect-size)",
  category: "verification",
  description:
    "Deterministically recomputes the claim's asserted effect magnitude against each source's " +
    "reported HR/RR/OR + CI and flags overstatement or a dropped caveat — the single-source " +
    "distortion catch a fluent LLM misses. No LLM in the numeric path.",

  produces: [] as const,
  // Composes with quant-extractor: its effect_sizes mark which sources carry a reconcilable
  // number and provide the verbatim span to ground. Soft dep — reconcile re-reads the text.
  consumes: ["effect_sizes"] as const,

  // Pure/deterministic from input only: applicable whenever there is a claim and >=1 source.
  // reconcile returns "cannot_reconcile" when there is no number, so a low-signal fire is cheap
  // and honest rather than gated out.
  gate(ctx: OrchestrationContext): number {
    if (ctx.claim.trim().length === 0) return 0;
    const usable = ctx.sources.filter((s) => s.text.trim().length > 0).length;
    return usable === 0 ? 0 : 0.85;
  },

  async run(ctx: OrchestrationContext, bb: Blackboard): Promise<AgentContribution> {
    const claim = ctx.claim.trim();
    const usableSources = ctx.sources.filter((s) => s.text.trim().length > 0);
    if (claim.length === 0 || usableSources.length === 0) {
      return skippedContribution(AGENT_ID, "No claim or source text to reconcile the magnitude against.");
    }

    try {
      // COMPOSE: read quant-extractor's parsed effects (advisory — used to ground + summarize).
      const effects = bb.get("effect_sizes");

      const perSource: SourceReconcile[] = [];
      const groundedSpans: GroundedSpan[] = [];

      for (const source of usableSources) {
        const rec = reconcile(claim, source.text);
        perSource.push({
          sourceId: source.id,
          verdict: rec.verdict,
          rationale: rec.rationale,
          claimedValue: rec.claimedValue,
        });

        // Ground the source's effect number (verbatim) for the citation trail when we have one.
        const parsed = effectFor(effects, source.id);
        const rawNumber = parsed?.raw ?? rec.sourceEffect?.raw ?? null;
        if (rawNumber) {
          const located = locateSpan(source.text, rawNumber);
          if (located) {
            groundedSpans.push({
              sourceId: source.id,
              text: located.text,
              start: located.start,
              end: located.end,
            });
          }
        }
      }

      const distorted = perSource.filter((r) => DISTORTIONS.has(r.verdict));
      const consistent = perSource.filter((r) => r.verdict === "consistent");

      let signal: AgentSignal;
      let confidence: number;
      let summary: string;

      if (distorted.length > 0) {
        // The claim distorts at least one source's numbers — the flagship catch.
        signal = "refutes";
        confidence = clamp01(0.7 + 0.1 * distorted.length);
        const first = distorted[0];
        summary =
          `Magnitude distortion: ${first.verdict.replace("_", " ")} in ${distorted.length} ` +
          `source(s). ${first.rationale}`;
      } else if (consistent.length > 0) {
        // The claim's magnitude checks out against the source numbers.
        signal = "supports";
        confidence = clamp01(0.5 + 0.1 * consistent.length);
        summary = `Claimed magnitude is consistent with ${consistent.length} source effect(s). ${consistent[0].rationale}`;
      } else {
        // No numbers to reconcile in either the claim or the sources — honest abstain.
        return makeContribution(AGENT_ID, {
          ran: true,
          signal: "insufficient",
          confidence: 0,
          summary: "No reconcilable effect size in the claim and sources; magnitude not assessable.",
          detail: { perSource, effectSizesConsumed: effects !== undefined },
          usedClaude: false,
        });
      }

      return makeContribution(AGENT_ID, {
        ran: true,
        signal,
        confidence,
        summary,
        detail: {
          perSource,
          distortedCount: distorted.length,
          consistentCount: consistent.length,
          effectSizesConsumed: effects !== undefined,
        },
        groundedSpans,
        usedClaude: false,
      });
    } catch (err: unknown) {
      return erroredContribution(AGENT_ID, err);
    }
  },
};

export default agent;
